/* =========================================================
   LT Analyzer – app.js
   ========================================================= */

'use strict';

// ── State ────────────────────────────────────────────────
const state = {
  sport: 'cycling',
  steps: [],
  pairKey:  'obla',   // active paired method key, or null
  lt1Key:   null,     // active individual LT1 method key, or null
  lt2Key:   null,     // active individual LT2 method key, or null
  chart: null
};

// ── Method registries ────────────────────────────────────
const PAIR_METHODS = [
  {
    key: 'obla',
    label: 'OBLA 2.0 / 4.0 mmol/L',
    ref: 'Mader et al. (1976)',
    desc: 'Kiinteät laktaattikynnykset: LT1 = 2.0 mmol/L, LT2 = 4.0 mmol/L. Yksinkertaisin ja eniten käytetty menetelmä. Ei huomioi yksilöllisiä eroja vaan käyttää universaaleja raja-arvoja.',
    calc: calcOBLA
  },
  {
    key: 'ltp',
    label: 'LTP1 / LTP2',
    ref: 'Polynomisovitus, 2. derivaatta',
    desc: 'Polynomisovituksen (aste 4) toisen derivaatan nollakohdat antavat laktaattikäyrän taitekohtia. Ensimmäinen nollakohta = LTP1 (aerobinen), toinen = LTP2 (anaerobinen kynnys). Jos selkeitä erillisiä taitekohtia ei löydy (esim. "hockeymailakäyrä"), LTP2 arvioidaan automaattisesti Dmax-menetelmällä.',
    calc: calcInflection
  }
];

const LT1_METHODS = [
  {
    key: 'baseline04',
    label: 'Baseline + 0.4 mmol/L',
    ref: 'Heck et al. (1985)',
    desc: 'LT1 = pienin mitattu laktaattiarvo + 0.4 mmol/L. Yksinkertainen yksilöllinen menetelmä, joka perustuu henkilön omaan lepotason laktaattiin.',
    calc: calcBaselinePlus04
  },
  {
    key: 'baseline10',
    label: 'Baseline + 1.0 mmol/L',
    ref: 'Dickhuth et al. (1999)',
    desc: 'LT1 = baseline-laktaatti + 1.0 mmol/L. Käytetään laajasti Keski-Euroopassa. Korkeampi kynnys kuin +0.4, vastaa paremmin ensimmäistä havaittavaa laktaattinousua kestävyysurheilijoilla.',
    calc: calcBaselinePlus10
  },
  {
    key: 'ltp1',
    label: 'LTP1 — Ensimmäinen taitekohta',
    ref: 'Polynomisovitus, 2. derivaatta',
    desc: 'Polynomisovituksen (aste 4) toisen derivaatan ensimmäinen nollakohta välillä [0.05, 0.95]. Vastaa laktaattikäyrän ensimmäistä kiihtymiskohtaa (aerobinen kynnys).',
    calc: calcLTP1
  }
];

const LT2_METHODS = [
  {
    key: 'ltp2',
    label: 'LTP2 — Toinen taitekohta',
    ref: 'Polynomisovitus, 2. derivaatta',
    desc: 'Polynomisovituksen (aste 4) toisen derivaatan toinen nollakohta. Jos vain yksi nollakohta löytyy, se käytetään LT2:na. Jos nollakohtia ei ole, käytetään L\'\'(t)-maksimia.',
    calc: calcLTP2
  },
  {
    key: 'dmax',
    label: 'Dmax',
    ref: 'Cheng et al. (1992)',
    desc: 'Sovitetaan kolmannen asteen polynomikäyrä laktaattidataan. LT2 on piste, jolla polynomikäyrän etäisyys ensimmäisen ja viimeisen mittauspisteen väliselle suoralle on maksimaalinen.',
    calc: calcDmax
  },
  {
    key: 'moddmax',
    label: 'Modified Dmax',
    ref: 'Newell et al. (2007)',
    desc: 'Kuten Dmax, mutta referenssiviiva alkaa ensimmäisestä pisteestä, jossa laktaatti ylittää minimilaktaatin + 0.4 mmol/L. Vähemmän herkkä lepotason laktaattivaihtelulle.',
    calc: calcModDmax
  },
  {
    key: 'loglog',
    label: 'Log-Log',
    ref: 'Beaver et al. (1985)',
    desc: 'Muunnetaan data logaritmiasteikkoon (log laktaatti vs. log intensiteetti). Kaksi lineaarista sovitusta löytävät katkokohdan, joka vastaa LT2:ta.',
    calc: calcLogLog
  },
  {
    key: 'd2max',
    label: 'D2max',
    ref: 'Jamnick et al. (2018)',
    desc: 'Polynomisovituksen (aste 4) toisen derivaatan L\'\'(t) maksimikohta. Löytää intensiteetin, jossa laktaatin nousuvauhdin kiihtyminen on suurimmillaan — eroaa LTP2:sta, joka on nollakohta.',
    calc: calcD2max
  },
  {
    key: 'obla_custom',
    label: 'OBLA (mukautettu)',
    ref: 'Heck et al. (1985)',
    desc: 'Kiinteä laktaattikynnys mukautettavalla raja-arvolla (oletus 3.5 mmol/L). Voit säätää arvoa 2.0–6.0 mmol/L. Arvo 3.5 on usein lähempänä todellista MLSS:ää kuin perinteinen 4.0 mmol/L.',
    calc: calcOBLACustom,
    customThreshold: 3.5
  }
];

// ── Shared Math Utilities ────────────────────────────────

// Robust baseline lactate: average of the two lowest-intensity steps.
// Using the average (instead of a single Math.min) guards against one
// anomalously low reading skewing baseline-relative methods.
function baselineLactate(steps) {
  if (steps.length <= 2) return Math.min(...steps.map(s => s.lactate));
  return (steps[0].lactate + steps[1].lactate) / 2;
}

function interpolateAtLactate(steps, target) {
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i], b = steps[i + 1];
    if (
      target >= Math.min(a.lactate, b.lactate) &&
      target <= Math.max(a.lactate, b.lactate) &&
      Math.abs(b.lactate - a.lactate) > 1e-9
    ) {
      const t = (target - a.lactate) / (b.lactate - a.lactate);
      return {
        intensity: a.intensity + t * (b.intensity - a.intensity),
        hr: a.hr + t * (b.hr - a.hr),
        lactate: target
      };
    }
  }
  return null;
}

function interpolateAtIntensity(steps, x) {
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i], b = steps[i + 1];
    if (x >= a.intensity && x <= b.intensity) {
      const t = (x - a.intensity) / (b.intensity - a.intensity);
      return {
        intensity: x,
        hr: a.hr + t * (b.hr - a.hr),
        lactate: a.lactate + t * (b.lactate - a.lactate)
      };
    }
  }
  return null;
}

function perpDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-12) return 0;
  return Math.abs(dx * (y1 - py) - (x1 - px) * dy) / len;
}

function linearFit(xs, ys) {
  const n = xs.length;
  if (n < 2) return { m: 0, b: ys[0] || 0 };
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0);
  const sx2 = xs.reduce((s, x) => s + x * x, 0);
  const den = n * sx2 - sx * sx;
  if (Math.abs(den) < 1e-12) return { m: 0, b: sy / n };
  const m = (n * sxy - sx * sy) / den;
  return { m, b: (sy - m * sx) / n };
}

function linearSSR(xs, ys) {
  const { m, b } = linearFit(xs, ys);
  return ys.reduce((s, y, i) => s + Math.pow(y - (m * xs[i] + b), 2), 0);
}

function fitPoly(xs, ys, degree) {
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const xRange = (xMax - xMin) || 1;
  const xn = xs.map(x => (x - xMin) / xRange);
  const n = degree + 1, N = xs.length;

  // Build normal equations [A|rhs]
  const A = Array.from({ length: n }, () => Array(n + 1).fill(0));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      for (let i = 0; i < N; i++) A[r][c] += Math.pow(xn[i], r + c);
    }
    for (let i = 0; i < N; i++) A[r][n] += Math.pow(xn[i], r) * ys[i];
  }

  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let maxR = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[r][col]) > Math.abs(A[maxR][col])) maxR = r;
    }
    [A[col], A[maxR]] = [A[maxR], A[col]];
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(A[col][col]) < 1e-14) continue;
      const f = A[r][col] / A[col][col];
      for (let j = col; j <= n; j++) A[r][j] -= f * A[col][j];
    }
  }

  // Back-substitution
  const c = Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    c[r] = A[r][n];
    for (let j = r + 1; j < n; j++) c[r] -= A[r][j] * c[j];
    if (Math.abs(A[r][r]) > 1e-14) c[r] /= A[r][r];
  }

  const evalFn = x => {
    const t = (x - xMin) / xRange;
    return c.reduce((sum, ci, i) => sum + ci * Math.pow(t, i), 0);
  };
  return { eval: evalFn, coeffs: c, xMin, xRange };
}

// ── Algorithm Implementations ────────────────────────────

function calcOBLA(steps) {
  const lt1 = interpolateAtLactate(steps, 2.0);
  const lt2 = interpolateAtLactate(steps, 4.0);
  return { lt1, lt2 };
}

function calcDmax(steps) {
  if (steps.length < 3) return { lt1: null, lt2: null };
  const xs = steps.map(s => s.intensity);
  const ys = steps.map(s => s.lactate);
  const poly = fitPoly(xs, ys, 3);
  // Use polynomial values at endpoints for a consistent reference line
  const x1 = xs[0], y1 = poly.eval(x1);
  const x2 = xs[xs.length - 1], y2 = poly.eval(x2);
  const N = 500;
  let maxDist = -Infinity, dmaxX = x1;
  for (let i = 0; i <= N; i++) {
    const x = x1 + (i / N) * (x2 - x1);
    const y = poly.eval(x);
    const d = perpDist(x, y, x1, y1, x2, y2);
    if (d > maxDist) { maxDist = d; dmaxX = x; }
  }
  const lt2 = interpolateAtIntensity(steps, dmaxX);
  if (lt2) lt2.lactate = poly.eval(dmaxX);
  return { lt1: null, lt2 };
}

function calcModDmax(steps) {
  if (steps.length < 3) return { lt1: null, lt2: null };
  const xs = steps.map(s => s.intensity);
  const ys = steps.map(s => s.lactate);
  const poly = fitPoly(xs, ys, 3);
  const baseline = baselineLactate(steps);
  const threshold = baseline + 0.4;
  const startIdx = steps.findIndex(s => s.lactate >= threshold);
  if (startIdx < 0) return { lt1: null, lt2: null };
  // Use polynomial values for consistent reference line
  const x1 = xs[startIdx], y1 = poly.eval(x1);
  const x2 = xs[xs.length - 1], y2 = poly.eval(x2);
  const N = 500;
  let maxDist = -Infinity, dmaxX = x1;
  for (let i = 0; i <= N; i++) {
    const x = x1 + (i / N) * (x2 - x1);
    const y = poly.eval(x);
    const d = perpDist(x, y, x1, y1, x2, y2);
    if (d > maxDist) { maxDist = d; dmaxX = x; }
  }
  const lt2 = interpolateAtIntensity(steps, dmaxX);
  if (lt2) lt2.lactate = poly.eval(dmaxX);
  return { lt1: null, lt2 };
}

function calcLogLog(steps) {
  if (steps.length < 4) return { lt1: null, lt2: null };
  if (steps.some(s => s.lactate <= 0 || s.intensity <= 0)) return { lt1: null, lt2: null };
  const logX = steps.map(s => Math.log(s.intensity));
  const logY = steps.map(s => Math.log(s.lactate));
  const n = logX.length;
  let bestK = -1, bestSSR = Infinity;
  for (let k = 2; k <= n - 2; k++) {
    const ssr1 = linearSSR(logX.slice(0, k), logY.slice(0, k));
    const ssr2 = linearSSR(logX.slice(k), logY.slice(k));
    const total = ssr1 + ssr2;
    if (total < bestSSR) { bestSSR = total; bestK = k; }
  }
  if (bestK < 0) return { lt1: null, lt2: null };
  const fit1 = linearFit(logX.slice(0, bestK), logY.slice(0, bestK));
  const fit2 = linearFit(logX.slice(bestK), logY.slice(bestK));
  // Intersection: m1*x + b1 = m2*x + b2 => x = (b2 - b1) / (m1 - m2)
  const denom = fit1.m - fit2.m;
  if (Math.abs(denom) < 1e-12) return { lt1: null, lt2: null };
  const logXBreak = (fit2.b - fit1.b) / denom;
  const lt2Intensity = Math.exp(logXBreak);
  const minI = steps[0].intensity, maxI = steps[n - 1].intensity;
  if (lt2Intensity < minI || lt2Intensity > maxI) return { lt1: null, lt2: null };
  const lt2 = interpolateAtIntensity(steps, lt2Intensity);
  return { lt1: null, lt2 };
}

function calcPlusOne(steps) {
  const baseline = baselineLactate(steps);
  const lt1 = interpolateAtLactate(steps, baseline + 1.0);
  const lt2 = interpolateAtLactate(steps, baseline + 1.5);
  return { lt1, lt2 };
}

// Roots of a*t^2 + b*t + c = 0 in [tMin, tMax], sorted ascending
function solveQuadraticInRange(a, b, c, tMin, tMax) {
  const roots = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t >= tMin && t <= tMax) roots.push(t);
    }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b + sq) / (2 * a);
      const t2 = (-b - sq) / (2 * a);
      if (t1 >= tMin && t1 <= tMax) roots.push(t1);
      if (t2 >= tMin && t2 <= tMax) roots.push(t2);
    }
  }
  roots.sort((a, b) => a - b);
  return roots;
}

// t in [tMin, tMax] where quadratic a*t^2 + b*t + c is maximized
function findMaxSecondDerivative(a, b, c, tMin, tMax) {
  const evalFn = t => a * t * t + b * t + c;
  let bestT = tMin, bestVal = evalFn(tMin);
  const valEnd = evalFn(tMax);
  if (valEnd > bestVal) { bestT = tMax; bestVal = valEnd; }
  if (Math.abs(a) > 1e-12) {
    const tv = -b / (2 * a);
    if (tv > tMin && tv < tMax) {
      const vv = evalFn(tv);
      if (vv > bestVal) { bestT = tv; }
    }
  }
  return bestT;
}

// Build L''(t) quadratic coefficients from a degree-4 poly's coeffs array.
function _ltpSecondDerivCoeffs(poly) {
  const c = poly.coeffs;
  return { qa: 12*(c[4]||0), qb: 6*(c[3]||0), qc: 2*(c[2]||0) };
}

// LTP L''(t)-max fallback: when L''(t)=0 roots are absent or land in the
// flat plateau, use the interior maximum of L''(t) — the point of greatest
// lactate acceleration.  No cross-method fallbacks (e.g. Dmax) are used;
// if L''(t)-max also fails the lactate threshold check, return null.
function _ltpLT2Fallback(steps, poly, qa, qb, qc, minLT2Lac) {
  const toX = t => poly.xMin + t * poly.xRange;
  const tMax = findMaxSecondDerivative(qa, qb, qc, 0.05, 0.95);
  const pt   = interpolateAtIntensity(steps, toX(tMax));
  if (pt && pt.lactate >= minLT2Lac) return pt;
  return null;
}

function calcInflection(steps) {
  try {
    if (steps.length < 5) return { lt1: null, lt2: null };
    const xs = steps.map(s => s.intensity);
    const ys = steps.map(s => s.lactate);
    const poly = fitPoly(xs, ys, 4);
    const { qa, qb, qc } = _ltpSecondDerivCoeffs(poly);
    const toX = t => poly.xMin + t * poly.xRange;

    // A threshold root is only accepted when its interpolated lactate lies
    // meaningfully above the initial plateau.  Relative thresholds avoid
    // spurious roots that land in the flat baseline region of hockey-stick
    // shaped curves.
    const lacMin    = Math.min(...ys);
    const lacRange  = Math.max(...ys) - lacMin;
    const minLT1Lac = lacMin + Math.max(0.2, 0.05 * lacRange);
    const minLT2Lac = lacMin + Math.max(0.5, 0.15 * lacRange);
    const fb        = () => _ltpLT2Fallback(steps, poly, qa, qb, qc, minLT2Lac);

    const roots = solveQuadraticInRange(qa, qb, qc, 0.05, 0.95);

    if (roots.length >= 2) {
      const pt1 = interpolateAtIntensity(steps, toX(roots[0]));
      const pt2 = interpolateAtIntensity(steps, toX(roots[1]));
      const separated = roots[1] - roots[0] >= 0.12;
      const lacDiff   = pt1 && pt2 && pt2.lactate - pt1.lactate >= 0.5;
      const lt1ok     = pt1 && pt1.lactate >= minLT1Lac;
      const lt2ok     = pt2 && pt2.lactate >= minLT2Lac;
      // Two well-separated roots with meaningful lactate span → accept both
      if (separated && lacDiff) return { lt1: pt1, lt2: pt2 };
      // Roots close together: accept each independently if it passes its threshold
      return {
        lt1: lt1ok ? pt1 : null,
        lt2: lt2ok ? pt2 : fb()
      };
    } else if (roots.length === 1) {
      const pt = interpolateAtIntensity(steps, toX(roots[0]));
      // Single root: could be LT1 or LT2 depending on lactate level
      if (pt && pt.lactate >= minLT2Lac) return { lt1: null, lt2: pt };
      if (pt && pt.lactate >= minLT1Lac) return { lt1: pt, lt2: fb() };
      return { lt1: null, lt2: fb() };
    }
    return { lt1: null, lt2: fb() };
  } catch (e) {
    return { lt1: null, lt2: null };
  }
}

// ── New individual-method algorithms ─────────────────────

function calcBaselinePlus04(steps) {
  const baseline = baselineLactate(steps);
  const lt1 = interpolateAtLactate(steps, baseline + 0.4);
  return { lt1, lt2: null };
}

function calcBaselinePlus10(steps) {
  const baseline = baselineLactate(steps);
  const lt1 = interpolateAtLactate(steps, baseline + 1.0);
  return { lt1, lt2: null };
}

function calcOBLACustom(steps) {
  var meta = LT2_METHODS.find(function (m) { return m.key === 'obla_custom'; });
  var threshold = (meta && meta.customThreshold) || 3.5;
  var lt2 = interpolateAtLactate(steps, threshold);
  return { lt1: null, lt2: lt2 };
}

function calcLTP1(steps) {
  try {
    if (steps.length < 5) return { lt1: null, lt2: null };
    const xs = steps.map(s => s.intensity);
    const ys = steps.map(s => s.lactate);
    const poly = fitPoly(xs, ys, 4);
    const { qa, qb, qc } = _ltpSecondDerivCoeffs(poly);
    const roots = solveQuadraticInRange(qa, qb, qc, 0.05, 0.95);
    if (roots.length < 2) return { lt1: null, lt2: null };
    const toX   = t => poly.xMin + t * poly.xRange;
    const pt1   = interpolateAtIntensity(steps, toX(roots[0]));
    const pt2   = interpolateAtIntensity(steps, toX(roots[1]));
    const lacMin    = Math.min(...ys);
    const lacRange  = Math.max(...ys) - lacMin;
    const minLT1Lac = lacMin + Math.max(0.2,  0.05 * lacRange);
    const minLT2Lac = lacMin + Math.max(0.5,  0.15 * lacRange);
    const separated = roots[1] - roots[0] >= 0.12;
    const lacDiff   = pt1 && pt2 && pt2.lactate - pt1.lactate >= 0.5;
    const lt1ok     = pt1 && pt1.lactate >= minLT1Lac;
    const lt2ok     = pt2 && pt2.lactate >= minLT2Lac;
    // Accept LT1 in two scenarios, aligned with calcInflection logic:
    // 1. Both roots clearly valid (well-separated with meaningful lactate gap)
    // 2. First root is above minLT1Lac threshold even when the second root
    //    does not form a clear LT2 — common for hockey-stick curves where
    //    both inflection points land near the transition zone.
    if (separated && lacDiff && lt1ok && lt2ok) {
      return { lt1: pt1, lt2: null };
    }
    if (lt1ok) {
      return { lt1: pt1, lt2: null };
    }
    return { lt1: null, lt2: null };
  } catch (e) {
    return { lt1: null, lt2: null };
  }
}

function calcLTP2(steps) {
  try {
    if (steps.length < 5) return { lt1: null, lt2: null };
    const xs = steps.map(s => s.intensity);
    const ys = steps.map(s => s.lactate);
    const poly = fitPoly(xs, ys, 4);
    const { qa, qb, qc } = _ltpSecondDerivCoeffs(poly);
    const toX       = t => poly.xMin + t * poly.xRange;
    const lacMin    = Math.min(...ys);
    const lacRange  = Math.max(...ys) - lacMin;
    const minLT2Lac = lacMin + Math.max(0.5, 0.15 * lacRange);
    const fb = () => _ltpLT2Fallback(steps, poly, qa, qb, qc, minLT2Lac);
    const roots = solveQuadraticInRange(qa, qb, qc, 0.05, 0.95);
    if (roots.length >= 2) {
      const pt1 = interpolateAtIntensity(steps, toX(roots[0]));
      const pt2 = interpolateAtIntensity(steps, toX(roots[1]));
      const separated = roots[1] - roots[0] >= 0.12;
      const lacDiff   = pt1 && pt2 && pt2.lactate - pt1.lactate >= 0.5;
      const lt2ok     = pt2 && pt2.lactate >= minLT2Lac;
      if (separated && lacDiff && lt2ok) return { lt1: null, lt2: pt2 };
      if (lt2ok)                         return { lt1: null, lt2: pt2 };
      return { lt1: null, lt2: fb() };
    } else if (roots.length === 1) {
      const pt = interpolateAtIntensity(steps, toX(roots[0]));
      if (pt && pt.lactate >= minLT2Lac) return { lt1: null, lt2: pt };
      return { lt1: null, lt2: fb() };
    }
    return { lt1: null, lt2: fb() };
  } catch (e) {
    return { lt1: null, lt2: null };
  }
}

function calcD2max(steps) {
  try {
    if (steps.length < 5) return { lt1: null, lt2: null };
    const xs = steps.map(s => s.intensity);
    const ys = steps.map(s => s.lactate);
    const poly = fitPoly(xs, ys, 4);
    const c = poly.coeffs;
    // L''(t) = 2*c[2] + 6*c[3]*t + 12*c[4]*t^2  — find its maximum in [0.05, 0.95]
    const qa = 12 * (c[4] || 0);
    const qb =  6 * (c[3] || 0);
    const qc =  2 * (c[2] || 0);
    const tMax = findMaxSecondDerivative(qa, qb, qc, 0.05, 0.95);
    const x = poly.xMin + tMax * poly.xRange;
    return { lt1: null, lt2: interpolateAtIntensity(steps, x) };
  } catch (e) {
    return { lt1: null, lt2: null };
  }
}

// ── Pace Conversion ──────────────────────────────────────

function paceToSpeed(paceStr) {
  // "MM:SS" -> km/h
  const parts = String(paceStr).trim().split(':');
  if (parts.length !== 2) return NaN;
  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);
  if (isNaN(minutes) || isNaN(seconds)) return NaN;
  const totalMinutes = minutes + seconds / 60;
  if (totalMinutes <= 0) return NaN;
  return 60 / totalMinutes;
}

function speedToPace(kmh) {
  // km/h -> "MM:SS /km"
  if (!kmh || kmh <= 0) return '—';
  const totalMinutes = 60 / kmh;
  const mins = Math.floor(totalMinutes);
  const secs = Math.round((totalMinutes - mins) * 60);
  if (secs === 60) return `${mins + 1}:00 /km`;
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

function formatIntensity(value) {
  if (value == null || isNaN(value)) return '—';
  if (state.sport === 'running') return speedToPace(value);
  return Math.round(value) + ' W';
}

// ── DOM Helpers ──────────────────────────────────────────

function showScreen(id) {
  document.getElementById('screen-input').classList.toggle('hidden', id !== 'input');
  document.getElementById('screen-results').classList.toggle('hidden', id !== 'results');
}

function showToast(message, type) {
  if (type === undefined) type = 'success';
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show ' + type;
  setTimeout(function () {
    toast.classList.remove('show');
  }, 3000);
}

function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.add('visible');
}

function clearError() {
  const el = document.getElementById('error-msg');
  el.textContent = '';
  el.classList.remove('visible');
}

// ── Sport ────────────────────────────────────────────────

function setSport(sport) {
  state.sport = sport;
  document.getElementById('btn-cycling').classList.toggle('active', sport === 'cycling');
  document.getElementById('btn-running').classList.toggle('active', sport === 'running');
  document.getElementById('intensity-header').textContent =
    sport === 'cycling' ? 'Teho (W)' : 'Vauhti (min/km)';
  if (state.steps.length === 0) {
    state.steps = [{}, {}, {}, {}, {}];
  }
  renderStepTable();
}

// ── Table Rendering ──────────────────────────────────────

function renderStepTable() {
  const tbody = document.getElementById('steps-tbody');
  tbody.innerHTML = '';
  state.steps.forEach(function (step, idx) {
    const tr = document.createElement('tr');

    // Col 1: number (no data-label, hidden on mobile)
    const tdNum = document.createElement('td');
    tdNum.className = 'col-num-cell';
    tdNum.innerHTML = '<span class="step-num">' + (idx + 1) + '</span>';
    tr.appendChild(tdNum);

    // Col 2: intensity
    const tdIntensity = document.createElement('td');
    tdIntensity.setAttribute('data-label', state.sport === 'running' ? 'Vauhti' : 'Teho');
    const intensityInp = document.createElement('input');
    if (state.sport === 'running') {
      intensityInp.type = 'text';
      intensityInp.placeholder = '5:30';
      if (step._paceStr != null) {
        intensityInp.value = step._paceStr;
      } else if (step.intensity && step.intensity > 0) {
        intensityInp.value = speedToPace(step.intensity).replace(' /km', '');
      } else {
        intensityInp.value = '';
      }
    } else {
      intensityInp.type = 'number';
      intensityInp.placeholder = '200';
      intensityInp.value = (step.intensity != null && step.intensity > 0) ? step.intensity : '';
    }
    intensityInp.dataset.field = 'intensity';
    intensityInp.dataset.idx = idx;
    tdIntensity.appendChild(intensityInp);
    tr.appendChild(tdIntensity);

    // Col 3: HR
    const tdHr = document.createElement('td');
    tdHr.setAttribute('data-label', 'Syke');
    const hrInp = document.createElement('input');
    hrInp.type = 'number';
    hrInp.placeholder = '150';
    hrInp.value = (step.hr != null && step.hr > 0) ? step.hr : '';
    hrInp.dataset.field = 'hr';
    hrInp.dataset.idx = idx;
    tdHr.appendChild(hrInp);
    tr.appendChild(tdHr);

    // Col 4: Lactate
    const tdLac = document.createElement('td');
    tdLac.setAttribute('data-label', 'Laktaatti');
    const lacInp = document.createElement('input');
    lacInp.type = 'number';
    lacInp.step = '0.1';
    lacInp.placeholder = '2.0';
    lacInp.value = (step.lactate != null && step.lactate > 0) ? step.lactate : '';
    lacInp.dataset.field = 'lactate';
    lacInp.dataset.idx = idx;
    tdLac.appendChild(lacInp);
    tr.appendChild(tdLac);

    // Col 5: Delete
    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.setAttribute('aria-label', 'Poista rivi');
    delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>';
    (function (capturedIdx) {
      delBtn.onclick = function () { removeStep(capturedIdx); };
    })(idx);
    tdDel.appendChild(delBtn);
    tr.appendChild(tdDel);

    tbody.appendChild(tr);
  });
}

function syncFromDOM() {
  const tbody = document.getElementById('steps-tbody');
  const rows = tbody.querySelectorAll('tr');
  const newSteps = [];
  rows.forEach(function (tr, idx) {
    const inputs = tr.querySelectorAll('input');
    const step = Object.assign({}, state.steps[idx] || {});
    inputs.forEach(function (inp) {
      const field = inp.dataset.field;
      if (!field) return;
      if (field === 'intensity') {
        if (state.sport === 'running') {
          const raw = inp.value.trim();
          step._paceStr = raw;
          const speed = paceToSpeed(raw);
          step.intensity = isNaN(speed) ? null : speed;
        } else {
          const v = parseFloat(inp.value);
          step.intensity = isNaN(v) ? null : v;
          delete step._paceStr;
        }
      } else if (field === 'hr') {
        const v = parseFloat(inp.value);
        step.hr = isNaN(v) ? null : v;
      } else if (field === 'lactate') {
        const v = parseFloat(inp.value);
        step.lactate = isNaN(v) ? null : v;
      }
    });
    newSteps.push(step);
  });
  state.steps = newSteps;
}

function addStep() {
  syncFromDOM();
  state.steps.push({});
  renderStepTable();
}

function removeStep(idx) {
  syncFromDOM();
  state.steps.splice(idx, 1);
  renderStepTable();
}

// ── Validation & Analysis ────────────────────────────────

function validateAndAnalyze() {
  syncFromDOM();
  clearError();

  const steps = state.steps;
  if (steps.length < 4) {
    showError('Tarvitaan vähintään 4 mittausaskelta.');
    return;
  }

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.intensity == null || isNaN(s.intensity) || s.intensity <= 0) {
      showError('Rivi ' + (i + 1) + ': Intensiteetti puuttuu tai on virheellinen.');
      return;
    }
    if (s.hr == null || isNaN(s.hr) || s.hr <= 0) {
      showError('Rivi ' + (i + 1) + ': Syke puuttuu tai on virheellinen.');
      return;
    }
    if (s.lactate == null || isNaN(s.lactate) || s.lactate <= 0) {
      showError('Rivi ' + (i + 1) + ': Laktaatti puuttuu tai on virheellinen.');
      return;
    }
  }

  const sorted = steps.slice().sort(function (a, b) { return a.intensity - b.intensity; });
  const wasReordered = sorted.some(function (s, i) { return s !== steps[i]; });
  if (wasReordered) {
    showToast('Rivit järjestetty nousevaan intensiteettijärjestykseen.', 'warning');
  }

  showScreen('results');
  showResults(sorted);
}

// ── Results ──────────────────────────────────────────────

function showResults(sortedSteps) {
  state.pairKey = 'obla';
  state.lt1Key  = null;
  state.lt2Key  = null;
  try {
    buildMethodSelectors(sortedSteps);
  } catch (e) {
    console.error('LT Analyzer: buildMethodSelectors failed:', e);
  }
  try {
    syncSelectorUI();
  } catch (e) {
    console.error('LT Analyzer: syncSelectorUI failed:', e);
  }
  computeAndDisplay(sortedSteps);
}

function buildMethodSelectors(sortedSteps) {
  const container = document.getElementById('method-selector');
  container.innerHTML = '';

  // ── Paired section ──
  const pairSection = document.createElement('div');
  pairSection.className = 'selector-section';
  const pairLabel = document.createElement('div');
  pairLabel.className = 'selector-section-label';
  pairLabel.textContent = 'Parimenetelmä — LT1 + LT2 yhdessä';
  pairSection.appendChild(pairLabel);
  const pairRow = document.createElement('div');
  pairRow.className = 'pair-options';
  PAIR_METHODS.forEach(function (m) {
    const btn = document.createElement('button');
    btn.className = 'selector-btn pair-option';
    btn.dataset.key = m.key;
    btn.textContent = m.label;
    btn.onclick = function () { setPairMethod(m.key, sortedSteps); };
    pairRow.appendChild(btn);
  });
  pairSection.appendChild(pairRow);
  container.appendChild(pairSection);

  // ── Individual section ──
  const indivSection = document.createElement('div');
  indivSection.className = 'selector-section';
  indivSection.id = 'individual-section';
  const indivLabel = document.createElement('div');
  indivLabel.className = 'selector-section-label';
  indivLabel.textContent = 'Yksittäiset menetelmät';
  indivSection.appendChild(indivLabel);

  const grid = document.createElement('div');
  grid.className = 'individual-grid';

  // LT1 column
  const lt1Col = document.createElement('div');
  lt1Col.className = 'individual-col';
  const lt1ColLabel = document.createElement('div');
  lt1ColLabel.className = 'individual-col-label lt1-col-label';
  lt1ColLabel.textContent = 'LT1 — Aerobinen kynnys';
  lt1Col.appendChild(lt1ColLabel);
  LT1_METHODS.forEach(function (m) {
    const btn = document.createElement('button');
    btn.className = 'selector-btn lt1-option';
    btn.dataset.key = m.key;
    btn.textContent = m.label;
    btn.onclick = function () { setLT1Method(m.key, sortedSteps); };
    lt1Col.appendChild(btn);
  });
  grid.appendChild(lt1Col);

  // LT2 column
  const lt2Col = document.createElement('div');
  lt2Col.className = 'individual-col';
  const lt2ColLabel = document.createElement('div');
  lt2ColLabel.className = 'individual-col-label lt2-col-label';
  lt2ColLabel.textContent = 'LT2 — Anaerobinen kynnys';
  lt2Col.appendChild(lt2ColLabel);
  LT2_METHODS.forEach(function (m) {
    const btn = document.createElement('button');
    btn.className = 'selector-btn lt2-option';
    btn.dataset.key = m.key;
    btn.textContent = m.label;
    btn.onclick = function () { setLT2Method(m.key, sortedSteps); };
    lt2Col.appendChild(btn);
    // Add slider for configurable OBLA
    if (m.key === 'obla_custom') {
      const sliderWrap = document.createElement('div');
      sliderWrap.className = 'obla-slider-wrap';
      sliderWrap.id = 'obla-slider-wrap';
      sliderWrap.style.display = 'none';
      sliderWrap.style.padding = '6px 0 4px';
      sliderWrap.style.fontSize = '0.82rem';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '2.0';
      slider.max = '6.0';
      slider.step = '0.5';
      slider.value = String(m.customThreshold || 3.5);
      slider.style.width = '100%';
      slider.id = 'obla-custom-slider';
      var valLabel = document.createElement('span');
      valLabel.id = 'obla-custom-val';
      valLabel.textContent = (m.customThreshold || 3.5).toFixed(1) + ' mmol/L';
      valLabel.style.fontWeight = '600';
      slider.oninput = function () {
        var v = parseFloat(slider.value);
        m.customThreshold = v;
        valLabel.textContent = v.toFixed(1) + ' mmol/L';
        btn.textContent = 'OBLA ' + v.toFixed(1) + ' mmol/L';
        if (state.lt2Key === 'obla_custom') computeAndDisplay(sortedSteps);
      };
      sliderWrap.appendChild(slider);
      sliderWrap.appendChild(valLabel);
      lt2Col.appendChild(sliderWrap);
    }
  });
  grid.appendChild(lt2Col);

  indivSection.appendChild(grid);
  container.appendChild(indivSection);
}

function syncSelectorUI() {
  const pairActive = state.pairKey !== null;

  document.querySelectorAll('.pair-option').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.key === state.pairKey);
  });
  document.querySelectorAll('.lt1-option').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.key === state.lt1Key);
  });
  document.querySelectorAll('.lt2-option').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.key === state.lt2Key);
  });

  const indivSection = document.getElementById('individual-section');
  if (indivSection) {
    indivSection.classList.toggle('individual-section--disabled', pairActive);
  }
  // Show/hide OBLA custom slider
  var sliderWrap = document.getElementById('obla-slider-wrap');
  if (sliderWrap) {
    sliderWrap.style.display = (state.lt2Key === 'obla_custom') ? '' : 'none';
  }
}

function setPairMethod(key, sortedSteps) {
  state.pairKey = key;
  state.lt1Key  = null;
  state.lt2Key  = null;
  syncSelectorUI();
  computeAndDisplay(sortedSteps);
}

function setLT1Method(key, sortedSteps) {
  state.lt1Key  = key;
  state.pairKey = null;
  syncSelectorUI();
  computeAndDisplay(sortedSteps);
}

function setLT2Method(key, sortedSteps) {
  state.lt2Key  = key;
  state.pairKey = null;
  syncSelectorUI();
  computeAndDisplay(sortedSteps);
}

function computeAndDisplay(sortedSteps) {
  if (!sortedSteps) {
    sortedSteps = state.steps.slice().sort(function (a, b) { return a.intensity - b.intensity; });
  }
  let result = { lt1: null, lt2: null };
  try {
    if (state.pairKey !== null) {
      const meta = PAIR_METHODS.find(function (m) { return m.key === state.pairKey; });
      if (meta) result = meta.calc(sortedSteps);
    } else {
      if (state.lt1Key !== null) {
        const m = LT1_METHODS.find(function (m) { return m.key === state.lt1Key; });
        if (m) result.lt1 = m.calc(sortedSteps).lt1;
      }
      if (state.lt2Key !== null) {
        const m = LT2_METHODS.find(function (m) { return m.key === state.lt2Key; });
        if (m) result.lt2 = m.calc(sortedSteps).lt2;
      }
    }
  } catch (e) { /* leave nulls */ }
  updateLtCards(result);
  try {
    renderChart(sortedSteps, result);
  } catch (e) {
    console.error('LT Analyzer: renderChart failed:', e);
  }
  updateMethodInfo();
  updateTrainingZones(sortedSteps);
  updateMethodComparison(sortedSteps);
  updateDataQuality(sortedSteps);
  updateFitQuality(sortedSteps);
}

function updateMethodInfo() {
  const nameEl = document.getElementById('info-name');
  const descEl = document.getElementById('info-desc');
  const refEl  = document.getElementById('info-ref');

  if (state.pairKey !== null) {
    const meta = PAIR_METHODS.find(function (m) { return m.key === state.pairKey; });
    if (meta) {
      nameEl.textContent = meta.label;
      descEl.textContent = meta.desc;
      refEl.textContent  = 'Viite: ' + meta.ref;
    }
  } else {
    const lt1meta = state.lt1Key ? LT1_METHODS.find(function (m) { return m.key === state.lt1Key; }) : null;
    const lt2meta = state.lt2Key ? LT2_METHODS.find(function (m) { return m.key === state.lt2Key; }) : null;
    const parts = [];
    if (lt1meta) parts.push(lt1meta.label);
    if (lt2meta) parts.push(lt2meta.label);
    nameEl.textContent = parts.length ? parts.join(' + ') : 'Valitse menetelmä';
    descEl.innerHTML = '';
    if (lt1meta) {
      const p = document.createElement('p');
      p.textContent = 'LT1 – ' + lt1meta.desc;
      descEl.appendChild(p);
    }
    if (lt2meta) {
      const p = document.createElement('p');
      p.textContent = 'LT2 – ' + lt2meta.desc;
      descEl.appendChild(p);
    }
    if (!lt1meta && !lt2meta) {
      descEl.textContent = 'Valitse LT1- ja/tai LT2-menetelmä yläpuolelta.';
    }
    const refs = [lt1meta && lt1meta.ref, lt2meta && lt2meta.ref].filter(Boolean);
    refEl.textContent = refs.length ? 'Viite: ' + refs.join(' | ') : '';
  }
}

function updateLtCards(result) {
  updateCard('lt1', result ? result.lt1 : null, 'Metodi ei laske LT1:tä');
  updateCard('lt2', result ? result.lt2 : null, 'Metodi ei laske LT2:ta');
}

function updateCard(which, point, naMsg) {
  const card = document.getElementById(which + '-card');
  const intensityEl = document.getElementById(which + '-intensity');
  const hrEl = document.getElementById(which + '-hr');
  const lacEl = document.getElementById(which + '-lac');

  if (point) {
    card.classList.remove('na');
    intensityEl.textContent = formatIntensity(point.intensity);
    hrEl.textContent = '\u2665 ' + Math.round(point.hr) + ' bpm';
    lacEl.textContent = '\u2248 ' + point.lactate.toFixed(2) + ' mmol/L';
  } else {
    card.classList.add('na');
    intensityEl.textContent = 'Ei saatavilla';
    hrEl.textContent = '';
    lacEl.textContent = naMsg;
  }
}

// ── R² (coefficient of determination) ───────────────────

function calcR2(xs, ys, evalFn) {
  var mean = ys.reduce(function (a, b) { return a + b; }, 0) / ys.length;
  var ssTot = ys.reduce(function (s, y) { return s + (y - mean) * (y - mean); }, 0);
  if (ssTot < 1e-14) return 1;
  var ssRes = xs.reduce(function (s, x, i) {
    var r = ys[i] - evalFn(x);
    return s + r * r;
  }, 0);
  return 1 - ssRes / ssTot;
}

function updateFitQuality(sortedSteps) {
  var section = document.getElementById('fit-quality-section');
  var wrap = document.getElementById('fit-quality-report');
  if (!sortedSteps || sortedSteps.length < 3) {
    section.style.display = 'none';
    return;
  }
  var xs = sortedSteps.map(function (s) { return s.intensity; });
  var ys = sortedSteps.map(function (s) { return s.lactate; });

  var poly3 = fitPoly(xs, ys, 3);
  var r2_3 = calcR2(xs, ys, poly3.eval);
  var items = [];
  items.push({ label: 'Kuutio (aste 3)', r2: r2_3 });

  if (sortedSteps.length >= 5) {
    var poly4 = fitPoly(xs, ys, 4);
    var r2_4 = calcR2(xs, ys, poly4.eval);
    items.push({ label: 'Kvartti (aste 4)', r2: r2_4 });
  }

  wrap.innerHTML = '';
  items.forEach(function (item) {
    var r2Pct = Math.max(0, Math.min(100, item.r2 * 100));
    var color = r2Pct >= 95 ? '#16a34a' : r2Pct >= 85 ? '#d97706' : '#dc2626';
    var div = document.createElement('div');
    div.style.marginBottom = '8px';
    div.innerHTML =
      '<div style="margin-bottom:2px">' + item.label + '</div>' +
      '<div class="r2-bar-wrap">' +
        '<div class="r2-bar"><div class="r2-bar-fill" style="width:' + r2Pct.toFixed(1) + '%;background:' + color + '"></div></div>' +
        '<span class="r2-value" style="color:' + color + '">R\u00b2 = ' + item.r2.toFixed(4) + '</span>' +
      '</div>';
    wrap.appendChild(div);
  });

  if (r2_3 < 0.85) {
    var warn = document.createElement('div');
    warn.className = 'quality-item';
    warn.innerHTML = '<span class="quality-icon quality-warn">\u26a0</span>' +
      '<span>Matala R\u00b2 viittaa siihen, ett\u00e4 polynomisovitus ei kuvaa dataa hyvin. Tuloksia kannattaa tulkita varovaisesti.</span>';
    wrap.appendChild(warn);
  }
  section.style.display = '';
}

// ── Data quality assessment ─────────────────────────────

function updateDataQuality(sortedSteps) {
  var section = document.getElementById('quality-section');
  var wrap = document.getElementById('quality-report');
  if (!sortedSteps || sortedSteps.length < 2) {
    section.style.display = 'none';
    return;
  }
  wrap.innerHTML = '';
  var items = [];
  var n = sortedSteps.length;

  // Step count
  if (n >= 8) {
    items.push({ icon: 'ok', text: 'Portaita: ' + n + ' \u2014 hyv\u00e4 m\u00e4\u00e4r\u00e4 luotettavaan analyysiin.' });
  } else if (n >= 5) {
    items.push({ icon: 'warn', text: 'Portaita: ' + n + ' \u2014 riitt\u00e4v\u00e4, mutta 8+ portaasta luotettavuus paranee.' });
  } else {
    items.push({ icon: 'err', text: 'Portaita: ' + n + ' \u2014 v\u00e4h\u00e4inen m\u00e4\u00e4r\u00e4. Polynomimenetelm\u00e4t (LTP, D2max) vaativat v\u00e4hint\u00e4\u00e4n 5 porrasta.' });
  }

  // Lactate range
  var lacMin = sortedSteps[0].lactate;
  var lacMax = sortedSteps[n - 1].lactate;
  var lacRange = lacMax - lacMin;
  if (lacRange >= 4.0) {
    items.push({ icon: 'ok', text: 'Laktaattialue: ' + lacMin.toFixed(1) + ' \u2013 ' + lacMax.toFixed(1) + ' mmol/L \u2014 riitt\u00e4v\u00e4 hajonta.' });
  } else if (lacRange >= 2.0) {
    items.push({ icon: 'warn', text: 'Laktaattialue: ' + lacMin.toFixed(1) + ' \u2013 ' + lacMax.toFixed(1) + ' mmol/L \u2014 kohtalainen hajonta. Korkeampi huippuarvo parantaisi tarkkuutta.' });
  } else {
    items.push({ icon: 'err', text: 'Laktaattialue: ' + lacMin.toFixed(1) + ' \u2013 ' + lacMax.toFixed(1) + ' mmol/L \u2014 kapea hajonta. Testi ei ehk\u00e4 jatkunut riitt\u00e4v\u00e4n pitk\u00e4\u00e4n kynnyksen yli.' });
  }

  // Monotonicity check
  var nonMono = 0;
  for (var i = 1; i < n; i++) {
    if (sortedSteps[i].lactate < sortedSteps[i - 1].lactate - 0.1) nonMono++;
  }
  if (nonMono === 0) {
    items.push({ icon: 'ok', text: 'Laktaattikurva nousee monotonisesti \u2014 normaali.' });
  } else {
    items.push({ icon: 'warn', text: nonMono + ' porras, jossa laktaatti laskee edellisest\u00e4. Tarkista mittausdatan oikeellisuus.' });
  }

  // Above 4.0 check (needed for OBLA)
  if (lacMax < 4.0) {
    items.push({ icon: 'warn', text: 'Laktaatti ei yll\u00e4 4.0 mmol/L:iin \u2014 OBLA 4.0 -menetelm\u00e4 ei voi laskea LT2:ta.' });
  }

  items.forEach(function (item) {
    var div = document.createElement('div');
    div.className = 'quality-item';
    div.innerHTML = '<span class="quality-icon quality-' + item.icon + '">' +
      (item.icon === 'ok' ? '\u2713' : item.icon === 'warn' ? '\u26a0' : '\u2717') +
      '</span><span>' + item.text + '</span>';
    wrap.appendChild(div);
  });
  section.style.display = '';
}

// ── Method comparison ───────────────────────────────────

function runAllMethods(sortedSteps) {
  var results = [];
  var allMethods = [].concat(
    PAIR_METHODS.map(function (m) { return { key: m.key, label: m.label, type: 'pair', calc: m.calc }; }),
    LT1_METHODS.map(function (m) { return { key: m.key, label: m.label, type: 'lt1', calc: m.calc }; }),
    LT2_METHODS.map(function (m) { return { key: m.key, label: m.label, type: 'lt2', calc: m.calc }; })
  );
  allMethods.forEach(function (m) {
    try {
      var r = m.calc(sortedSteps);
      results.push({
        key: m.key,
        label: m.label,
        type: m.type,
        lt1: r ? r.lt1 : null,
        lt2: r ? r.lt2 : null
      });
    } catch (e) {
      results.push({ key: m.key, label: m.label, type: m.type, lt1: null, lt2: null });
    }
  });
  return results;
}

function computeConsensus(allResults) {
  var lt1Vals = [], lt2Vals = [];
  var lt1HRs = [], lt2HRs = [];
  allResults.forEach(function (r) {
    if (r.lt1) { lt1Vals.push(r.lt1.intensity); lt1HRs.push(r.lt1.hr); }
    if (r.lt2) { lt2Vals.push(r.lt2.intensity); lt2HRs.push(r.lt2.hr); }
  });
  function median(arr) {
    if (!arr.length) return null;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  return {
    lt1: lt1Vals.length ? {
      median: median(lt1Vals),
      min: Math.min.apply(null, lt1Vals),
      max: Math.max.apply(null, lt1Vals),
      hrMedian: median(lt1HRs),
      count: lt1Vals.length
    } : null,
    lt2: lt2Vals.length ? {
      median: median(lt2Vals),
      min: Math.min.apply(null, lt2Vals),
      max: Math.max.apply(null, lt2Vals),
      hrMedian: median(lt2HRs),
      count: lt2Vals.length
    } : null
  };
}

function updateMethodComparison(sortedSteps) {
  var section = document.getElementById('comparison-section');
  var tableWrap = document.getElementById('comparison-table-wrap');
  var summaryEl = document.getElementById('consensus-summary');
  if (!sortedSteps || sortedSteps.length < 3) {
    section.style.display = 'none';
    return;
  }

  var allResults = runAllMethods(sortedSteps);
  var consensus = computeConsensus(allResults);

  // Determine active method key(s)
  var activeKeys = [];
  if (state.pairKey) activeKeys.push(state.pairKey);
  if (state.lt1Key) activeKeys.push(state.lt1Key);
  if (state.lt2Key) activeKeys.push(state.lt2Key);

  // Build table
  var html = '<table class="comparison-table">' +
    '<thead><tr><th>Menetelm\u00e4</th><th>LT1</th><th>LT2</th></tr></thead><tbody>';
  allResults.forEach(function (r) {
    var isActive = activeKeys.indexOf(r.key) >= 0;
    var rowClass = isActive ? ' class="comp-active"' : '';
    var lt1Str = r.lt1 ? '<span class="comp-lt1">' + formatIntensity(r.lt1.intensity) + '</span>' : '<span style="color:var(--subtle)">—</span>';
    var lt2Str = r.lt2 ? '<span class="comp-lt2">' + formatIntensity(r.lt2.intensity) + '</span>' : '<span style="color:var(--subtle)">—</span>';
    html += '<tr' + rowClass + '><td>' + r.label + '</td><td>' + lt1Str + '</td><td>' + lt2Str + '</td></tr>';
  });
  html += '</tbody></table>';
  tableWrap.innerHTML = html;

  // Consensus summary
  var parts = [];
  parts.push('<div class="consensus-label">Konsensus (mediaani kaikista menetelmist\u00e4)</div>');
  parts.push('<div class="consensus-row">');
  if (consensus.lt1) {
    parts.push('<span class="consensus-val lt1">LT1: ' + formatIntensity(consensus.lt1.median) +
      ' (\u2665 ' + Math.round(consensus.lt1.hrMedian) + ' bpm)</span>');
    parts.push('<span class="consensus-range">hajonta: ' + formatIntensity(consensus.lt1.min) +
      ' \u2013 ' + formatIntensity(consensus.lt1.max) + ' (' + consensus.lt1.count + ' menetelm\u00e4\u00e4)</span>');
  }
  if (consensus.lt2) {
    parts.push('<span class="consensus-val lt2">LT2: ' + formatIntensity(consensus.lt2.median) +
      ' (\u2665 ' + Math.round(consensus.lt2.hrMedian) + ' bpm)</span>');
    parts.push('<span class="consensus-range">hajonta: ' + formatIntensity(consensus.lt2.min) +
      ' \u2013 ' + formatIntensity(consensus.lt2.max) + ' (' + consensus.lt2.count + ' menetelm\u00e4\u00e4)</span>');
  }
  if (!consensus.lt1 && !consensus.lt2) {
    parts.push('<span style="color:var(--muted)">Ei riitt\u00e4v\u00e4sti tuloksia konsensusarvioon.</span>');
  }
  parts.push('</div>');
  summaryEl.innerHTML = parts.join('');
  section.style.display = '';
}

// ── Training zones ──────────────────────────────────────

function updateTrainingZones(sortedSteps) {
  var section = document.getElementById('zones-section');
  var wrap = document.getElementById('zones-table-wrap');

  // Compute consensus from all methods
  var allResults = runAllMethods(sortedSteps);
  var consensus = computeConsensus(allResults);

  if (!consensus.lt1 && !consensus.lt2) {
    section.style.display = 'none';
    return;
  }

  var zones = [];

  if (consensus.lt1 && consensus.lt2) {
    // 5-zone model from consensus medians
    var lt1I = consensus.lt1.median;
    var lt2I = consensus.lt2.median;
    var lt1HR = Math.round(consensus.lt1.hrMedian);
    var lt2HR = Math.round(consensus.lt2.hrMedian);
    zones = [
      { name: 'Vy\u00f6hyke 1 \u2014 Palautuminen', color: '#86efac', low: null, high: lt1I * 0.85, hrLow: null, hrHigh: Math.round(lt1HR * 0.85) },
      { name: 'Vy\u00f6hyke 2 \u2014 Peruskest\u00e4vyys', color: '#93c5fd', low: lt1I * 0.85, high: lt1I, hrLow: Math.round(lt1HR * 0.85), hrHigh: lt1HR },
      { name: 'Vy\u00f6hyke 3 \u2014 Tempo', color: '#fde047', low: lt1I, high: lt2I, hrLow: lt1HR, hrHigh: lt2HR },
      { name: 'Vy\u00f6hyke 4 \u2014 Kynnys', color: '#fdba74', low: lt2I, high: lt2I * 1.05, hrLow: lt2HR, hrHigh: Math.round(lt2HR * 1.05) },
      { name: 'Vy\u00f6hyke 5 \u2014 VO\u2082max', color: '#fca5a5', low: lt2I * 1.05, high: null, hrLow: Math.round(lt2HR * 1.05), hrHigh: null }
    ];
  } else if (consensus.lt2) {
    // 3-zone model (LT2 only)
    var lt2I2 = consensus.lt2.median;
    var lt2HR2 = Math.round(consensus.lt2.hrMedian);
    zones = [
      { name: 'Alle LT2', color: '#93c5fd', low: null, high: lt2I2, hrLow: null, hrHigh: lt2HR2 },
      { name: 'LT2-alue', color: '#fdba74', low: lt2I2, high: lt2I2 * 1.05, hrLow: lt2HR2, hrHigh: Math.round(lt2HR2 * 1.05) },
      { name: 'Yli LT2', color: '#fca5a5', low: lt2I2 * 1.05, high: null, hrLow: Math.round(lt2HR2 * 1.05), hrHigh: null }
    ];
  } else {
    // 3-zone model (LT1 only)
    var lt1I2 = consensus.lt1.median;
    var lt1HR2 = Math.round(consensus.lt1.hrMedian);
    zones = [
      { name: 'Alle LT1', color: '#86efac', low: null, high: lt1I2, hrLow: null, hrHigh: lt1HR2 },
      { name: 'LT1-alue', color: '#93c5fd', low: lt1I2, high: lt1I2 * 1.15, hrLow: lt1HR2, hrHigh: Math.round(lt1HR2 * 1.15) },
      { name: 'Yli LT1', color: '#fde047', low: lt1I2 * 1.15, high: null, hrLow: Math.round(lt1HR2 * 1.15), hrHigh: null }
    ];
  }

  var fmtRange = function (low, high) {
    if (!low && low !== 0) return '< ' + formatIntensity(high);
    if (!high && high !== 0) return '> ' + formatIntensity(low);
    return formatIntensity(low) + ' \u2013 ' + formatIntensity(high);
  };
  var fmtHR = function (low, high) {
    if (!low && low !== 0) return '< ' + high + ' bpm';
    if (!high && high !== 0) return '> ' + low + ' bpm';
    return low + ' \u2013 ' + high + ' bpm';
  };

  var html = '<table class="zones-table"><thead><tr><th>Vy\u00f6hyke</th><th>Intensiteetti</th><th>Syke</th></tr></thead><tbody>';
  zones.forEach(function (z) {
    html += '<tr><td><span class="zone-color" style="background:' + z.color + '"></span><span class="zone-name">' + z.name + '</span></td>';
    html += '<td>' + fmtRange(z.low, z.high) + '</td>';
    html += '<td>' + fmtHR(z.hrLow, z.hrHigh) + '</td></tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
  section.style.display = '';
}

// ── Chart ────────────────────────────────────────────────

function renderChart(steps, result) {
  if (state.chart) {
    state.chart.destroy();
    state.chart = null;
  }

  const xs = steps.map(function (s) { return s.intensity; });
  const ys = steps.map(function (s) { return s.lactate; });
  const minX = xs[0], maxX = xs[xs.length - 1];
  const maxY = Math.max.apply(null, ys) * 1.15;

  // Fitted polynomial curve
  const degree = steps.length >= 4 ? 3 : 1;
  let curveData = [];
  try {
    const poly = fitPoly(xs, ys, degree);
    const N = 150;
    for (let i = 0; i <= N; i++) {
      const x = minX + (i / N) * (maxX - minX);
      curveData.push({ x: x, y: poly.eval(x) });
    }
  } catch (e) {
    curveData = steps.map(function (s) { return { x: s.intensity, y: s.lactate }; });
  }

  const rawData = steps.map(function (s) { return { x: s.intensity, y: s.lactate }; });
  const hrData = steps.map(function (s) { return { x: s.intensity, y: s.hr }; });

  const datasets = [
    {
      label: 'Sovitettu käyrä',
      type: 'line',
      data: curveData,
      borderColor: 'rgba(37,99,235,0.35)',
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 2,
      tension: 0,
      order: 3,
      yAxisID: 'yLac'
    },
    {
      label: 'Laktaatti',
      type: 'scatter',
      data: rawData,
      showLine: true,
      borderColor: '#1e293b',
      backgroundColor: '#1e293b',
      pointRadius: 5,
      borderWidth: 2,
      tension: 0.3,
      order: 1,
      yAxisID: 'yLac'
    },
    {
      label: 'Syke',
      type: 'scatter',
      data: hrData,
      showLine: true,
      borderColor: '#94a3b8',
      backgroundColor: '#94a3b8',
      pointRadius: 3,
      borderWidth: 1.5,
      borderDash: [3, 3],
      tension: 0.3,
      order: 2,
      yAxisID: 'yHR'
    }
  ];

  if (result && result.lt1) {
    datasets.push({
      label: 'LT1',
      type: 'line',
      data: [
        { x: result.lt1.intensity, y: 0 },
        { x: result.lt1.intensity, y: maxY }
      ],
      borderColor: '#3b82f6',
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 2,
      borderDash: [6, 4],
      order: 0,
      yAxisID: 'yLac'
    });
  }

  if (result && result.lt2) {
    datasets.push({
      label: 'LT2',
      type: 'line',
      data: [
        { x: result.lt2.intensity, y: 0 },
        { x: result.lt2.intensity, y: maxY }
      ],
      borderColor: '#f97316',
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 2,
      borderDash: [6, 4],
      order: 0,
      yAxisID: 'yLac'
    });
  }

  if (typeof Chart === 'undefined') {
    console.error('LT Analyzer: Chart.js not loaded');
    return;
  }

  const isRunning = state.sport === 'running';
  const ctx = document.getElementById('lt-chart').getContext('2d');

  state.chart = new Chart(ctx, {
    type: 'scatter',
    data: { datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          labels: { boxWidth: 12, font: { size: 11 } }
        },
        tooltip: {
          callbacks: {
            title: function (items) {
              const x = items[0].parsed.x;
              return isRunning ? speedToPace(x) : Math.round(x) + ' W';
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: {
            display: true,
            text: isRunning ? 'Vauhti' : 'Teho (W)'
          },
          ticks: {
            callback: function (val) {
              return isRunning ? speedToPace(val) : val + ' W';
            }
          }
        },
        yLac: {
          type: 'linear',
          position: 'left',
          title: { display: true, text: 'Laktaatti (mmol/L)' },
          min: 0
        },
        yHR: {
          type: 'linear',
          position: 'right',
          title: { display: true, text: 'Syke (bpm)' },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// ── JSON Template Download ───────────────────────────────

function downloadTemplate() {
  var data;
  if (state.sport === 'running') {
    data = {
      sport: 'running',
      note: 'Juoksun laktaattitesti – täytä pace (MM:SS), syke ja laktaatti jokaiselle askeleelle.',
      steps: [
        { pace: '7:00', hr: 110, lactate: 1.2 },
        { pace: '6:30', hr: 125, lactate: 1.4 },
        { pace: '6:00', hr: 138, lactate: 1.7 },
        { pace: '5:30', hr: 150, lactate: 2.1 },
        { pace: '5:00', hr: 162, lactate: 2.9 },
        { pace: '4:30', hr: 173, lactate: 4.2 },
        { pace: '4:00', hr: 183, lactate: 6.8 }
      ]
    };
  } else {
    data = {
      sport: 'cycling',
      note: 'Pyöräilyn laktaattitesti – täytä teho (W), syke ja laktaatti jokaiselle askeleelle.',
      steps: [
        { power: 100, hr: 110, lactate: 1.2 },
        { power: 130, hr: 125, lactate: 1.4 },
        { power: 160, hr: 138, lactate: 1.7 },
        { power: 190, hr: 150, lactate: 2.1 },
        { power: 220, hr: 162, lactate: 2.9 },
        { power: 250, hr: 173, lactate: 4.2 },
        { power: 280, hr: 183, lactate: 6.8 }
      ]
    };
  }

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lt-template-' + state.sport + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── JSON Upload ──────────────────────────────────────────

function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      loadFromJSON(data);
    } catch (err) {
      showToast('Virhe JSON-tiedoston lukemisessa.', 'error');
    }
  };
  reader.readAsText(file);
  // Reset so the same file can be re-uploaded
  event.target.value = '';
}

function loadFromJSON(data) {
  if (!data || !Array.isArray(data.steps) || data.steps.length === 0) {
    showToast('JSON-tiedosto ei sisällä kelvollisia askeleita.', 'error');
    return;
  }

  const sport = data.sport === 'running' ? 'running' : 'cycling';
  state.sport = sport;
  document.getElementById('btn-cycling').classList.toggle('active', sport === 'cycling');
  document.getElementById('btn-running').classList.toggle('active', sport === 'running');
  document.getElementById('intensity-header').textContent =
    sport === 'cycling' ? 'Teho (W)' : 'Vauhti (min/km)';

  state.steps = data.steps.map(function (s) {
    const step = {};
    if (sport === 'running') {
      const paceStr = String(s.pace || '');
      step._paceStr = paceStr;
      const speed = paceToSpeed(paceStr);
      step.intensity = isNaN(speed) ? null : speed;
    } else {
      const v = Number(s.power);
      step.intensity = isNaN(v) ? null : v;
    }
    step.hr = s.hr ? Number(s.hr) : null;
    step.lactate = s.lactate ? Number(s.lactate) : null;
    return step;
  });

  renderStepTable();
  showToast('JSON ladattu onnistuneesti.', 'success');
}

// ── Init ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  setSport('cycling');
  showScreen('input');
});
