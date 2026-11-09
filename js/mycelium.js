/*
 * motekaitis.net — mycelium family map
 *
 * Reads the <article class="family-unit"> elements on the page (they are the
 * data), lays them out by generation, and draws an ink-and-watercolor
 * mycelium network under a movable looking glass. No build step, no libraries.
 */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const XLINK = 'http://www.w3.org/1999/xlink';
  const mapEl = document.querySelector('[data-map]');
  const panel = document.getElementById('families');
  if (!mapEl || !panel || !document.createElementNS || !window.requestAnimationFrame) return;
  const articles = [...panel.querySelectorAll('article.family-unit[id]')];
  if (!articles.length) return;

  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAG = 1.3;           // lens magnification
  const ROW = 270;           // vertical distance between generations
  const GAP = 80;            // minimum space between neighbouring units

  /* ---------- small helpers ---------- */

  const f = n => Math.round(n * 10) / 10;
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) { // mulberry32: same drawing on every visit
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const text = (root, sel) => { const n = root.querySelector(sel); return n ? n.textContent.trim() : ''; };

  /* ---------- read the family units from the page ---------- */

  const units = new Map();
  articles.forEach((a, i) => {
    const people = [...a.querySelectorAll('[itemscope][itemtype$="/Person"]')].map(p => ({
      el: p,
      given: text(p, '[itemprop~="givenName"]') || text(p, '[itemprop~="name"]'),
      family: text(p, '[itemprop~="familyName"]'),
      parentUnits: new Set()
    }));
    units.set(a.id, { id: a.id, el: a, order: i, people, parents: new Set(), children: new Set(), x: 0, y: 0 });
  });
  const U = id => units.get(id);

  function unitOf(href) {
    if (!href || href.indexOf('#') === -1) return null;
    let id = href.slice(href.indexOf('#') + 1);
    try { id = decodeURIComponent(id); } catch (e) { /* keep raw */ }
    if (!id) return null;
    if (units.has(id)) return U(id);
    const target = document.getElementById(id);
    const art = target && target.closest('article.family-unit');
    return art ? U(art.id) : null;
  }

  units.forEach(u => {
    u.people.forEach(p => p.el.querySelectorAll('a[itemprop~="parent"]').forEach(a => {
      const pu = unitOf(a.getAttribute('href'));
      if (pu && pu !== u) { u.parents.add(pu.id); pu.children.add(u.id); p.parentUnits.add(pu.id); }
    }));
    u.el.querySelectorAll('a[itemprop~="children"]').forEach(a => {
      const c = unitOf(a.getAttribute('href'));
      if (c && c !== u) { u.children.add(c.id); c.parents.add(u.id); }
    });
  });

  units.forEach(u => {
    const nb = new Set([...u.parents, ...u.children]);
    u.parents.forEach(p => U(p).children.forEach(c => nb.add(c))); // siblings
    nb.delete(u.id);
    u.nb = nb;
    const given = u.people.map(p => p.given).filter(Boolean);
    const fams = [...new Set(u.people.map(p => p.family).filter(Boolean))];
    u.line1 = u.el.dataset.label || given.join(' & ') || u.id;
    u.line2 = u.el.dataset.label ? '' : fams.join(' · ');
    u.name = u.el.dataset.label || (u.el.querySelector('h2') ? u.el.querySelector('h2').textContent.trim() : u.line1);
  });

  function relation(from, to) {
    if (from.parents.has(to.id)) return to.people.length > 1 ? 'parents' : 'parent';
    if (from.children.has(to.id)) return 'child';
    return 'sibling';
  }

  /* ---------- layout: generations top to bottom ---------- */

  const gen = new Map();
  const genOf = (id, seen = new Set()) => {
    if (gen.has(id)) return gen.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    let v = 0;
    U(id).parents.forEach(p => { v = Math.max(v, genOf(p, seen) + 1); });
    gen.set(id, v);
    return v;
  };
  units.forEach(u => genOf(u.id));
  units.forEach(u => { // parentless units sit just above their children
    if (!u.parents.size && u.children.size) gen.set(u.id, Math.min(...[...u.children].map(c => gen.get(c))) - 1);
  });
  const minGen = Math.min(...gen.values());
  units.forEach(u => { u.gen = gen.get(u.id) - minGen; });

  const width = u => (u.people.length > 1 ? 200 : 140);
  const rows = [];
  units.forEach(u => { (rows[u.gen] = rows[u.gen] || []).push(u); });
  rows.forEach(r => {
    if (!r) return;
    r.sort((a, b) => a.order - b.order);
    let x = 0;
    r.forEach(u => { u.x = x; x += width(u) + GAP; });
    const shift = mean(r.map(u => u.x));
    r.forEach(u => { u.x -= shift; });
  });

  function place(row, desired) {
    row.sort((a, b) => (desired.get(a) - desired.get(b)) || (a.order - b.order));
    let prev = null;
    row.forEach(u => {
      let x = desired.get(u);
      if (prev) x = Math.max(x, prev.x + (width(prev) + width(u)) / 2 + GAP);
      u.x = x; prev = u;
    });
    const shift = mean(row.map(u => desired.get(u))) - mean(row.map(u => u.x));
    row.forEach(u => { u.x += shift; });
  }
  for (let it = 0; it < 10; it++) {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      place(r, new Map(r.map(u => [u, u.parents.size ? mean([...u.parents].map(p => U(p).x)) : u.x])));
    }
    for (let i = rows.length - 2; i >= 0; i--) {
      const r = rows[i]; if (!r) continue;
      place(r, new Map(r.map(u => [u, u.children.size ? (u.x + mean([...u.children].map(c => U(c).x))) / 2 : u.x])));
    }
  }

  units.forEach(u => { // a little hand-drawn irregularity
    const r = rng(hash(u.id));
    u.x += (r() - 0.5) * 50;
    u.y = u.gen * ROW + (r() - 0.5) * 70;
    const n = u.people.length;
    u.people.forEach((p, i) => { p.dx = (i - (n - 1) / 2) * 76; p.dy = i % 2 ? 5 : 0; });
    if (n === 2) { // put each spouse on the side of their own parents
      const px = p => (p.parentUnits.size ? mean([...p.parentUnits].map(id => U(id).x)) : null);
      const a = px(u.people[0]), b = px(u.people[1]);
      if (a !== null && b !== null && a > b) { const t = u.people[0].dx; u.people[0].dx = u.people[1].dx; u.people[1].dx = t; }
    }
  });

  const all = [...units.values()];
  const PAD = 340;
  const bounds = {
    x: Math.min(...all.map(u => u.x)) - PAD,
    y: Math.min(...all.map(u => u.y)) - PAD,
    x2: Math.max(...all.map(u => u.x)) + PAD,
    y2: Math.max(...all.map(u => u.y)) + PAD
  };
  bounds.w = bounds.x2 - bounds.x;
  bounds.h = bounds.y2 - bounds.y;

  /* ---------- drawing primitives ---------- */

  function smooth(pts) {
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(mx)} ${f(my)}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${f(l[0])} ${f(l[1])}`;
  }

  // A branching hypha. Paths are collected into buckets by thickness.
  function wisp(r, x, y, ang, len, depth, buckets) {
    const steps = Math.max(3, Math.round(len / 11));
    const pts = [[x, y, ang]];
    let a = ang, px = x, py = y;
    for (let i = 1; i <= steps; i++) {
      a += (r() - 0.5) * 0.55;
      px += Math.cos(a) * len / steps;
      py += Math.sin(a) * len / steps;
      pts.push([px, py, a]);
    }
    buckets[Math.min(depth, 2)] += smooth(pts);
    if (depth < 2) {
      const n = r() < 0.75 ? 1 + (r() < 0.4 ? 1 : 0) : 0;
      for (let k = 0; k < n; k++) {
        const p = pts[1 + Math.floor(r() * (steps - 1))];
        wisp(r, p[0], p[1], p[2] + (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.7), len * (0.3 + r() * 0.35), depth + 1, buckets);
      }
    }
  }
  function flush(buckets, parent, extra) {
    buckets.forEach((d, i) => { if (d) el('path', { d, class: `mg-ink mg-w${i}${extra ? ' ' + extra : ''}` }, parent); });
  }

  // A wavering cord from parent to child.
  function cord(x1, y1, x2, y2, amp, phase, N = 28) {
    const dy = y2 - y1, base = [];
    const c1x = x1, c1y = y1 + dy * 0.5, c2x = x2, c2y = y2 - dy * 0.5;
    for (let i = 0; i <= N; i++) {
      const t = i / N, m = 1 - t;
      base.push([
        m * m * m * x1 + 3 * m * m * t * c1x + 3 * m * t * t * c2x + t * t * t * x2,
        m * m * m * y1 + 3 * m * m * t * c1y + 3 * m * t * t * c2y + t * t * t * y2
      ]);
    }
    return base.map((p, i) => {
      const a = base[Math.max(0, i - 1)], b = base[Math.min(N, i + 1)];
      const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
      const t = i / N;
      const off = Math.sin(Math.PI * t) * (amp * Math.sin(t * 8.2 + phase) + amp * 0.45 * Math.sin(t * 19.5 + phase * 1.7));
      return [p[0] - ty / L * off, p[1] + tx / L * off, Math.atan2(ty, tx)];
    });
  }

  function blob(r, cx, cy, rad) {
    const n = 9, pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, rr = rad * (0.88 + r() * 0.22);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const s = mid(pts[n - 1], pts[0]);
    let d = `M${f(s[0])} ${f(s[1])}`;
    for (let i = 0; i < n; i++) {
      const m = mid(pts[i], pts[(i + 1) % n]);
      d += `Q${f(pts[i][0])} ${f(pts[i][1])} ${f(m[0])} ${f(m[1])}`;
    }
    return d + 'Z';
  }

  function sprig(parent, x, y, rot) {
    const g = el('g', { transform: `translate(${f(x)} ${f(y)}) rotate(${rot})` }, parent);
    el('path', { d: 'M0 0C18 6 42 8 84 2', class: 'mg-ink mg-w0' }, g);
    [14, 30, 46, 62, 78].forEach((t, i) => {
      const side = i % 2 ? 1 : -1, cy = (t / 84) * 3 + side * 7;
      el('ellipse', { cx: t, cy: f(cy), rx: 9, ry: 3.8, transform: `rotate(${side * -28} ${t} ${f(cy)})`, class: 'mg-leaf' }, g);
    });
  }

  /* ---------- build the SVG ---------- */

  const svg = el('svg', { class: 'map-svg', 'aria-hidden': 'true', focusable: 'false' });
  svg.innerHTML = `
    <defs>
      <radialGradient id="mg-bulb" cx="38%" cy="32%" r="70%">
        <stop offset="0" stop-color="#f6ebcd"/><stop offset=".6" stop-color="#dcc28c"/><stop offset="1" stop-color="#b48f57"/>
      </radialGradient>
      <radialGradient id="mg-moss"><stop offset="0" stop-color="#6e8750" stop-opacity=".42"/><stop offset=".55" stop-color="#7d9560" stop-opacity=".18"/><stop offset="1" stop-color="#7d9560" stop-opacity="0"/></radialGradient>
      <radialGradient id="mg-ochre"><stop offset="0" stop-color="#c0914a" stop-opacity=".4"/><stop offset=".55" stop-color="#c79c5a" stop-opacity=".16"/><stop offset="1" stop-color="#c79c5a" stop-opacity="0"/></radialGradient>
      <radialGradient id="mg-rust"><stop offset="0" stop-color="#a5603a" stop-opacity=".28"/><stop offset="1" stop-color="#a5603a" stop-opacity="0"/></radialGradient>
      <radialGradient id="mg-glass" r="50%">
        <stop offset="0" stop-color="#fffdf5" stop-opacity="0"/><stop offset=".82" stop-color="#5e7466" stop-opacity=".06"/>
        <stop offset=".95" stop-color="#3d4c42" stop-opacity=".22"/><stop offset="1" stop-color="#26302a" stop-opacity=".38"/>
      </radialGradient>
      <linearGradient id="mg-rim" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#f4f6ee"/><stop offset=".35" stop-color="#9aa596"/><stop offset=".55" stop-color="#e3e8dc"/><stop offset="1" stop-color="#55604f"/>
      </linearGradient>
      <radialGradient id="mg-shadow"><stop offset=".6" stop-color="#3a2810" stop-opacity=".32"/><stop offset="1" stop-color="#3a2810" stop-opacity="0"/></radialGradient>
      <clipPath id="mg-lens-clip"><circle id="mg-lens-clip-c" cx="0" cy="0" r="1"/></clipPath>
    </defs>`;

  const world = el('g', { id: 'mycelium-world' }, svg);

  // frame and corner sprigs
  const frame = el('g', {}, world);
  el('rect', { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h, rx: 4, class: 'mg-ink mg-frame-outer' }, frame);
  el('rect', { x: bounds.x + 9, y: bounds.y + 9, width: bounds.w - 18, height: bounds.h - 18, rx: 3, class: 'mg-ink mg-frame-inner' }, frame);
  sprig(frame, bounds.x + 20, bounds.y + 20, 38); sprig(frame, bounds.x + 20, bounds.y + 20, 58);
  sprig(frame, bounds.x2 - 20, bounds.y + 20, 142); sprig(frame, bounds.x2 - 20, bounds.y + 20, 122);
  sprig(frame, bounds.x2 - 20, bounds.y2 - 20, -142); sprig(frame, bounds.x2 - 20, bounds.y2 - 20, -122);
  sprig(frame, bounds.x + 20, bounds.y2 - 20, -38); sprig(frame, bounds.x + 20, bounds.y2 - 20, -58);

  // watercolor stains on the sheet
  const stains = el('g', { class: 'mg-stain' }, world);
  {
    const r = rng(hash('stains:' + all.length));
    const n = Math.max(6, Math.round(bounds.w * bounds.h / 260000));
    const fills = ['mg-ochre', 'mg-rust', 'mg-moss', 'mg-ochre'];
    for (let i = 0; i < n; i++) {
      el('ellipse', {
        cx: f(bounds.x + r() * bounds.w), cy: f(bounds.y + r() * bounds.h),
        rx: f(160 + r() * 260), ry: f(120 + r() * 200), fill: `url(#${fills[Math.floor(r() * 4)]})`
      }, stains);
    }
  }

  // ambient filaments and lichen across the whole sheet
  const ambient = el('g', { class: 'mg-ambient' }, world);
  {
    const r = rng(hash('ambient:' + all.length));
    const b = ['', '', ''];
    const count = Math.min(260, Math.round(bounds.w * bounds.h / 22000));
    for (let i = 0; i < count; i++) {
      const x = bounds.x + 30 + r() * (bounds.w - 60), y = bounds.y + 30 + r() * (bounds.h - 60);
      if (all.some(u => Math.hypot(u.x - x, u.y - y) < 120)) continue;
      wisp(r, x, y, r() * Math.PI * 2, 50 + r() * 130, 1, b);
    }
    flush(b, ambient);
    for (let i = 0; i < count / 10; i++) {
      el('circle', { cx: f(bounds.x + r() * bounds.w), cy: f(bounds.y + r() * bounds.h), r: f(3 + r() * 9), class: 'mg-lichen' }, ambient);
    }
  }

  // cords between parents and children
  const edgesG = el('g', {}, world);
  const edges = [];
  all.forEach(p => p.children.forEach(cid => {
    const c = U(cid);
    const r = rng(hash(p.id + '>' + cid));
    const g = el('g', { class: 'mg-edge' }, edgesG);
    const x1 = p.x, y1 = p.y + (p.people.length > 1 ? 10 : 22);
    const person = c.people.find(q => q.parentUnits.has(p.id));
    const x2 = c.x + (person ? person.dx : 0), y2 = c.y + (person ? person.dy : 0) - 21;
    const main = cord(x1, y1, x2, y2, 10 + r() * 10, r() * 6);
    el('path', { d: smooth(main), class: 'mg-ink mg-cord-halo' }, g);
    el('path', { d: smooth(main), class: 'mg-ink mg-cord-main' }, g);
    for (let s = 0; s < 2; s++) el('path', { d: smooth(cord(x1, y1, x2, y2, 6 + r() * 14, r() * 6)), class: 'mg-ink mg-cord-strand' }, g);
    const b = ['', '', ''];
    for (let k = 0; k < 5; k++) {
      const q = main[3 + Math.floor(r() * (main.length - 6))];
      wisp(r, q[0], q[1], q[2] + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.8), 30 + r() * 50, 1, b);
    }
    flush(b, g);
    edges.push({ a: p.id, b: cid, g });
  }));

  // the family units themselves
  const nodesG = el('g', {}, world);
  all.forEach(u => {
    const r = rng(hash(u.id + ':node'));
    const couple = u.people.length > 1;
    const g = el('g', { class: 'mg-node' }, nodesG);
    u.g = g;
    const washes = ['mg-moss', 'mg-ochre', 'mg-moss', 'mg-rust'];
    el('ellipse', { cx: f(u.x + (r() - 0.5) * 40), cy: f(u.y + 14 + (r() - 0.5) * 24), rx: couple ? 140 : 100, ry: 85, fill: `url(#${washes[Math.floor(r() * 3)]})` }, g);
    el('ellipse', { cx: f(u.x + (r() - 0.5) * 90), cy: f(u.y + (r() - 0.5) * 60), rx: 55 + r() * 30, ry: 40 + r() * 20, fill: `url(#${washes[1 + Math.floor(r() * 3)]})` }, g);

    const b = ['', '', ''];
    u.people.forEach(p => {
      const bx = u.x + p.dx, by = u.y + p.dy, n = couple ? 9 : 12;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + (r() - 0.5) * 0.5;
        wisp(r, bx + Math.cos(a) * 20, by + Math.sin(a) * 18, a, 45 + r() * 80, 0, b);
      }
    });
    flush(b, g);

    if (couple) {
      for (let i = 0; i < u.people.length - 1; i++) {
        const p = u.people[i], q = u.people[i + 1];
        const d = `M${f(u.x + p.dx)} ${f(u.y + p.dy)}Q${f(u.x + (p.dx + q.dx) / 2)} ${f(u.y + 9)} ${f(u.x + q.dx)} ${f(u.y + q.dy)}`;
        el('path', { d, class: 'mg-bridge-out' }, g);
        el('path', { d, class: 'mg-bridge-in' }, g);
      }
    }
    u.people.forEach(p => {
      const bx = u.x + p.dx, by = u.y + p.dy, rad = couple ? 19 : 22;
      el('path', { d: blob(r, bx, by, rad), class: 'mg-bulb', fill: 'url(#mg-bulb)' }, g);
      el('path', { d: `M${f(bx - rad * 0.55)} ${f(by - rad * 0.2)}Q${f(bx - rad * 0.45)} ${f(by - rad * 0.6)} ${f(bx - rad * 0.05)} ${f(by - rad * 0.62)}`, class: 'mg-bulb-shine' }, g);
      for (let k = 0; k < 3; k++) el('circle', { cx: f(bx + (r() - 0.3) * rad), cy: f(by + (r() - 0.2) * rad * 0.8), r: 1.1, class: 'mg-speck' }, g);
    });

    const label = el('text', { class: 'mg-label', x: f(u.x), y: f(u.y + 46), 'text-anchor': 'middle' }, g);
    el('tspan', { class: 'mg-label-given', x: f(u.x) }, label).textContent = u.line1;
    if (u.line2) el('tspan', { class: 'mg-label-family', x: f(u.x), dy: '1.25em' }, label).textContent = u.line2;
  });

  // the looking glass
  const lensShadow = el('ellipse', { class: 'lens-shadow', fill: 'url(#mg-shadow)' }, svg);
  const lens = el('g', { class: 'lens', 'clip-path': 'url(#mg-lens-clip)' }, svg);
  const lensPaper = el('circle', { class: 'lens-paper' }, lens);
  const lensMag = el('g', {}, lens);
  const use = el('use', {}, lensMag);
  use.setAttribute('href', '#mycelium-world');
  use.setAttributeNS(XLINK, 'xlink:href', '#mycelium-world');
  const lensGlass = el('circle', { fill: 'url(#mg-glass)' }, lens);
  const lensShine = el('ellipse', { class: 'lens-shine' }, lens);
  const lensRim = el('circle', { class: 'lens-rim', fill: 'none', stroke: 'url(#mg-rim)' }, svg);
  const lensRimEdge = el('circle', { class: 'lens-rim', fill: 'none', stroke: 'rgba(40,48,40,.55)', 'stroke-width': 1 }, svg);
  const lensRimInner = el('circle', { class: 'lens-rim', fill: 'none', stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.2 }, svg);
  const clipC = svg.querySelector('#mg-lens-clip-c');

  mapEl.appendChild(svg);
  const arrows = document.createElement('div');
  arrows.className = 'lens-arrows';
  mapEl.appendChild(arrows);
  const hint = document.createElement('p');
  hint.className = 'map-hint';
  hint.textContent = 'Drag the map, tap a name, or follow the arrows.';
  mapEl.appendChild(hint);
  const status = document.createElement('p');
  status.className = 'visually-hidden';
  status.setAttribute('aria-live', 'polite');
  mapEl.appendChild(status);

  document.documentElement.classList.add('map-ready');

  /* ---------- camera ---------- */

  let tx = 0, ty = 0, z = 1, R = 150, W = 0, H = 0;
  const c = { x: 0, y: 0 };
  let focusId = null, anim = 0;

  function apply() {
    world.setAttribute('transform', `translate(${f(tx)} ${f(ty)}) scale(${z})`);
    mapEl.style.backgroundPosition = `${Math.round(tx)}px ${Math.round(ty)}px`;
  }

  function measure() {
    W = mapEl.clientWidth; H = mapEl.clientHeight;
    const m = Math.min(W, H);
    c.x = W / 2; c.y = H * (W < 760 ? 0.54 : 0.5);
    R = clamp(m * 0.3, 92, 190);
    R = Math.min(R, m / 2 - 58);
    z = clamp(W / 1050, 0.72, 1);
    clipC.setAttribute('cx', c.x); clipC.setAttribute('cy', c.y); clipC.setAttribute('r', R);
    [lensPaper, lensGlass].forEach(e => { e.setAttribute('cx', c.x); e.setAttribute('cy', c.y); e.setAttribute('r', R); });
    lensRim.setAttribute('cx', c.x); lensRim.setAttribute('cy', c.y); lensRim.setAttribute('r', R + 3.5); lensRim.setAttribute('stroke-width', 7);
    lensRimEdge.setAttribute('cx', c.x); lensRimEdge.setAttribute('cy', c.y); lensRimEdge.setAttribute('r', R + 7.5);
    lensRimInner.setAttribute('cx', c.x); lensRimInner.setAttribute('cy', c.y); lensRimInner.setAttribute('r', R - 1);
    lensShadow.setAttribute('cx', c.x + R * 0.1); lensShadow.setAttribute('cy', c.y + R * 0.16);
    lensShadow.setAttribute('rx', R * 1.12); lensShadow.setAttribute('ry', R * 1.08);
    lensShine.setAttribute('cx', c.x - R * 0.38); lensShine.setAttribute('cy', c.y - R * 0.5);
    lensShine.setAttribute('rx', R * 0.42); lensShine.setAttribute('ry', R * 0.13);
    lensShine.setAttribute('transform', `rotate(-32 ${f(c.x - R * 0.38)} ${f(c.y - R * 0.5)})`);
    lensMag.setAttribute('transform', `translate(${f(c.x)} ${f(c.y)}) scale(${MAG}) translate(${f(-c.x)} ${f(-c.y)})`);
  }

  function moveTo(u, animate) {
    const tgt = { x: c.x - u.x * z, y: c.y - (u.y + 12) * z };
    cancelAnimationFrame(anim);
    if (!animate || reduceMotion) { tx = tgt.x; ty = tgt.y; apply(); return; }
    const from = { x: tx, y: ty }, start = performance.now(), dur = 650;
    const step = now => {
      const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3);
      tx = from.x + (tgt.x - from.x) * e; ty = from.y + (tgt.y - from.y) * e;
      apply();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }

  /* ---------- arrows around the glass ---------- */

  const ARROW_SVG = '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M9 25.5c6-1.8 13-2.4 21-1.6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M26 15.5c4 3.6 8 6.3 13 8.6-5 2.2-9.3 5.2-13 9 1.4-3.2 2-6 1.9-8.8-.1-3-.8-5.9-1.9-8.8z" fill="currentColor"/></svg>';

  function buildArrows(u) {
    arrows.textContent = '';
    const items = [...u.nb].map(id => { const n = U(id); return { n, a: Math.atan2(n.y - u.y, n.x - u.x) }; })
      .sort((p, q) => p.a - q.a);
    const minSep = 0.44;
    for (let it = 0; it < 30 && items.length > 1; it++) {
      let moved = false;
      for (let i = 0; i < items.length; i++) {
        const p = items[i], q = items[(i + 1) % items.length];
        let diff = q.a - p.a;
        if (i === items.length - 1) diff += Math.PI * 2;
        if (diff < minSep) { const push = (minSep - diff) / 2; p.a -= push; q.a += push; moved = true; }
      }
      if (!moved) break;
    }
    items.forEach(({ n, a }) => {
      const rel = relation(u, n);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lens-arrow';
      b.dataset.rel = rel;
      b.setAttribute('aria-label', `Go to ${n.name} (${rel})`);
      b.style.setProperty('--a', `${a}rad`);
      b.innerHTML = ARROW_SVG;
      const label = document.createElement('span');
      label.className = 'lens-arrow-label';
      label.textContent = n.line1;
      b.appendChild(label);
      b._angle = a;
      b.addEventListener('click', () => setFocus(n.id));
      arrows.appendChild(b);
    });
    placeArrows();
  }
  function placeArrows() {
    arrows.querySelectorAll('.lens-arrow').forEach(b => {
      const rr = R + 36;
      b.style.left = `${f(c.x + Math.cos(b._angle) * rr)}px`;
      b.style.top = `${f(c.y + Math.sin(b._angle) * rr)}px`;
    });
  }

  /* ---------- focus ---------- */

  function setFocus(id, opts) {
    const o = Object.assign({ animate: true, push: true, announce: true }, opts);
    const u = U(id);
    if (!u) return;
    const changed = id !== focusId;
    focusId = id;
    if (changed) {
      const dist = new Map([[id, 0]]), q = [id];
      while (q.length) {
        const v = q.shift(), d = dist.get(v);
        U(v).nb.forEach(n => { if (!dist.has(n)) { dist.set(n, d + 1); q.push(n); } });
      }
      all.forEach(v => { v.d = dist.has(v.id) ? Math.min(dist.get(v.id), 4) : 4; v.g.setAttribute('data-d', v.d); });
      edges.forEach(e => e.g.setAttribute('data-d', Math.max(U(e.a).d, U(e.b).d)));
      articles.forEach(a => a.classList.toggle('is-focus', a.id === id));
      panel.scrollTop = 0;
      document.title = `${u.name} · The Motekaitis Family`;
      if (o.announce) status.textContent = `Now viewing ${u.name}`;
      if (o.push && decodeURIComponent(location.hash.slice(1)) !== id) history.pushState({ id }, '', `#${id}`);
      buildArrows(u);
    }
    moveTo(u, o.animate);
  }

  /* ---------- interaction ---------- */

  function toWorld(px, py) {
    let x = px, y = py;
    if (Math.hypot(x - c.x, y - c.y) < R) { x = c.x + (x - c.x) / MAG; y = c.y + (y - c.y) / MAG; }
    return { x: (x - tx) / z, y: (y - ty) / z };
  }
  function nearest(w, max) {
    let best = null, bd = max || Infinity;
    all.forEach(u => { const d = Math.hypot(u.x - w.x, u.y + 18 - w.y); if (d < bd) { bd = d; best = u; } });
    return best;
  }
  function snap() {
    const u = nearest(toWorld(c.x, c.y));
    if (u) setFocus(u.id);
  }

  let drag = null;
  svg.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drag) return; // ignore a second finger
    cancelAnimationFrame(anim);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx, ty, moved: false };
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  });
  svg.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; mapEl.classList.add('is-dragging'); }
    if (drag.moved) { tx = drag.tx + dx; ty = drag.ty + dy; apply(); }
  });
  svg.addEventListener('pointerup', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null;
    mapEl.classList.remove('is-dragging');
    if (d.moved) { snap(); return; }
    const rect = svg.getBoundingClientRect();
    const hit = nearest(toWorld(e.clientX - rect.left, e.clientY - rect.top), 80);
    if (hit) setFocus(hit.id); else snap();
  });
  svg.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag = null; mapEl.classList.remove('is-dragging'); snap();
  });

  let wheelTimer = 0;
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const k = e.deltaMode === 1 ? 16 : 1;
    tx -= e.deltaX * k; ty -= e.deltaY * k; apply();
    mapEl.classList.add('is-dragging');
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { mapEl.classList.remove('is-dragging'); snap(); }, 280);
  }, { passive: false });

  const KEY_ANGLE = { ArrowRight: 0, ArrowDown: Math.PI / 2, ArrowLeft: Math.PI, ArrowUp: -Math.PI / 2 };
  document.addEventListener('keydown', e => {
    if (!(e.key in KEY_ANGLE) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
    if (panel.contains(t) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return; // let the panel scroll
    const u = U(focusId);
    let best = null, bd = 1.25;
    u.nb.forEach(id => {
      const n = U(id), a = Math.atan2(n.y - u.y, n.x - u.x);
      const d = Math.abs(((a - KEY_ANGLE[e.key]) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
      const score = d + Math.hypot(n.x - u.x, n.y - u.y) / 4000;
      if (score < bd) { bd = score; best = n; }
    });
    if (best) { e.preventDefault(); setFocus(best.id); }
  });

  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const u = unitOf(a.getAttribute('href'));
    if (!u) return;
    e.preventDefault();
    setFocus(u.id);
  });

  window.addEventListener('popstate', () => {
    const u = unitOf(location.hash);
    if (u) setFocus(u.id, { push: false });
  });

  const relayout = () => { measure(); if (focusId) moveTo(U(focusId), false); placeArrows(); };
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(mapEl);
  else window.addEventListener('resize', relayout);

  /* ---------- start ---------- */

  measure();
  const first = unitOf(location.hash) || U(panel.dataset.start) || all[0];
  setFocus(first.id, { animate: false, push: false, announce: false });
})();
