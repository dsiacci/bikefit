// The page: load the model, lock the network, read the video frame by frame,
// measure with core/analyze.js, show and export the results.

import { analyze, METRICS } from './core/analyze.js';
import { trackFromResults } from './core/landmarks.js';
import { loadLandmarker, extractPoses } from './pose.js';
import { lockNetwork, lockHolds } from './lock.js';
import { drawPreview, drawLoopFrame } from './skeleton.js';
import { curveChart, strokeChart, attachHover, curveScales, strokeScales } from './charts.js';
import { buildReport } from './report.js';
import { fmt, verdictSentence, saddleSentence } from './text.js';

const APP_NAME = 'bikefit';
const $ = (id) => document.getElementById(id);

const state = { phase: 'loading', progress: 0, frames: 0, result: null, error: null, model: null, delegate: null, locked: false, timings: {} };
let landmarker = null, selected = null, controller = null, lastTrack = null, loopTimer = 0;

// Hooks for the headless runner (tools/run-headless.mjs): the experiments in the
// README use this same page and this same code.
window.bikefit = {
  state,
  track: () => (lastTrack ? { width: lastTrack.width, height: lastTrack.height, t: Array.from(lastTrack.t), data: Array.from(lastTrack.data, (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)) } : null),
};

function setLock(kind, text) {
  $('lock').dataset.state = kind;
  $('lock-text').textContent = text;
}

function show(id) {
  for (const p of ['idle', 'progress', 'error']) $(p).hidden = p !== id;
}

function updateRunButton() {
  $('run').disabled = !(landmarker && selected && state.phase !== 'measuring');
}

async function init() {
  const params = new URLSearchParams(location.search);
  const variant = ['lite', 'full', 'heavy'].includes(params.get('model')) ? params.get('model') : 'full';
  $('model').value = variant;
  try {
    const t0 = performance.now();
    const loaded = await loadLandmarker({ variant, delegate: params.get('delegate') === 'CPU' ? 'CPU' : 'GPU' });
    landmarker = loaded.landmarker;
    state.model = loaded.variant;
    state.delegate = loaded.delegate;
    state.timings.loadMs = Math.round(performance.now() - t0);
    lockNetwork();
    state.locked = await lockHolds();
    setLock(state.locked ? 'locked' : 'error', state.locked
      ? 'Model loaded. Network locked: this page can no longer send anything, anywhere.'
      : 'Model loaded. This browser did not apply the network lock, but the page sends nothing.');
    state.phase = 'ready';
  } catch (err) {
    state.phase = 'failed';
    state.error = String(err?.message ?? err);
    setLock('error', 'The pose model could not load. Reload the page to try again.');
  }
  updateRunButton();
}

function choose(file) {
  if (!file) return;
  selected = file;
  $('drop-main').textContent = file.name;
  updateRunButton();
}

$('file').addEventListener('change', (e) => choose(e.target.files[0]));
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); choose(e.dataTransfer.files[0]); });
$('model').addEventListener('change', (e) => {
  // The network is locked once a model is loaded: another model means a fresh page.
  const url = new URL(location.href);
  url.searchParams.set('model', e.target.value);
  location.assign(url.href);
});
$('run').addEventListener('click', () => measure(selected));
$('stop').addEventListener('click', () => controller?.abort());
$('again').addEventListener('click', () => { show('idle'); $('file').click(); });

async function measure(file) {
  if (!file || !landmarker) return;
  const crankMm = Number($('crank').value) || null;
  const notchMm = Number($('notch').value) || null;
  const showFrame = $('show-frames').checked;
  state.phase = 'measuring';
  state.progress = 0;
  state.result = null;
  state.error = null;
  updateRunButton();
  $('results').hidden = true;
  show('progress');
  controller = new AbortController();
  const canvas = $('preview');
  const started = performance.now();
  try {
    const raw = await extractPoses(file, landmarker, {
      video: $('video'),
      signal: controller.signal,
      onFrame: ({ index, t, duration, landmarks, video }) => {
        state.progress = t / duration;
        state.frames = index + 1;
        $('bar').value = state.progress;
        const elapsed = (performance.now() - started) / 1000;
        const left = elapsed * (1 / Math.max(state.progress, 1e-3) - 1);
        $('progress-text').textContent = `${fmt(t, ' s', 1)} of ${fmt(duration, ' s', 1)} · ${fmt((index + 1) / elapsed, ' frames per second', 0)} · about ${fmt(Math.max(0, left) / 60, ' min', 1)} left`;
        drawPreview(canvas, landmarks, { video, showFrame, aspect: video.videoWidth / video.videoHeight });
      },
    });
    state.timings.extractMs = Math.round(performance.now() - started);
    $('progress-text').textContent = 'Measuring the strokes…';
    const track = trackFromResults(raw.width, raw.height, raw.frames);
    lastTrack = track;
    const result = analyze(track, { crankMm, notchMm });
    result.settings.model = state.model;
    result.settings.delegate = state.delegate;
    state.result = result;
    state.phase = 'done';
    render(result);
    show('idle');
  } catch (err) {
    if (err?.name === 'AbortError') {
      state.phase = 'ready';
      show('idle');
    } else {
      state.phase = 'error';
      state.error = String(err?.message ?? err);
      $('error-text').textContent = state.error;
      show('error');
    }
  } finally {
    controller = null;
    if (state.phase !== 'measuring') updateRunButton();
  }
}

function render(r) {
  const s = r.summary;
  const comps = Object.fromEntries(r.comparisons.map((c) => [c.metric, c]));
  $('knee-big').textContent = fmt(s.kneeBdc.median, '°');
  $('knee-spread').textContent = `Middle half of your strokes: ${fmt(s.kneeBdc.q1, '°')} to ${fmt(s.kneeBdc.q3, '°')}, over ${s.kneeBdc.n} clean strokes.`;
  const kc = comps.kneeBdc ?? null;
  $('knee-verdict').textContent = verdictSentence(kc);
  $('knee-verdict').dataset.v = kc ? kc.verdict : 'none';
  $('saddle-text').textContent = saddleSentence(r.saddle, Boolean(r.settings.crankMm));

  // Charts.
  const tip = $('tooltip');
  const curve = (key, el, label, range = null) => {
    const data = { ...r.curves[key], crankDeg: r.curves.crankDeg, range };
    $(el).innerHTML = curveChart({ ...data, label });
    const sc = curveScales(data);
    attachHover($(el).querySelector('svg'), {
      xs: r.curves.crankDeg, ys: data.median, xToPlot: sc.x, yToPlot: sc.y, tooltip: tip,
      text: (i) => [`${fmt(data.median[i], '°')}`, `${label.toLowerCase()} at ${fmt(r.curves.crankDeg[i], '°', 0)} of crank`, `middle half ${fmt(data.q1[i], '°')} to ${fmt(data.q3[i], '°')}`],
    });
  };
  curve('knee', 'chart-knee', 'Knee angle', kc);
  curve('hip', 'chart-hip', 'Hip angle');
  curve('ankle', 'chart-ankle', 'Ankle angle');
  const valid = r.perStroke.filter((x) => x.valid);
  const sdata = { t: valid.map((x) => x.t0), values: valid.map((x) => x.kneeBdc), median: s.kneeBdc.median, range: kc };
  $('chart-strokes').innerHTML = strokeChart({ ...sdata, label: 'Knee angle at the bottom of each stroke' });
  const ss = strokeScales(sdata);
  attachHover($('chart-strokes').querySelector('svg'), {
    xs: sdata.t, ys: sdata.values, xToPlot: ss.x, yToPlot: ss.y, tooltip: tip,
    text: (i) => [`${fmt(sdata.values[i], '°')}`, `stroke at ${fmt(sdata.t[i], ' s', 1)}`, `${fmt(valid[i].cadence, ' rpm', 0)}`],
  });

  // Table: every measure, the same numbers as the charts.
  const tbody = $('table').querySelector('tbody');
  tbody.replaceChildren(...METRICS.map((m) => {
    const tr = document.createElement('tr');
    const c = comps[m.key];
    const cells = [
      m.label,
      fmt(s[m.key].median, m.unit === '°' ? '°' : ` ${m.unit}`),
      `${fmt(s[m.key].q1, m.unit === '°' ? '°' : '')} to ${fmt(s[m.key].q3, m.unit === '°' ? '°' : '')}`,
      c ? `${fmt(c.low, '°', 0)} to ${fmt(c.high, '°', 0)} (${c.source.short})` : 'none we could check',
      c ? c.verdict : '',
    ];
    cells.forEach((text, k) => {
      const td = document.createElement(k === 0 ? 'th' : 'td');
      if (k === 0) td.scope = 'row';
      td.textContent = text;
      if (k === 4 && c) td.className = `v-${c.verdict}`;
      tr.append(td);
    });
    return tr;
  }));
  const sources = [...new Map(r.comparisons.map((c) => [c.source.short, c.source])).values()];
  $('sources').textContent = sources.length
    ? `Sources: ${sources.map((x) => x.cite).join(' · ')}`
    : 'No published range is shown yet: ranges appear here only with a source we could check.';

  // How the video was read.
  const q = [
    `Video ${r.video.width}×${r.video.height}, ${fmt(r.video.fps, ' frames per second', 0)}, ${fmt(r.video.duration, ' s', 0)}; ${r.video.frames} frames read by the model (${state.model}, ${state.delegate === 'GPU' ? 'graphics card' : 'processor'}) in ${fmt(state.timings.extractMs / 1000, ' s', 0)}.`,
    `Steady pedalling from ${fmt(r.steady.start, ' s', 1)} to ${fmt(r.steady.end, ' s', 1)}: ${r.strokes.valid} clean strokes out of ${r.strokes.total}.`,
    `Crank circle found from the feet; fit error ${fmt(100 * r.calibration.circleFit, ' %', 2)} of its radius.${r.calibration.mmPerPx ? ` Scale: ${fmt(r.calibration.mmPerPx, ' mm per pixel', 2)}.` : ''}`,
    `Rider facing ${r.side.facing}, near leg labelled ${r.side.nearLeg} by the model${r.side.labelSwitches ? `; left and right labels swapped ${r.side.labelSwitches} times and were corrected` : ''}.`,
  ];
  if (r.side.facing !== r.side.toesPoint) q.push('Warning: the toes and the pedalling direction disagree. Check that the video is not mirrored.');
  $('quality').replaceChildren(...q.map((line) => { const li = document.createElement('li'); li.textContent = line; return li; }));

  // One stroke on a loop, at half speed.
  cancelAnimationFrame(loopTimer);
  const loop = r.loop;
  if (loop && loop.frames.length) {
    const start = performance.now();
    const tick = (now) => {
      const i = Math.floor(((now - start) / 1000) * (loop.fps / 2)) % loop.frames.length;
      drawLoopFrame($('loop'), loop, i);
      loopTimer = requestAnimationFrame(tick);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) drawLoopFrame($('loop'), loop, Math.floor(loop.frames.length / 2));
    else loopTimer = requestAnimationFrame(tick);
  }

  $('dl-report').onclick = () => save(`${APP_NAME}-report-${new Date().toISOString().slice(0, 10)}.html`, buildReport(r, { appName: APP_NAME, appUrl: location.origin + location.pathname }), 'text/html');
  $('dl-json').onclick = () => save(`${APP_NAME}-numbers-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ ...r, loop: undefined }, null, 1), 'application/json');
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function save(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

init();
