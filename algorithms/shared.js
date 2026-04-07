/* =========================================================
   algorithms/shared.js
   Jaetut matematiikka-apufunktiot — ladataan ensimmäisenä.
   Kaikki muut algorithm-tiedostot käyttävät näitä globaaleina.
   ========================================================= */

'use strict';

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

// Coefficient of determination for a fitted model
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
