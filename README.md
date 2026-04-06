# LT Analyzer

A browser-based lactate threshold analyzer for cycling and running. Enter data from a graded exercise test and get LT1 (aerobic threshold) and LT2 (anaerobic threshold) estimates using up to nine scientifically validated methods.

**No build step. No backend. No dependencies beyond Chart.js.** Works entirely in the browser — host on GitHub Pages or open `index.html` locally.

---

## Features

- **Two sports**: cycling (power in watts) and running (pace in MM:SS /km)
- **Two-tier method selector**: choose a paired method (LT1 + LT2 simultaneously) or select LT1 and LT2 methods independently
- **Nine algorithms**: covers threshold detection via fixed concentrations, polynomial inflection points, geometric distance, log-log regression, and second-derivative maximization
- **JSON import/export**: download a template, fill it in, upload to pre-populate the table
- **Mobile-first**: responsive layout, touch-friendly controls
- **Instant feedback**: chart and threshold cards update as you switch methods

---

## Usage

1. Select **Pyöräily** (cycling) or **Juoksu** (running)
2. Enter at least 5 steps: intensity (watts or MM:SS pace), heart rate, and blood lactate
3. Click **Analysoi** to see results
4. Switch methods in the results screen — the chart and threshold cards update live

### JSON import

Click **JSON-pohja** to download a template, fill in your data, then click **Tuo JSON** to load it.

```json
{
  "sport": "cycling",
  "steps": [
    { "intensity": 100, "hr": 115, "lactate": 1.1 },
    { "intensity": 150, "hr": 133, "lactate": 1.3 },
    { "intensity": 200, "hr": 152, "lactate": 1.8 },
    { "intensity": 250, "hr": 170, "lactate": 2.9 },
    { "intensity": 300, "hr": 183, "lactate": 5.1 },
    { "intensity": 350, "hr": 191, "lactate": 8.4 }
  ]
}
```

For running, use pace strings as intensity values:

```json
{
  "sport": "running",
  "steps": [
    { "intensity": "6:30", "hr": 118, "lactate": 1.2 },
    { "intensity": "6:00", "hr": 132, "lactate": 1.4 }
  ]
}
```

---

## Available Methods

### Paired methods (LT1 + LT2 together)

| Method | Description | Reference |
|--------|-------------|-----------|
| **OBLA 2.0 / 4.0 mmol/L** | LT1 interpolated at 2.0 mmol/L blood lactate; LT2 at 4.0 mmol/L. Simple and widely used as a clinical reference. | Mader et al. (1976) |
| **LTP1 / LTP2** | Fits a degree-4 polynomial to the lactate curve and finds zero-crossings of the second derivative L″(t). The first zero-crossing is LT1 (aerobic threshold); the second is LT2 (anaerobic threshold). Falls back to the L″ maximum when only one root exists. | Polynomial 2nd derivative; see also Hofmann & Tschakert (2011) |

### Individual LT1 methods

| Method | Description | Reference |
|--------|-------------|-----------|
| **Baseline + 0.4 mmol/L** | LT1 is the intensity where lactate rises 0.4 mmol/L above the individual minimum (resting baseline). | Heck et al. (1985) |
| **LTP1 — First turning point** | Uses the same degree-4 polynomial as the paired LTP method but returns only the first L″(t) = 0 crossing as LT1. | Polynomial 2nd derivative |

### Individual LT2 methods

| Method | Description | Reference |
|--------|-------------|-----------|
| **LTP2 — Second turning point** | Returns only the second L″(t) = 0 crossing as LT2 (or the single root / L″ maximum as fallback). | Polynomial 2nd derivative |
| **Dmax** | Fits a cubic polynomial to the full lactate curve. LT2 is the point of maximum perpendicular distance from the line connecting the first and last measured points. | Cheng et al. (1992) |
| **Modified Dmax** | Like Dmax, but the reference line starts at the point where lactate first exceeds baseline + 0.4 mmol/L. Reduces sensitivity to the starting intensity of the test. | Newell et al. (2007) |
| **Log-Log** | Transforms both intensity and lactate to log scale and finds the best split point where two linear segments minimize total residual error. LT2 is the intersection of those two regression lines. | Beaver et al. (1985) |
| **D2max** | Fits a degree-4 polynomial and returns the intensity where the second derivative L″(t) is _maximized_ — the point of greatest acceleration in the lactate rise. Distinct from LTP2 which finds where L″(t) = 0. | Jamnick et al. (2018) |

---

## Tech Stack

| Component | Choice |
|-----------|--------|
| Markup | Plain HTML5 |
| Styles | Vanilla CSS (custom properties, grid, flexbox) |
| Logic | Vanilla ES6+ JavaScript (no framework) |
| Charts | [Chart.js 4.4.4](https://www.chartjs.org/) via CDN |
| Hosting | GitHub Pages (static) |

---

## Local Development

No build step required. Just open `index.html` in a browser:

```bash
# With Python
python3 -m http.server 8080

# With Node
npx serve .
```

Then visit `http://localhost:8080`.

---

## Project Structure

```
ltanalyzer/
├── index.html   # App shell, two-screen layout
├── app.js       # All application logic (~970 lines)
├── style.css    # All styles, mobile-first
└── README.md    # This file
```
