# CLAUDE.md — LT Analyzer

Critical information for AI agents working on this project.

---

## Hard Constraints

- **No build step.** No npm, no bundler, no TypeScript. The repository must stay deployable as a static site by opening `index.html` directly or via GitHub Pages.
- **No new external dependencies.** Chart.js 4.4.4 from CDN is the only allowed external script. Do not add other libraries.
- **No ES modules.** Do not use `<script type="module">` or `import`/`export` syntax. The site must work via `file://` protocol, which blocks module loading due to CORS. All functions are globals loaded via classic `<script>` tags in order.
- **Syntax check before committing:** Run `node --check` on every `.js` file you touch. Node's `--check` flag only validates syntax — it will not complain about unresolved globals (e.g. `fitPoly` in `dmax.js`), which is intentional.

```bash
node --check app.js
node --check algorithms/shared.js
node --check algorithms/obla.js
node --check algorithms/baseline.js
node --check algorithms/dmax.js
node --check algorithms/loglog.js
node --check algorithms/ltp.js
node --check algorithms/d2max.js
node --check algorithms/nadir.js
```

---

## File Structure

```
index.html          — App shell; screens toggled by .hidden class
app.js              — State, method registries, all UI/DOM logic (~1 250 lines)
style.css           — All styles, mobile-first, CSS custom properties
algorithms/
  shared.js         — Shared math utilities (fitPoly, interpolation, etc.)
  obla.js           — calcOBLA, calcOBLACustom
  baseline.js       — calcBaselinePlus04, calcBaselinePlus10
  dmax.js           — calcDmax, calcModDmax
  loglog.js         — calcLogLog
  ltp.js            — calcInflection, calcLTP1, calcLTP2
  d2max.js          — calcD2max
  nadir.js          — Nadir-segmentti + primaarialgo + calcNadirBreakpoint
README.md           — User-facing documentation (English)
CLAUDE.md           — This file
```

---

## Script Loading Order (index.html)

Scripts are loaded in dependency order. **Do not change this order.**

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script src="algorithms/shared.js"></script>   <!-- no deps -->
<script src="algorithms/obla.js"></script>      <!-- needs: shared.js globals -->
<script src="algorithms/baseline.js"></script>  <!-- needs: shared.js globals -->
<script src="algorithms/dmax.js"></script>      <!-- needs: shared.js globals -->
<script src="algorithms/loglog.js"></script>    <!-- needs: shared.js globals -->
<script src="algorithms/ltp.js"></script>       <!-- needs: shared.js globals -->
<script src="algorithms/d2max.js"></script>     <!-- needs: shared.js globals -->
<script src="algorithms/nadir.js"></script>     <!-- self-contained -->
<script src="app.js"></script>                  <!-- last: defines LT2_METHODS etc. -->
```

`app.js` must be last because `calcOBLACustom` (in `obla.js`) reads `LT2_METHODS[5].customThreshold` at runtime — this global is defined in `app.js` and is always available before any user interaction.

---

## Algorithm Files — Contents and Dependencies

| File | Contains | Depends on (globals from) |
|------|----------|--------------------------|
| `algorithms/shared.js` | `fitPoly`, `solveQuadraticInRange`, `findMaxSecondDerivative`, `interpolateAtLactate`, `interpolateAtIntensity`, `baselineLactate`, `perpDist`, `linearFit`, `linearSSR`, `_ltpSecondDerivCoeffs`, `_ltpLT2Fallback`, `calcR2` | nothing |
| `algorithms/obla.js` | `calcOBLA`, `calcOBLACustom` | `shared.js`, `LT2_METHODS` (app.js, runtime only) |
| `algorithms/baseline.js` | `calcBaselinePlus04`, `calcBaselinePlus10` | `shared.js` |
| `algorithms/dmax.js` | `calcDmax`, `calcModDmax` | `shared.js` |
| `algorithms/loglog.js` | `calcLogLog` | `shared.js` |
| `algorithms/ltp.js` | `calcInflection`, `calcLTP1`, `calcLTP2` | `shared.js` |
| `algorithms/d2max.js` | `calcD2max` | `shared.js` |
| `algorithms/nadir.js` | Nadir-breakpoint-algoritmi, primaarialgo, `calcNadirBreakpoint` | self-contained (own private helpers) |

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

Three arrays in `app.js` define all available methods. Each entry has `{ key, label, ref, desc, calc }`.

### `PAIR_METHODS` — produce both LT1 and LT2

| key | label | calc function | file |
|-----|-------|---------------|------|
| `obla` | OBLA 2.0 / 4.0 mmol/L | `calcOBLA` | `algorithms/obla.js` |
| `nadir_breakpoint` | Nadir-segmenttialgoritmi | `calcNadirBreakpoint` | `algorithms/nadir.js` |
| `ltp` | LTP1 / LTP2 | `calcInflection` | `algorithms/ltp.js` |

### `LT1_METHODS` — produce LT1 only (lt2 always null)

| key | label | calc function | file |
|-----|-------|---------------|------|
| `baseline04` | Baseline + 0.4 mmol/L | `calcBaselinePlus04` | `algorithms/baseline.js` |
| `baseline10` | Baseline + 1.0 mmol/L | `calcBaselinePlus10` | `algorithms/baseline.js` |
| `ltp1` | LTP1 — Ensimmäinen taitekohta | `calcLTP1` | `algorithms/ltp.js` |

### `LT2_METHODS` — produce LT2 only (lt1 always null)

| key | label | calc function | file |
|-----|-------|---------------|------|
| `ltp2` | LTP2 — Toinen taitekohta | `calcLTP2` | `algorithms/ltp.js` |
| `dmax` | Dmax | `calcDmax` | `algorithms/dmax.js` |
| `moddmax` | Modified Dmax | `calcModDmax` | `algorithms/dmax.js` |
| `loglog` | Log-Log | `calcLogLog` | `algorithms/loglog.js` |
| `d2max` | D2max | `calcD2max` | `algorithms/d2max.js` |
| `obla_custom` | OBLA (mukautettu) | `calcOBLACustom` | `algorithms/obla.js` |

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

| Function | File | Strategy | Min steps |
|----------|------|----------|-----------|
| `calcOBLA` | `obla.js` | Linear interpolation at 2.0 and 4.0 mmol/L | 2 |
| `calcNadirBreakpoint` | `nadir.js` | Segmentation: nadir anchor + slope-based LT2 | 6 |
| `calcDmax` | `dmax.js` | Cubic poly; max perpendicular distance to first-last line | 4 |
| `calcModDmax` | `dmax.js` | Like Dmax; reference line starts at baseline+0.4 point | 4 |
| `calcLogLog` | `loglog.js` | Brute-force split in log-log space; line intersection | 4 |
| `calcInflection` | `ltp.js` | Degree-4 poly L″(t)=0 zero-crossings → LT1 + LT2 | 5 |
| `calcBaselinePlus04` | `baseline.js` | `baseline(avg first 2) + 0.4` interpolation | 2 |
| `calcBaselinePlus10` | `baseline.js` | `baseline(avg first 2) + 1.0` interpolation | 2 |
| `calcOBLACustom` | `obla.js` | Configurable OBLA threshold (default 3.5) | 2 |
| `calcLTP1` | `ltp.js` | First L″(t)=0 root → LT1 | 5 |
| `calcLTP2` | `ltp.js` | Second L″(t)=0 root (fallback: L″ max) → LT2 | 5 |
| `calcD2max` | `d2max.js` | L″(t) maximum in [0.05, 0.95] → LT2 | 5 |

---

## Key Shared Helpers (`algorithms/shared.js`)

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

## Adding a New Method

### New paired method (produces both LT1 and LT2)

1. Create (or choose an existing) file in `algorithms/` — e.g. `algorithms/mymethod.js`
2. Write `calcMyMethod(steps)` → `{ lt1, lt2 }` using helpers from `shared.js` as globals
3. Add `<script src="algorithms/mymethod.js"></script>` to `index.html` **before** `<script src="app.js">`
4. Add entry to `PAIR_METHODS` in `app.js`: `{ key:'mymethod', label:'...', ref:'...', desc:'...', calc: calcMyMethod }`
5. Done — `buildMethodSelectors` picks it up automatically

### New individual LT1 method

1. Write `calcMyLT1(steps)` → `{ lt1: ..., lt2: null }` in an appropriate file under `algorithms/`
2. Add the script tag to `index.html`
3. Add entry to `LT1_METHODS` in `app.js`

### New individual LT2 method

1. Write `calcMyLT2(steps)` → `{ lt1: null, lt2: ... }` in an appropriate file under `algorithms/`
2. Add the script tag to `index.html`
3. Add entry to `LT2_METHODS` in `app.js`

No other changes needed. The selector UI, chart, and cards all update automatically.

---

## Key UI Functions (`app.js`)

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

Development branch: `claude/refactor-algorithm-modules-jmAkh`

All feature changes go here first, then merge to `main`.
