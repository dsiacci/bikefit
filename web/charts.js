// Charts as SVG strings, so the page and the downloaded report draw the same
// thing. Colors come from CSS classes (see styles.css and report.js); only
// numbers computed by the measurement go into the markup.

const W = 640, H = 300;
const M = { top: 18, right: 18, bottom: 44, left: 52 };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function niceStep(span, target = 5) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

function yScale(lo, hi) {
  const step = niceStep(hi - lo);
  const y0 = Math.floor(lo / step) * step, y1 = Math.ceil(hi / step) * step;
  const ph = H - M.top - M.bottom;
  return { y0, y1, step, y: (v) => M.top + ph * (1 - (v - y0) / (y1 - y0)) };
}

function yAxis(s, unit) {
  let out = '';
  for (let v = s.y0; v <= s.y1 + 1e-9; v += s.step) {
    const y = s.y(v).toFixed(1);
    out += `<line class="c-grid" x1="${M.left}" x2="${W - M.right}" y1="${y}" y2="${y}"/>`;
    out += `<text class="c-tick" x="${M.left - 8}" y="${y}" text-anchor="end" dominant-baseline="middle">${esc(Math.round(v * 10) / 10)}${esc(unit)}</text>`;
  }
  return out;
}

/**
 * A quantity against crank angle over one stroke: median line, interquartile
 * band, optional published range drawn at the bottom of the stroke.
 */
export function curveChart({ crankDeg, median, q1, q3, unit = '°', label, range = null, id = '' }) {
  const finite = [...q1, ...q3, ...median].filter(Number.isFinite);
  if (range) finite.push(range.low, range.high);
  const s = yScale(Math.min(...finite) - 2, Math.max(...finite) + 2);
  const pw = W - M.left - M.right;
  const x = (deg) => M.left + (pw * deg) / 360;
  const pts = (arr) => arr.map((v, i) => (Number.isFinite(v) ? `${x(crankDeg[i]).toFixed(1)},${s.y(v).toFixed(1)}` : null)).filter(Boolean);
  const band = [...pts(q3), ...pts(q1).reverse()].join(' ');
  let xt = '';
  for (const [deg, name] of [[0, 'top 0°'], [90, '90°'], [180, 'bottom 180°'], [270, '270°'], [360, '360°']]) {
    xt += `<line class="c-axis" x1="${x(deg)}" x2="${x(deg)}" y1="${H - M.bottom}" y2="${H - M.bottom + 5}"/>`;
    xt += `<text class="c-tick" x="${x(deg)}" y="${H - M.bottom + 18}" text-anchor="middle">${esc(name)}</text>`;
  }
  let rangeMark = '';
  if (range) {
    const ya = s.y(range.high), yb = s.y(range.low);
    rangeMark = `<rect class="c-range" x="${x(180) - 7}" y="${ya.toFixed(1)}" width="14" height="${(yb - ya).toFixed(1)}" rx="3"/>`
      + `<text class="c-note" x="${x(180) + 12}" y="${(ya - 6).toFixed(1)}">published range</text>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" data-chart="curve" data-id="${esc(id)}">
<rect class="c-surface" x="0" y="0" width="${W}" height="${H}" rx="6"/>
${yAxis(s, unit)}
<line class="c-axis" x1="${M.left}" x2="${W - M.right}" y1="${H - M.bottom}" y2="${H - M.bottom}"/>
${xt}
<text class="c-label" x="${M.left + pw / 2}" y="${H - 6}" text-anchor="middle">crank angle</text>
<polygon class="c-band" points="${band}"/>
${rangeMark}
<polyline class="c-line" points="${pts(median).join(' ')}"/>
<g class="c-hover" visibility="hidden"><line class="c-cross" x1="0" x2="0" y1="${M.top}" y2="${H - M.bottom}"/><circle class="c-dot" r="5" cx="0" cy="0"/></g>
<rect class="c-hit" x="${M.left}" y="${M.top}" width="${pw}" height="${H - M.top - M.bottom}" fill="transparent"/>
</svg>`;
}

/** One value per pedal stroke against time, with the median and an optional published range. */
export function strokeChart({ t, values, median, unit = '°', label, range = null, id = '' }) {
  const finite = values.filter(Number.isFinite);
  if (range) finite.push(range.low, range.high);
  const s = yScale(Math.min(...finite) - 1, Math.max(...finite) + 1);
  const t0 = t[0], t1 = t[t.length - 1];
  const pw = W - M.left - M.right;
  const x = (v) => M.left + (pw * (v - t0)) / Math.max(1e-9, t1 - t0);
  let xt = '';
  const step = niceStep(t1 - t0, 6);
  for (let v = Math.ceil(t0 / step) * step; v <= t1 + 1e-9; v += step) {
    xt += `<text class="c-tick" x="${x(v).toFixed(1)}" y="${H - M.bottom + 18}" text-anchor="middle">${esc(Math.round(v))} s</text>`;
  }
  let rangeBand = '';
  if (range) {
    const ya = s.y(Math.min(range.high, s.y1)), yb = s.y(Math.max(range.low, s.y0));
    rangeBand = `<rect class="c-range-band" x="${M.left}" y="${ya.toFixed(1)}" width="${pw}" height="${(yb - ya).toFixed(1)}"/>`
      + `<text class="c-note" x="${W - M.right - 4}" y="${(ya + 14).toFixed(1)}" text-anchor="end">published range</text>`;
  }
  const dots = values.map((v, i) => (Number.isFinite(v)
    ? `<circle class="c-point" cx="${x(t[i]).toFixed(1)}" cy="${s.y(v).toFixed(1)}" r="4"/>` : '')).join('');
  const ym = s.y(median).toFixed(1);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" data-chart="strokes" data-id="${esc(id)}">
<rect class="c-surface" x="0" y="0" width="${W}" height="${H}" rx="6"/>
${yAxis(s, unit)}
${rangeBand}
<line class="c-axis" x1="${M.left}" x2="${W - M.right}" y1="${H - M.bottom}" y2="${H - M.bottom}"/>
${xt}
<text class="c-label" x="${M.left + pw / 2}" y="${H - 6}" text-anchor="middle">time in the video</text>
<line class="c-median" x1="${M.left}" x2="${W - M.right}" y1="${ym}" y2="${ym}"/>
<text class="c-note" x="${M.left + 6}" y="${(+ym - 6).toFixed(1)}">median ${esc(Math.round(median * 10) / 10)}${esc(unit)}</text>
${dots}
<g class="c-hover" visibility="hidden"><line class="c-cross" x1="0" x2="0" y1="${M.top}" y2="${H - M.bottom}"/><circle class="c-dot" r="6" cx="0" cy="0"/></g>
<rect class="c-hit" x="${M.left}" y="${M.top}" width="${pw}" height="${H - M.top - M.bottom}" fill="transparent"/>
</svg>`;
}

/**
 * Crosshair and tooltip on a chart made by curveChart or strokeChart. `xs` and
 * `ys` are the plotted values, `text(i)` the tooltip lines for point i.
 */
export function attachHover(svg, { xs, ys, xToPlot, yToPlot, text, tooltip }) {
  const hover = svg.querySelector('.c-hover'), hit = svg.querySelector('.c-hit');
  const cross = hover.querySelector('.c-cross'), dot = hover.querySelector('.c-dot');
  const show = (evt) => {
    const box = svg.getBoundingClientRect();
    const px = ((evt.clientX - box.left) / box.width) * W;
    let best = -1, bd = Infinity;
    xs.forEach((v, i) => {
      if (!Number.isFinite(ys[i])) return;
      const d = Math.abs(xToPlot(v) - px);
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0) return;
    const X = xToPlot(xs[best]), Y = yToPlot(ys[best]);
    cross.setAttribute('x1', X); cross.setAttribute('x2', X);
    dot.setAttribute('cx', X); dot.setAttribute('cy', Y);
    hover.setAttribute('visibility', 'visible');
    tooltip.replaceChildren(...text(best).map((line, k) => {
      const el = document.createElement(k === 0 ? 'strong' : 'span');
      el.textContent = line;
      return el;
    }));
    tooltip.hidden = false;
    const tx = box.left + (X / W) * box.width, ty = box.top + (Y / H) * box.height;
    tooltip.style.left = `${Math.min(window.innerWidth - 180, tx + 12) + window.scrollX}px`;
    tooltip.style.top = `${ty - 12 + window.scrollY}px`;
  };
  const hide = () => { hover.setAttribute('visibility', 'hidden'); tooltip.hidden = true; };
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', hide);
}

/** The scales used by the charts above, for hover handlers. */
export function curveScales({ crankDeg, median, q1, q3, range = null }) {
  const finite = [...q1, ...q3, ...median].filter(Number.isFinite);
  if (range) finite.push(range.low, range.high);
  const s = yScale(Math.min(...finite) - 2, Math.max(...finite) + 2);
  const pw = W - M.left - M.right;
  return { x: (deg) => M.left + (pw * deg) / 360, y: s.y };
}

export function strokeScales({ t, values, range = null }) {
  const finite = values.filter(Number.isFinite);
  if (range) finite.push(range.low, range.high);
  const s = yScale(Math.min(...finite) - 1, Math.max(...finite) + 1);
  const t0 = t[0], t1 = t[t.length - 1];
  const pw = W - M.left - M.right;
  return { x: (v) => M.left + (pw * (v - t0)) / Math.max(1e-9, t1 - t0), y: s.y };
}

export const CHART_CSS = `
.chart { width: 100%; height: auto; display: block; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.c-surface { fill: var(--chart-surface); }
.c-grid { stroke: var(--chart-grid); stroke-width: 1; }
.c-axis { stroke: var(--chart-axis); stroke-width: 1; }
.c-tick { fill: var(--chart-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.c-label { fill: var(--chart-secondary); font-size: 12px; }
.c-note { fill: var(--chart-secondary); font-size: 12px; }
.c-band { fill: var(--series-1); fill-opacity: 0.12; stroke: none; }
.c-line { fill: none; stroke: var(--series-1); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.c-range { fill: var(--chart-range); stroke: var(--chart-axis); stroke-width: 1; }
.c-range-band { fill: var(--chart-range); fill-opacity: 0.55; }
.c-median { stroke: var(--chart-secondary); stroke-width: 1; }
.c-point { fill: var(--series-1); stroke: var(--chart-surface); stroke-width: 2; }
.c-cross { stroke: var(--chart-secondary); stroke-width: 1; }
.c-dot { fill: var(--series-1); stroke: var(--chart-surface); stroke-width: 2; }
`;
