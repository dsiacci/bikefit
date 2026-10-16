// The layer drawn over the page while tools/demo.mjs records it: lower thirds,
// a highlight ring that follows its element, a cursor, full-screen cards, smooth
// scrolling and zooming. It is a manual popover, so it stays above the page's
// modal dialog (call raise() after a dialog opens). Never loaded by the page.

const CURSOR = '<svg viewBox="0 0 30 30" aria-hidden="true"><path d="M5 3 L5 25 L10.5 19.8 L14.4 28 L18.2 26.3 L14.4 18.4 L22 18.4 Z" fill="#f4f6f5" stroke="#1b2433" stroke-width="1.8" stroke-linejoin="round"/></svg>';

const root = document.createElement('div');
root.id = 'demo-overlay';
root.setAttribute('popover', 'manual');
root.innerHTML = `<div class="d-ring"></div><div class="d-card"></div><div class="d-lower"><div class="n"></div><div class="t"><div class="k"></div><div class="c"></div></div></div><div class="d-click"></div><div class="d-cursor">${CURSOR}</div>`;
document.documentElement.append(root);
root.showPopover();

const q = (sel) => root.querySelector(sel);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const el = (target) => (typeof target === 'string' ? document.querySelector(target) : target);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The ring follows its element every frame (scrolling, zooming, layout), and
// glides from one element to the next.
const ring = { node: q('.d-ring'), target: null, pad: 8, from: null, t0: 0, rect: null };
// A target is an element or a list of elements: the ring goes around all of them.
function rectOf(target, pad) {
  const rs = target.map((t) => t.getBoundingClientRect());
  const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top));
  const x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom));
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}
function tick(now) {
  if (ring.target) {
    const to = rectOf(ring.target, ring.pad);
    const k = ring.from ? ease(Math.min(1, (now - ring.t0) / 480)) : 1;
    const f = ring.from ?? to;
    const r = { x: f.x + (to.x - f.x) * k, y: f.y + (to.y - f.y) * k, w: f.w + (to.w - f.w) * k, h: f.h + (to.h - f.h) * k };
    ring.rect = r;
    Object.assign(ring.node.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

let cursorAt = [1150, 690];

window.demo = {
  raise() { root.hidePopover(); root.showPopover(); },

  async lower({ n = '', k = '', c = '' }) {
    const box = q('.d-lower');
    if (box.classList.contains('on')) { box.classList.remove('on'); await wait(300); }
    q('.d-lower .n').textContent = n;
    q('.d-lower .k').textContent = k;
    q('.d-lower .c').textContent = c;
    box.classList.add('on');
  },
  hideLower() { q('.d-lower').classList.remove('on'); },

  ring(target, pad = 8) {
    const t = (Array.isArray(target) ? target : [target]).map(el);
    ring.from = ring.target && ring.rect ? ring.rect : null;
    ring.t0 = performance.now();
    ring.target = t;
    ring.pad = pad;
    ring.node.classList.add('on');
  },
  hideRing() { ring.node.classList.remove('on'); ring.target = null; ring.rect = null; },

  showCursor() { q('.d-cursor').classList.add('on'); },
  hideCursor() { q('.d-cursor').classList.remove('on'); },
  /** Glide to an element's centre (or [x, y]); resolves with the point, in viewport pixels. */
  async cursorTo(target, ms = 800, dx = 0, dy = 0) {
    let x, y;
    if (Array.isArray(target)) [x, y] = target;
    else { const r = el(target).getBoundingClientRect(); x = r.left + r.width / 2 + dx; y = r.top + r.height / 2 + dy; }
    const c = q('.d-cursor');
    c.style.transitionDuration = `${ms}ms, 300ms`;
    c.style.transform = `translate(${x - 5}px, ${y - 3}px)`;
    cursorAt = [x, y];
    await wait(ms);
    return [x, y];
  },
  jump(x, y, ms = 60) { return this.cursorTo([x, y], ms); },
  click() {
    const fx = q('.d-click');
    fx.style.left = `${cursorAt[0]}px`;
    fx.style.top = `${cursorAt[1]}px`;
    fx.classList.remove('go');
    void fx.offsetWidth;
    fx.classList.add('go');
  },

  card(html, { instant = false } = {}) {
    const c = q('.d-card');
    c.classList.toggle('instant', instant);
    c.innerHTML = html;
    c.classList.add('on');
  },
  hideCard() { const c = q('.d-card'); c.classList.remove('instant'); c.classList.remove('on'); },
  reveal(step) { for (const n of root.querySelectorAll(`.d-card [data-step="${step}"]`)) n.classList.add('on'); },

  scrollTo(y, ms = 800) {
    const y0 = window.scrollY;
    const y1 = Math.max(0, Math.min(y, document.documentElement.scrollHeight - window.innerHeight));
    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        window.scrollTo(0, y0 + (y1 - y0) * ease(k));
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  },
  scrollToEl(target, top = 70, ms = 800) {
    return this.scrollTo(window.scrollY + el(target).getBoundingClientRect().top - top, ms);
  },

  /** Zoom the page so that the element's centre comes to the middle of the screen. */
  async zoom(target, scale = 1.6, ms = 900) {
    const body = document.body;
    body.style.transition = 'none';
    const prev = body.style.transform;
    body.style.transform = 'none';
    const r = el(target).getBoundingClientRect();
    body.style.transform = prev;
    void body.offsetWidth;
    const px = r.left + r.width / 2 + window.scrollX, py = r.top + r.height / 2 + window.scrollY;
    // Centre the element, but never uncover the space around the page.
    const doc = document.documentElement;
    const tx = clamp(window.innerWidth / 2 + window.scrollX - scale * px, window.innerWidth + window.scrollX - scale * doc.scrollWidth, window.scrollX);
    const ty = clamp(window.innerHeight / 2 + window.scrollY - scale * py, window.innerHeight + window.scrollY - scale * doc.scrollHeight, window.scrollY);
    body.style.transformOrigin = '0 0';
    body.style.transition = `transform ${ms}ms cubic-bezier(0.45, 0.05, 0.25, 1)`;
    body.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    await wait(ms);
  },
  async unzoom(ms = 800) {
    document.body.style.transition = `transform ${ms}ms cubic-bezier(0.45, 0.05, 0.25, 1)`;
    document.body.style.transform = 'translate(0px, 0px) scale(1)';
    await wait(ms);
  },
};
