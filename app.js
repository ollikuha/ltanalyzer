/* =========================================================
   LT Analyzer – app.js
   ========================================================= */

'use strict';

// ── State ────────────────────────────────────────────────
const state = {
  sport: 'cycling',
  steps: [],
  results: [],
  activeIdx: 0,
  chart: null
};

// ── Method metadata ──────────────────────────────────────
const METHOD_META = [
  {
    key: 'obla',
    label: 'OBLA',
    ref: 'Mader et al. (1976)',
    desc: 'Kiinteät laktaattikynnykset: LT1 = 2.0 mmol/L, LT2 = 4.0 mmol/L. Yksinkertaisin ja eniten käytetty menetelmä. Ei huomioi yksilöllisiä eroja vaan käyttää universaaleja raja-arvoja.',
    calc: calcOBLA
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
    label: 'Mod. Dmax',
    ref: 'Newell et al. (2007)',
    desc: 'Kuten Dmax, mutta referenssiviiva alkaa ensimmäisestä pisteestä, jossa laktaatti ylittää minimilaktaatin + 0.4 mmol/L. Vähemmän herkkä lepotason laktaattivaihtelulle.',
    calc: calcModDmax
  },
  {
    key: 'loglog',
    label: 'Log-Log',
    ref: 'Beaver et al. (1985)',
    desc: 'Muunnetaan data logaritmiasteikkoon (log laktaatti vs log intensiteetti). Kaksi lineaarista sovitusta löytävät katkokohdan, joka vastaa LT2:ta.',
    calc: calcLogLog
  },
  {
    key: 'plusone',
    label: '+1 Baseline',
    ref: 'Tegtbur et al. (1993)',
    desc: 'LT1 = minimilaktaatti + 1.0 mmol/L, LT2 = minimilaktaatti + 1.5 mmol/L. Suhteellinen menetelmä, joka huomioi yksilön peruslaktaatin.',
    calc: calcPlusOne
  },
  {
    key: 'inflection',
    label: 'Inflektio',
    ref: '2. derivaatta',
    desc: 'Polynomisovituksen (aste 4) toisen derivaatan nollakohdat antavat laktaattikäyrän taitekohtia, jotka vastaavat LT1:tä ja LT2:ta.',
    calc: calcInflection
  }
];

// ── Shared Math Utilities ────────────────────────────────

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
  const x1 = xs[0], y1 = ys[0];
  const x2 = xs[xs.length - 1], y2 = ys[ys.length - 1];
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
  const minLac = Math.min(...ys);
  const threshold = minLac + 0.4;
  const startIdx = steps.findIndex(s => s.lactate >= threshold);
  if (startIdx < 0) return { lt1: null, lt2: null };
  const x1 = xs[startIdx], y1 = ys[startIdx];
  const x2 = xs[xs.length - 1], y2 = ys[ys.length - 1];
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
  const baseline = Math.min(...steps.map(s => s.lactate));
  const lt1 = interpolateAtLactate(steps, baseline + 1.0);
  const lt2 = interpolateAtLactate(steps, baseline + 1.5);
  return { lt1, lt2 };
}

function calcInflection(steps) {
  try {
    if (steps.length < 5) return { lt1: null, lt2: null };
    const xs = steps.map(s => s.intensity);
    const ys = steps.map(s => s.lactate);
    const poly = fitPoly(xs, ys, 4);
    const c = poly.coeffs;
    // L(t) = c[0] + c[1]*t + c[2]*t^2 + c[3]*t^3 + c[4]*t^4
    // L''(t) = 2*c[2] + 6*c[3]*t + 12*c[4]*t^2
    const qa = 12 * (c[4] || 0);
    const qb = 6 * (c[3] || 0);
    const qc = 2 * (c[2] || 0);
    const roots = [];
    if (Math.abs(qa) < 1e-12) {
      // Linear case: qb*t + qc = 0
      if (Math.abs(qb) > 1e-12) {
        const t = -qc / qb;
        if (t >= 0.05 && t <= 0.95) roots.push(t);
      }
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-qb + sqrtDisc) / (2 * qa);
        const t2 = (-qb - sqrtDisc) / (2 * qa);
        if (t1 >= 0.05 && t1 <= 0.95) roots.push(t1);
        if (t2 >= 0.05 && t2 <= 0.95) roots.push(t2);
      }
    }
    roots.sort((a, b) => a - b);
    const toIntensity = t => poly.xMin + t * poly.xRange;
    if (roots.length >= 2) {
      return {
        lt1: interpolateAtIntensity(steps, toIntensity(roots[0])),
        lt2: interpolateAtIntensity(steps, toIntensity(roots[1]))
      };
    } else if (roots.length === 1) {
      return { lt1: null, lt2: interpolateAtIntensity(steps, toIntensity(roots[0])) };
    } else {
      return { lt1: null, lt2: null };
    }
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

  state.results = METHOD_META.map(function (m) {
    try {
      return m.calc(sorted);
    } catch (e) {
      return { lt1: null, lt2: null };
    }
  });

  showScreen('results');
  showResults(sorted);
}

// ── Results ──────────────────────────────────────────────

function showResults(sortedSteps) {
  state.activeIdx = 0;
  buildMethodPills(sortedSteps);
  setActiveMethod(0, sortedSteps);
}

function buildMethodPills(sortedSteps) {
  const container = document.getElementById('method-pills');
  container.innerHTML = '';
  METHOD_META.forEach(function (m, idx) {
    const btn = document.createElement('button');
    btn.className = 'pill' + (idx === state.activeIdx ? ' active' : '');
    btn.textContent = m.label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', idx === state.activeIdx ? 'true' : 'false');
    (function (capturedIdx) {
      btn.onclick = function () {
        state.activeIdx = capturedIdx;
        const sorted = state.steps.slice().sort(function (a, b) { return a.intensity - b.intensity; });
        buildMethodPills(sorted);
        setActiveMethod(capturedIdx, sorted);
      };
    })(idx);
    container.appendChild(btn);
  });
}

function setActiveMethod(idx, sortedSteps) {
  if (!sortedSteps) {
    sortedSteps = state.steps.slice().sort(function (a, b) { return a.intensity - b.intensity; });
  }
  const result = state.results[idx];
  const meta = METHOD_META[idx];

  updateLtCards(result);
  renderChart(sortedSteps, result);

  document.getElementById('info-name').textContent = meta.label;
  document.getElementById('info-desc').textContent = meta.desc;
  document.getElementById('info-ref').textContent = 'Viite: ' + meta.ref;
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
