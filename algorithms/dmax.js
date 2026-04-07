/* =========================================================
   algorithms/dmax.js
   Dmax ja Modified Dmax -menetelmät (LT2).
   Riippuvuudet (globaalit shared.js:stä):
     fitPoly, baselineLactate, perpDist, interpolateAtIntensity
   ========================================================= */

'use strict';

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
