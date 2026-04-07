/* =========================================================
   algorithms/obla.js
   OBLA-menetelmät (kiinteät ja mukautettavat laktaattikynnykset).
   Riippuvuudet (globaalit shared.js:stä): interpolateAtLactate
   calcOBLACustom lukee LT2_METHODS:sta ajon aikana (app.js).
   ========================================================= */

'use strict';

function calcOBLA(steps) {
  const lt1 = interpolateAtLactate(steps, 2.0);
  const lt2 = interpolateAtLactate(steps, 4.0);
  return { lt1, lt2 };
}

function calcOBLACustom(steps) {
  var meta = LT2_METHODS.find(function (m) { return m.key === 'obla_custom'; });
  var threshold = (meta && meta.customThreshold) || 3.5;
  var lt2 = interpolateAtLactate(steps, threshold);
  return { lt1: null, lt2: lt2 };
}
