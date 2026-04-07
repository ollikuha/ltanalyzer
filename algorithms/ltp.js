/* =========================================================
   algorithms/ltp.js
   LTP-menetelmät: polynomisovituksen 2. derivaatan nollakohdat.
   Riippuvuudet (globaalit shared.js:stä):
     fitPoly, _ltpSecondDerivCoeffs, _ltpLT2Fallback,
     solveQuadraticInRange, interpolateAtIntensity
   ========================================================= */

'use strict';

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
