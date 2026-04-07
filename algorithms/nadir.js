/* =========================================================
   algorithms/nadir.js
   Primaarialgo (analyzeLactateTest) + Nadir-segmenttialgoritmi (v4).
   Nämä ovat täysin itsenäisiä eivätkä riipu shared.js:stä.
   Exporttaa globaalit: calcNadirBreakpoint
   ========================================================= */

'use strict';

// ── Primaarialgo (lactatetest_v3) ────────────────────────

function analyzeLactateTest(points) {
  const data = points.slice()
    .filter(function (p) {
      return Number.isFinite(p && p.speed) && Number.isFinite(p && p.lactate);
    })
    .sort(function (a, b) { return a.speed - b.speed; });

  if (data.length < 6) {
    throw new Error('Tarvitaan vahintaan 6 validia pistetta.');
  }

  const lt1Candidate = findLt1Candidate(data);
  const lt2Candidate = findLt2Candidate(data);

  return {
    lt1: buildThresholdResult(data, lt1Candidate, 'LT1'),
    lt2: buildThresholdResult(data, lt2Candidate, 'LT2'),
    debug: {
      lt1Candidate: lt1Candidate,
      lt2Candidate: lt2Candidate
    }
  };
}

function findLt1Candidate(points) {
  const candidates = [];
  const minSpeed = points[0].speed;
  const maxSpeed = points[points.length - 1].speed;
  const speedRange = (maxSpeed - minSpeed) || 1;

  for (let a = 0; a < points.length; a++) {
    for (const alen of [3, 4]) {
      if (a + alen > points.length) continue;

      const leftWindow = points.slice(a, a + alen);
      const leftLine = fitSimpleLine(leftWindow);

      for (let b = 0; b < points.length; b++) {
        for (const blen of [3, 4]) {
          if (b + blen > points.length) continue;

          const rightWindow = points.slice(b, b + blen);
          const rightLine = fitSimpleLine(rightWindow);

          if (rightLine.m <= leftLine.m) continue;

          const x = intersectSimpleLines(leftLine, rightLine);
          if (!Number.isFinite(x)) continue;

          const minX = points[a].speed;
          const maxX = points[b + blen - 1].speed;
          if (x < minX || x > maxX) continue;

          const xNorm = (x - minSpeed) / speedRange;
          if (xNorm > 0.55) continue;

          const y = interpolateYAtX(points, x, 'lactate');
          if (!Number.isFinite(y)) continue;

          const gain = rightLine.m - leftLine.m;
          const score =
            0.5 * (leftLine.sse + rightLine.sse) +
            0.5 * Math.abs(leftLine.m) +
            1.0 * Math.abs(xNorm - 0.22) -
            0.2 * gain +
            0.1 * y;

          candidates.push({
            score: score,
            x: x,
            y: y,
            leftSlope: leftLine.m,
            rightSlope: rightLine.m,
            leftWindow: { start: a, end: a + alen - 1 },
            rightWindow: { start: b, end: b + blen - 1 }
          });
        }
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error('LT1-ehdokasta ei loytynyt.');
  }

  return candidates.reduce(function (best, candidate) {
    return candidate.score < best.score ? candidate : best;
  });
}

function findLt2Candidate(points) {
  const candidates = [];
  const minSpeed = points[0].speed;
  const maxSpeed = points[points.length - 1].speed;
  const speedRange = (maxSpeed - minSpeed) || 1;

  for (let a = 0; a < points.length; a++) {
    const alen = 2;
    if (a + alen > points.length) continue;

    const leftWindow = points.slice(a, a + alen);
    const leftLine = fitSimpleLine(leftWindow);
    const end = a + alen - 1;

    for (let b = Math.max(0, end - 1); b <= Math.min(points.length - 1, end + 1); b++) {
      for (const blen of [2, 3]) {
        if (b + blen > points.length) continue;

        const rightWindow = points.slice(b, b + blen);
        const rightLine = fitSimpleLine(rightWindow);

        if (rightLine.m <= leftLine.m) continue;

        const x = intersectSimpleLines(leftLine, rightLine);
        if (!Number.isFinite(x)) continue;

        const minX = points[a].speed;
        const maxX = points[b + blen - 1].speed;
        if (x < minX || x > maxX) continue;

        const xNorm = (x - minSpeed) / speedRange;
        if (xNorm < 0.45) continue;

        const y = interpolateYAtX(points, x, 'lactate');
        if (!Number.isFinite(y)) continue;

        const gain = rightLine.m - leftLine.m;
        const gap = b - end;
        const gapPenalty = Math.max(0, gap) + 0.6 * Math.max(0, -gap);
        const score =
          2.0 * Math.abs(xNorm - 0.58) +
          0.5 * Math.abs(leftLine.m - 1.4) -
          0.05 * gain +
          0.2 * gapPenalty +
          0.05 * Math.abs(y - 6.2);

        candidates.push({
          score: score,
          x: x,
          y: y,
          leftSlope: leftLine.m,
          rightSlope: rightLine.m,
          leftWindow: { start: a, end: a + alen - 1 },
          rightWindow: { start: b, end: b + blen - 1 }
        });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error('LT2-ehdokasta ei loytynyt.');
  }

  return candidates.reduce(function (best, candidate) {
    return candidate.score < best.score ? candidate : best;
  });
}

function buildThresholdResult(points, candidate, label) {
  const speed = candidate.x;
  const lactate = interpolateYAtX(points, speed, 'lactate');
  const hr = hasFiniteKey(points, 'hr')
    ? interpolateYAtX(points, speed, 'hr')
    : null;

  return {
    label: label,
    speed: round1(speed),
    lactate: round1(lactate),
    hr: hr === null ? null : Math.round(hr),
    rawSpeed: round3(speed),
    rawLactate: round3(lactate),
    rawHr: hr === null ? null : round3(hr)
  };
}

function fitSimpleLine(points) {
  const n = points.length;
  const xs = points.map(function (p) { return p.speed; });
  const ys = points.map(function (p) { return p.lactate; });

  const meanX = xs.reduce(function (sum, value) { return sum + value; }, 0) / n;
  const meanY = ys.reduce(function (sum, value) { return sum + value; }, 0) / n;

  let num = 0;
  let den = 0;

  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += Math.pow(xs[i] - meanX, 2);
  }

  const m = den === 0 ? 0 : num / den;
  const b = meanY - m * meanX;

  let sse = 0;
  for (let i = 0; i < n; i++) {
    const pred = m * xs[i] + b;
    sse += Math.pow(ys[i] - pred, 2);
  }

  return { m: m, b: b, sse: sse };
}

function intersectSimpleLines(line1, line2) {
  const denom = line1.m - line2.m;
  if (Math.abs(denom) < 1e-12) return NaN;
  return (line2.b - line1.b) / denom;
}

function interpolateYAtX(points, x, key) {
  if (x <= points[0].speed) return points[0][key] != null ? points[0][key] : NaN;
  if (x >= points[points.length - 1].speed) {
    return points[points.length - 1][key] != null ? points[points.length - 1][key] : NaN;
  }

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    if (x >= a.speed && x <= b.speed) {
      if (!Number.isFinite(a[key]) || !Number.isFinite(b[key])) return NaN;

      const t = (x - a.speed) / (b.speed - a.speed);
      return a[key] + t * (b[key] - a[key]);
    }
  }

  return NaN;
}

function hasFiniteKey(points, key) {
  return points.some(function (p) { return Number.isFinite(p[key]); });
}

function round1(x) {
  return Number(x.toFixed(1));
}

function round3(x) {
  return Number(x.toFixed(3));
}

function convertPrimaryThreshold(point) {
  if (!point) return null;
  return {
    intensity: Number.isFinite(point.rawSpeed) ? point.rawSpeed : point.speed,
    lactate: Number.isFinite(point.rawLactate) ? point.rawLactate : point.lactate,
    hr: Number.isFinite(point.rawHr) ? point.rawHr : point.hr
  };
}

function analyzePrimaryAlgorithm(sortedSteps) {
  const points = sortedSteps.map(function (step) {
    return {
      speed: step.intensity,
      lactate: step.lactate,
      hr: step.hr
    };
  });

  const analyzed = analyzeLactateTest(points);
  return {
    lt1: convertPrimaryThreshold(analyzed.lt1),
    lt2: convertPrimaryThreshold(analyzed.lt2),
    debug: analyzed.debug || null
  };
}

// ── Nadir-Breakpoint Algorithm (v4) ─────────────────────
// LT1: nadir-anchored breakpoint in early curve
// LT2: local breakpoint in latter half, slope-distribution guided

function fitLineSegment(points) {
  const n = points.length;
  const xs = points.map(function (p) { return p.speed; });
  const ys = points.map(function (p) { return p.lactate; });
  const meanX = xs.reduce(function (a, b) { return a + b; }, 0) / n;
  const meanY = ys.reduce(function (a, b) { return a + b; }, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += Math.pow(xs[i] - meanX, 2);
  }
  const m = den === 0 ? NaN : num / den;
  const b = meanY - m * meanX;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    sse += Math.pow(ys[i] - (m * xs[i] + b), 2);
  }
  return { m: m, b: b, sse: sse };
}

function slopeBetween(a, b) {
  const dx = b.speed - a.speed;
  if (Math.abs(dx) < 1e-12) return NaN;
  return (b.lactate - a.lactate) / dx;
}

function uniqueInts(arr) {
  return arr.filter(function (x, i, self) {
    return Number.isInteger(x) && self.indexOf(x) === i;
  });
}

function findEarlyNadirIndex(points, lookahead) {
  const n = Math.min(lookahead || 4, points.length);
  let minIdx = 0;
  let minVal = points[0].lactate;
  for (let i = 1; i < n; i++) {
    if (points[i].lactate < minVal) {
      minVal = points[i].lactate;
      minIdx = i;
    }
  }
  return minIdx;
}

function estimateEarlySlope(base) {
  if (base.length >= 3) return slopeBetween(base[0], base[2]);
  return slopeBetween(base[0], base[1]);
}

function computeStepSlopes(points) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) {
    out.push(slopeBetween(points[i], points[i + 1]));
  }
  return out;
}

function makeNadirLt1Window(base, nadirIndex, leftLen, rightStart, rightLen) {
  if (leftLen < 2 || rightStart < 1 || rightLen < 2) return null;
  if (leftLen > base.length) return null;
  if (rightStart + rightLen > base.length) return null;

  const leftWindow = base.slice(0, leftLen);
  const rightWindow = base.slice(rightStart, rightStart + rightLen);
  const leftLine = fitLineSegment(leftWindow);
  const rightLine = fitLineSegment(rightWindow);

  if (!Number.isFinite(leftLine.m) || !Number.isFinite(rightLine.m)) return null;
  if (rightLine.m <= leftLine.m + 0.05) return null;

  const rawSpeed = intersectSimpleLines(leftLine, rightLine);
  if (!Number.isFinite(rawSpeed)) return null;

  const minAllowed = base[0].speed;
  const maxAllowed = rightWindow[rightWindow.length - 1].speed;
  if (rawSpeed < minAllowed || rawSpeed > maxAllowed) return null;

  return {
    rawSpeed: rawSpeed,
    nadirIndex: nadirIndex,
    leftLen: leftLen,
    rightStart: rightStart,
    rightLen: rightLen,
    leftSlope: leftLine.m,
    rightSlope: rightLine.m,
    gain: rightLine.m - leftLine.m,
    sse: leftLine.sse + rightLine.sse
  };
}

function findNadirLt1(points) {
  const nadirIndex = findEarlyNadirIndex(points, 4);
  const base = points.slice(nadirIndex);

  if (base.length < 5) throw new Error('LT1: liian vähän pisteitä nadirin jälkeen.');

  const earlySlope = estimateEarlySlope(base);

  const preferredLeftLen = earlySlope <= 0.45 ? 3 : 2;
  const preferredRightStart = 1;
  const preferredRightLen = earlySlope <= 0.20 ? 5 : earlySlope <= 0.45 ? 4 : 3;

  const preferred = makeNadirLt1Window(base, nadirIndex, preferredLeftLen, preferredRightStart, preferredRightLen);
  if (preferred) return preferred;

  let best = null;

  const leftLens = uniqueInts([2, 3, preferredLeftLen]);
  const rightStarts = uniqueInts([1, 2, preferredRightStart]);
  const rightLens = uniqueInts([3, 4, 5, preferredRightLen]);

  for (let li = 0; li < leftLens.length; li++) {
    for (let ri = 0; ri < rightStarts.length; ri++) {
      for (let rli = 0; rli < rightLens.length; rli++) {
        const c = makeNadirLt1Window(base, nadirIndex, leftLens[li], rightStarts[ri], rightLens[rli]);
        if (!c) continue;

        const score =
          2.0 * c.sse +
          0.50 * Math.abs(c.leftSlope) +
          0.25 * Math.abs(leftLens[li] - preferredLeftLen) +
          0.20 * Math.abs(rightStarts[ri] - preferredRightStart) +
          0.12 * Math.abs(rightLens[rli] - preferredRightLen) -
          0.15 * c.gain;

        if (!best || score < best.score) {
          best = { candidate: c, score: score };
        }
      }
    }
  }

  if (!best) throw new Error('LT1:tä ei voitu määrittää.');
  return best.candidate;
}

function findLateLocalLt2(points) {
  const slopes = computeStepSlopes(points);
  const lateSlopes = slopes.slice(Math.floor(slopes.length / 2));
  const lateSorted = lateSlopes.slice().sort(function (a, b) { return a - b; });
  const leftSlopeTarget = lateSorted.length >= 2 ? lateSorted[1] : lateSorted[0];

  let best = null;

  for (let a = 0; a < points.length; a++) {
    const leftLen = 2;
    if (a + leftLen > points.length) continue;

    const leftEnd = a + leftLen - 1;
    const leftWindow = points.slice(a, a + leftLen);
    const leftLine = fitLineSegment(leftWindow);

    const bMin = Math.max(0, leftEnd - 1);
    const bMax = Math.min(points.length - 1, leftEnd + 1);

    for (let b = bMin; b <= bMax; b++) {
      for (const rightLen of [2, 3]) {
        if (b + rightLen > points.length) continue;

        const rightWindow = points.slice(b, b + rightLen);
        const rightLine = fitLineSegment(rightWindow);

        if (rightLine.m <= leftLine.m) continue;

        const rawSpeed = intersectSimpleLines(leftLine, rightLine);
        if (!Number.isFinite(rawSpeed)) continue;

        const minAllowed = points[a].speed;
        const maxAllowed = points[b + rightLen - 1].speed;
        if (rawSpeed < minAllowed || rawSpeed > maxAllowed) continue;

        const xNorm =
          (rawSpeed - points[0].speed) /
          ((points[points.length - 1].speed - points[0].speed) || 1);

        if (xNorm < 0.45) continue;

        const gain = rightLine.m - leftLine.m;
        const gap = b - leftEnd;
        const gapPenalty = Math.max(0, gap) + 0.6 * Math.max(0, -gap);

        const score =
          0.5 * (leftLine.sse + rightLine.sse) +
          Math.abs(xNorm - 0.58) +
          0.05 * gapPenalty -
          0.05 * gain +
          0.2 * Math.abs(leftLine.m - leftSlopeTarget);

        if (!best || score < best.score) {
          best = {
            rawSpeed: rawSpeed,
            score: score
          };
        }
      }
    }
  }

  if (!best) throw new Error('LT2:tä ei voitu määrittää.');
  return best;
}

function buildNadirThresholdResult(points, rawSpeed, label) {
  const lactate = interpolateYAtX(points, rawSpeed, 'lactate');
  const hr = hasFiniteKey(points, 'hr') ? interpolateYAtX(points, rawSpeed, 'hr') : null;
  return {
    label: label,
    speed: round1(rawSpeed),
    lactate: round1(lactate),
    hr: hr === null ? null : Math.round(hr),
    rawSpeed: round3(rawSpeed),
    rawLactate: round3(lactate),
    rawHr: hr === null ? null : round3(hr)
  };
}

function analyzeNadirBreakpoint(points) {
  const data = points.slice()
    .filter(function (p) { return Number.isFinite(p.speed) && Number.isFinite(p.lactate); })
    .sort(function (a, b) { return a.speed - b.speed; });

  if (data.length < 6) throw new Error('Tarvitaan vähintään 6 validia pistettä.');

  const lt1Candidate = findNadirLt1(data);
  const lt2Candidate = findLateLocalLt2(data);

  return {
    lt1: buildNadirThresholdResult(data, lt1Candidate.rawSpeed, 'LT1'),
    lt2: buildNadirThresholdResult(data, lt2Candidate.rawSpeed, 'LT2')
  };
}

function calcNadirBreakpoint(steps) {
  try {
    const points = steps.map(function (step) {
      return { speed: step.intensity, lactate: step.lactate, hr: step.hr };
    });
    const result = analyzeNadirBreakpoint(points);
    return {
      lt1: convertPrimaryThreshold(result.lt1),
      lt2: convertPrimaryThreshold(result.lt2)
    };
  } catch (e) {
    return { lt1: null, lt2: null };
  }
}
