/* =========================================================
   algorithms/loglog.js
   Log-Log -menetelmä (LT2).
   Riippuvuudet (globaalit shared.js:stä): linearFit, linearSSR, interpolateAtIntensity
   ========================================================= */

'use strict';

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
