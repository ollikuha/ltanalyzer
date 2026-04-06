# CLAUDE.md — LT Analyzer

Critical information for AI agents working on this project.

---

## Hard Constraints

- **No build step.** No npm, no bundler, no TypeScript. The repository must stay deployable as a static site by opening `index.html` directly or via GitHub Pages.
- **No new external dependencies.** Chart.js 4.4.4 from CDN is the only allowed external script. Do not add other libraries.
- **Syntax check before committing:** Run `node --check app.js` after editing `app.js` to catch parse errors before they reach the browser.

---

## File Structure

```
index.html   — App shell; two screens toggled by .hidden class
app.js       — All logic: state, algorithms, UI, chart (~970 lines)
style.css    — All styles, mobile-first, CSS custom properties
README.md    — User-facing documentation (English)
CLAUDE.md    — This file
```

---

## App State

```js
const state = {
  sport:   'cycling',  // 'cycling' | 'running'
  steps:   [],         // array of step objects (see below)
  pairKey: 'obla',     // string|null — active paired method key
  lt1Key:  null,       // string|null — active individual LT1 key
  lt2Key:  null,       // string|null — active individual LT2 key
  chart:   null        // Chart.js instance or null
};
```

**Invariant**: either `pairKey !== null` (individual keys are both null), or `pairKey === null` (individual keys set independently). Never have both `pairKey` and an individual key non-null simultaneously.

**Step objects** (after `syncFromDOM()`):
```js
{ intensity: number,  // watts (cycling) or km/h (running, converted from MM:SS)
  hr: number,
  lactate: number,
  _paceStr: string    // preserved raw MM:SS string for running re-render
}
```

---

## Method Registries

Three arrays define all available methods. Each entry has `{ key, label, ref, calc }`.

### `PAIR_METHODS` — produce both LT1 and LT2

| key | label | calc function |
|-----|-------|---------------|
| `obla` | OBLA 2.0 / 4.0 mmol/L | `calcOBLA` |
| `ltp` | LTP1 / LTP2 | `calcInflection` |

### `LT1_METHODS` — produce LT1 only (lt2 always null)

| key | label | calc function |
|-----|-------|---------------|
| `baseline04` | Baseline + 0.4 mmol/L | `calcBaselinePlus04` |
| `baseline10` | Baseline + 1.0 mmol/L | `calcBaselinePlus10` |
| `ltp1` | LTP1 — Ensimmäinen taitekohta | `calcLTP1` |

### `LT2_METHODS` — produce LT2 only (lt1 always null)

| key | label | calc function |
|-----|-------|---------------|
| `ltp2` | LTP2 — Toinen taitekohta | `calcLTP2` |
| `dmax` | Dmax | `calcDmax` |
| `moddmax` | Modified Dmax | `calcModDmax` |
| `loglog` | Log-Log | `calcLogLog` |
| `d2max` | D2max | `calcD2max` |
| `obla_custom` | OBLA (mukautettu) | `calcOBLACustom` |

---

## Algorithm Function Signatures

All calc functions receive `sortedSteps` (sorted ascending by intensity) and return:

```js
{ lt1: ThresholdPoint|null, lt2: ThresholdPoint|null }

// ThresholdPoint:
{ intensity: number,  // watts or km/h
  hr: number,
  lactate: number }
```

| Function | Strategy | Min steps |
|----------|----------|-----------|
| `calcOBLA` | Linear interpolation at 2.0 and 4.0 mmol/L | 2 |
| `calcDmax` | Cubic poly; max perpendicular distance to first-last line | 4 |
| `calcModDmax` | Like Dmax; reference line starts at baseline+0.4 point | 4 |
| `calcLogLog` | Brute-force split in log-log space; line intersection | 4 |
| `calcInflection` | Degree-4 poly L″(t)=0 zero-crossings → LT1 + LT2 | 5 |
| `calcBaselinePlus04` | `baseline(avg first 2) + 0.4` interpolation | 2 |
| `calcBaselinePlus10` | `baseline(avg first 2) + 1.0` interpolation | 2 |
| `calcOBLACustom` | Configurable OBLA threshold (default 3.5) | 2 |
| `calcLTP1` | First L″(t)=0 root → LT1 | 5 |
| `calcLTP2` | Second L″(t)=0 root (fallback: L″ max) → LT2 | 5 |
| `calcD2max` | L″(t) maximum in [0.05, 0.95] → LT2 | 5 |

---

## Key Shared Helpers

```js
// Fit degree-N polynomial; x values normalized to [0,1] for numerical stability
// Returns { eval(x), coeffs, xMin, xRange }
fitPoly(xs, ys, degree)

// Roots of a*t^2 + b*t + c = 0 in [tMin, tMax], sorted ascending
solveQuadraticInRange(a, b, c, tMin, tMax)  // → number[]

// t in [tMin, tMax] where quadratic a*t^2+b*t+c is maximized
findMaxSecondDerivative(a, b, c, tMin, tMax)  // → number

// Linear interpolation — returns ThresholdPoint at given lactate value
interpolateAtLactate(steps, targetLactate)  // → ThresholdPoint|null

// Linear interpolation — returns ThresholdPoint at given intensity
interpolateAtIntensity(steps, x)  // → ThresholdPoint|null

// Robust baseline: average of first 2 steps' lactate (guards against outlier)
baselineLactate(steps)  // → number

// Coefficient of determination for a fitted model
calcR2(xs, ys, evalFn)  // → number
```

---

## Key UI Functions

```js
// Rebuild entire selector DOM inside #method-selector
buildMethodSelectors(sortedSteps)

// Apply active/disabled CSS state without rebuilding DOM
syncSelectorUI()

// Activate a paired method (clears lt1Key/lt2Key)
setPairMethod(key, sortedSteps)

// Activate an individual LT1 method (clears pairKey)
setLT1Method(key, sortedSteps)

// Activate an individual LT2 method (clears pairKey)
setLT2Method(key, sortedSteps)

// Run active method(s), update chart + cards + method info
computeAndDisplay(sortedSteps)

// Update #info-name, #info-desc, #info-ref
updateMethodInfo()

// Update LT card DOM elements from result object
updateLtCards(result)

// Run all methods and show comparison table + consensus
updateMethodComparison(sortedSteps)

// Show training zones based on LT1/LT2
updateTrainingZones(sortedSteps, result)

// Assess data quality and show warnings
updateDataQuality(sortedSteps)

// Show R² fit quality for polynomial models
updateFitQuality(sortedSteps)
```

---

## Running Pace Handling

- **All math uses km/h** internally (polynomial fitting, interpolation, chart x-axis)
- **Display converts km/h → MM:SS /km** via `speedToPace(kmh)`
- **Input parses MM:SS → km/h** via `paceToSpeed("MM:SS")` = `60 / (min + sec/60)`
- `step._paceStr` stores the raw "MM:SS" string so `syncFromDOM()` can re-render input fields without losing formatting
- When `state.sport === 'running'`, the chart x-axis tick callback formats values as pace strings

---

## Adding a New Method

### New paired method (produces both LT1 and LT2)

1. Write `calcMyMethod(steps)` → `{ lt1, lt2 }`
2. Add entry to `PAIR_METHODS`: `{ key:'mymethod', label:'...', ref:'...', calc: calcMyMethod }`
3. Done — `buildMethodSelectors` picks it up automatically

### New individual LT1 method

1. Write `calcMyLT1(steps)` → `{ lt1: ..., lt2: null }`
2. Add entry to `LT1_METHODS`

### New individual LT2 method

1. Write `calcMyLT2(steps)` → `{ lt1: null, lt2: ... }`
2. Add entry to `LT2_METHODS`

No other changes needed. The selector UI, chart, and cards all update automatically.

---

## CSS Naming Conventions

- `--lt1` / `--lt2` — CSS custom properties for threshold colors (blue / orange)
- `.lt1-card` / `.lt2-card` — result cards
- `.lt1-option` / `.lt2-option` — individual method selector buttons
- `.pair-options` — container for paired method buttons
- `.selector-btn` — base class for all method selector buttons
- `.selector-btn.active` — selected state
- `.individual-section--disabled` — applied to `#individual-section` when a pair method is active
- `.individual-grid` — two-column grid for LT1/LT2 method columns (collapses to 1-column on mobile ≤640px)

---

## Chart Configuration

Chart.js `scatter` base type with custom datasets:

| Dataset | Type | Color | Notes |
|---------|------|-------|-------|
| Fitted curve | line (no points) | `rgba(37,99,235,0.3)` | Cubic polynomial over sorted steps |
| Lactate (raw) | line + points | `#1e293b` | Primary left y-axis |
| Heart rate | line + points | `#64748b` | Secondary right y-axis (`yHR`) |
| LT1 vertical line | line | `#3b82f6` dashed | Two-point vertical line at LT1 x |
| LT2 vertical line | line | `#f97316` dashed | Two-point vertical line at LT2 x |

Destroy old chart instance before creating new one to avoid Canvas reuse errors.

---

## Two-Screen Flow

```
screen-input  (id="screen-input")
  → validateAndAnalyze()
  → showScreen('results')
  → showResults(sortedSteps)   ← resets state, rebuilds selectors

screen-results (id="screen-results")
  → back button → showScreen('input')
```

Screens are toggled with `el.classList.toggle('hidden')`. No router or hash navigation.

---

## Git Branch

Development branch: `claude/lactate-threshold-analyzer-oh9EE`

All feature changes go here first, then merge to `main`.
