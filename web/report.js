// The downloadable report: one self-contained HTML file with the numbers, the
// charts, the sources and the limits. No picture of the rider, no landmarks.

import { METRICS } from './core/analyze.js';
import { curveChart, strokeChart, CHART_CSS } from './charts.js';
import { saddleSentence, verdictSentence, verdictWord, fmt } from './text.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function buildReport(result, { appName, appUrl, date = new Date() } = {}) {
  const s = result.summary;
  const comparisons = Object.fromEntries(result.comparisons.map((c) => [c.metric, c]));
  const rows = METRICS.map((m) => {
    const v = s[m.key];
    const c = comparisons[m.key];
    return `<tr><th scope="row">${esc(m.label)}</th><td>${fmt(v.median, m.unit)}</td><td>${fmt(v.q1, m.unit)} to ${fmt(v.q3, m.unit)}</td>`
      + `<td>${c ? `${fmt(c.low, m.unit, 0)} to ${fmt(c.high, m.unit, 0)}` : 'none we could check'}</td>`
      + `<td>${c ? `${esc(c.evidence)}, ${esc(c.source.short)}` : ''}</td><td>${esc(verdictWord(c))}</td></tr>`;
  }).join('');
  const valid = result.perStroke.filter((r) => r.valid);
  const kneeComp = comparisons.kneeFlexBdc ?? null;
  const knee = curveChart({ ...result.curves.kneeBend, crankDeg: result.curves.crankDeg, label: 'Knee bend through the pedal stroke', range: kneeComp });
  const hip = curveChart({ ...result.curves.hip, crankDeg: result.curves.crankDeg, label: 'Hip angle through the pedal stroke' });
  const ankle = curveChart({ ...result.curves.ankle, crankDeg: result.curves.crankDeg, label: 'Ankle angle through the pedal stroke' });
  const strokes = strokeChart({
    t: valid.map((r) => r.t0), values: valid.map((r) => r.kneeFlexBdc), median: s.kneeFlexBdc.median,
    label: 'Knee bend at the bottom of each stroke', range: kneeComp,
  });
  const sources = [...new Map(result.comparisons.flatMap((c) => [c.source, c.source.also].filter(Boolean)).map((x) => [x.cite, x])).values()];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(appName)} report, ${esc(date.toISOString().slice(0, 10))}</title>
<style>
:root { --ink: #14212a; --muted: #56656d; --line: #d6dddf; --paper: #ffffff;
  --chart-surface: #fcfcfb; --chart-grid: #e1e0d9; --chart-axis: #c3c2b7; --chart-muted: #6f6d67; --chart-secondary: #52514e; --chart-range: #e4e2d8; --series-1: #2a78d6; }
body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); background: var(--paper); max-width: 760px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: 1.6rem; margin: 0 0 4px; } h2 { font-size: 1.15rem; margin: 28px 0 8px; }
.meta, .small { color: var(--muted); font-size: .9rem; }
.headline { font-size: 1.25rem; margin: 18px 0 4px; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: .92rem; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 8px 6px 0; text-align: left; vertical-align: top; }
thead th { color: var(--muted); font-weight: 600; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
${CHART_CSS}
</style></head><body>
<h1>${esc(appName)} report</h1>
<p class="meta">${esc(date.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }))} · video ${result.video.width}×${result.video.height}, ${fmt(result.video.fps, ' frames/s', 0)}, ${fmt(result.video.duration, ' s', 0)} · ${result.strokes.valid} clean pedal strokes of ${result.strokes.total} · crank ${result.settings.crankMm ? fmt(result.settings.crankMm, ' mm') : 'length not given'}</p>
<p class="headline">Knee bend at the bottom of the stroke: <strong>${fmt(s.kneeFlexBdc.median, '°')}</strong> (middle half of strokes ${fmt(s.kneeFlexBdc.q1, '°')} to ${fmt(s.kneeFlexBdc.q3, '°')}; 0° is a straight leg)</p>
<p>${esc(verdictSentence(kneeComp))}</p>
<p>${esc(saddleSentence(result.saddle, Boolean(result.settings.crankMm), result.calibration.method))}</p>
<h2>All measures</h2>
<table><thead><tr><th>Measure</th><th>Median</th><th>Middle half</th><th>Published range</th><th>Source</th><th>Verdict</th></tr></thead><tbody>${rows}</tbody></table>
<p class="small">Only the two knee ranges come from peer-reviewed measurements taken while pedalling. The other figures are book or manufacturer guidelines, shown for context: no validated range exists for those angles.</p>
<h2>Knee bend through the pedal stroke</h2>${knee}
<h2>Knee bend at the bottom, stroke by stroke</h2>${strokes}
<h2>Hip and ankle</h2><div class="grid2">${hip}${ankle}</div>
<h2>How the video was read</h2>
<p class="small">${result.sample ? 'Example: a synthetic rider computed by the page, no video and no pose model.' : `Pose model: MediaPipe Pose Landmarker (${esc(result.settings.model ?? 'full')}), run in the browser.`} Steady pedalling from ${fmt(result.steady.start, ' s', 1)} to ${fmt(result.steady.end, ' s', 1)}. Rider facing ${esc(result.side.facing)}; near leg labelled ${esc(result.side.nearLeg)} by the model. ${result.calibration.method === 'pedal-axle' ? `Pedal axle and crank circle found from the feet: fit error ${fmt(100 * result.calibration.circleFit, ' %', 1)} of the radius.` : 'Strokes cut on the loop of the ankle (pedal axle not located, no millimetres).'} Angles are medians over clean strokes; the middle half is the range between the first and third quartiles.</p>
${(result.warnings ?? []).map((w) => `<p class="small"><strong>Warning:</strong> ${esc(w)}</p>`).join('')}
<h2>Sources</h2>
<ul class="small">${sources.map((src) => `<li>${esc(src.cite)}${src.url ? ` <a href="${esc(src.url)}">${esc(src.url)}</a>` : ''}</li>`).join('') || '<li>No published range was available for these measures.</li>'}</ul>
<h2>Limits</h2>
<ul class="small">
<li>Side view only: nothing about how the knee tracks seen from the front, or about the feet and cleats.</li>
<li>A 2D pose model on a phone video is accurate to a few degrees, not to one degree.</li>
<li>Published ranges describe groups of riders. They are a starting point, not a target for you.</li>
<li>The result is valid for the bike in this video, set up as it was.</li>
<li>This is not medical advice. If something hurts, see a professional.</li>
</ul>
<p class="small">Made with ${esc(appName)}${appUrl ? `, ${esc(appUrl)}` : ''}. The video was analysed in the browser and never uploaded.</p>
</body></html>`;
}
