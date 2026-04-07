/* =========================================================
   algorithms/d2max.js
   D2max-menetelmä: polynomisovituksen 2. derivaatan maksimi (LT2).
   Riippuvuudet (globaalit shared.js:stä):
     fitPoly, findMaxSecondDerivative, interpolateAtIntensity
   ========================================================= */

'use strict';

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
