/* =========================================================
   algorithms/baseline.js
   Baseline + vakio -menetelmät (LT1).
   Riippuvuudet (globaalit shared.js:stä): baselineLactate, interpolateAtLactate
   ========================================================= */

'use strict';

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
