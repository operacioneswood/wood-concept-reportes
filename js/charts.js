// ─────────────────────────────────────────────────────────────
// js/charts.js — Canvas API chart drawing
//
// Depends on: config.js (DESIGNER_COLORS, fmtNum, MONTH_NAMES)
// ─────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════
// TOOLTIP
// ════════════════════════════════════════════════════════════

const Tooltip = {
  _el: null,
  _get() {
    if (!this._el) this._el = document.getElementById('chart-tooltip');
    return this._el;
  },
  show(x, y, html) {
    const t = this._get();
    if (!t) return;
    t.innerHTML = html;
    t.style.display = 'block';
    // Position relative to viewport, keep inside bounds
    const W = window.innerWidth, H = window.innerHeight;
    const tw = t.offsetWidth || 160, th = t.offsetHeight || 60;
    let left = x + 14, top = y - th / 2;
    if (left + tw > W - 8) left = x - tw - 14;
    if (top < 8) top = 8;
    if (top + th > H - 8) top = H - th - 8;
    t.style.left = left + 'px';
    t.style.top  = top  + 'px';
  },
  hide() {
    const t = this._get();
    if (t) t.style.display = 'none';
  },
};

// ════════════════════════════════════════════════════════════
// CANVAS SETUP
// ════════════════════════════════════════════════════════════

function setupCanvas(canvas, cssWidth, cssHeight) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = cssWidth  * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width  = cssWidth  + 'px';
  canvas.style.height = cssHeight + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

// ════════════════════════════════════════════════════════════
// AXIS HELPERS
// ════════════════════════════════════════════════════════════

function niceMax(n) {
  if (!n || n <= 0) return 10;
  const mag  = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function niceStep(max, targetTicks) {
  const raw  = max / targetTicks;
  const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

// ════════════════════════════════════════════════════════════
// LINE CHART  (dashboard trend panel)
// ════════════════════════════════════════════════════════════

/**
 * data = {
 *   labels: string[],          // x-axis month labels
 *   series: [{
 *     name: string,
 *     color: string,
 *     values: (number|null)[],  // null = no data that month
 *     visible: boolean,
 *   }]
 * }
 * opts = { yLabel, title, width, height }
 */
function createLineChart(canvasId, data, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const W   = opts.width  || canvas.parentElement.clientWidth  || 600;
  const H   = opts.height || 280;
  const ctx = setupCanvas(canvas, W, H);

  const PAD = { top: 28, right: 20, bottom: 48, left: 52 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;

  // Tooltip state
  let hoverPoint = null;

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const labels  = data.labels  || [];
    const series  = data.series  || [];
    const nLabels = labels.length;
    if (!nLabels) return;

    // Y-axis range
    let maxVal = 0;
    for (const s of series) {
      if (!s.visible) continue;
      for (const v of s.values) if (v != null) maxVal = Math.max(maxVal, v);
    }
    if (opts.refLine != null) maxVal = Math.max(maxVal, opts.refLine);
    const yMax  = niceMax(maxVal || 10);
    const yStep = niceStep(yMax, 5);

    // Grid lines + Y labels
    ctx.font      = '11px system-ui';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6b6660';
    ctx.textAlign = 'right';
    ctx.strokeStyle = '#e2ddd5';
    ctx.lineWidth   = 1;

    for (let y = 0; y <= yMax + 0.001; y += yStep) {
      const py = PAD.top + cH - (y / yMax) * cH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, py);
      ctx.lineTo(PAD.left + cW, py);
      ctx.stroke();
      ctx.fillText(fmtNum(y), PAD.left - 6, py + 4);
    }

    // X labels
    ctx.textAlign   = 'center';
    ctx.fillStyle   = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#6b6660';
    const xSpacing  = cW / Math.max(nLabels - 1, 1);
    for (let i = 0; i < nLabels; i++) {
      const px = PAD.left + (nLabels === 1 ? cW / 2 : i * xSpacing);
      ctx.fillText(labels[i], px, H - PAD.bottom + 18);
    }

    // Reference line
    if (opts.refLine != null) {
      const ry = PAD.top + cH - (opts.refLine / yMax) * cH;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = opts.refLineColor || '#aaa';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(PAD.left, ry);
      ctx.lineTo(PAD.left + cW, ry);
      ctx.stroke();
      if (opts.refLineLabel) {
        ctx.font      = '10px system-ui';
        ctx.fillStyle = opts.refLineColor || '#aaa';
        ctx.textAlign = 'right';
        ctx.fillText(opts.refLineLabel, PAD.left + cW - 2, ry - 4);
      }
      ctx.restore();
    }

    // Series lines + dots
    for (const s of series) {
      if (!s.visible) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 2.5;
      ctx.lineJoin    = 'round';
      ctx.beginPath();
      let first = true;
      for (let i = 0; i < nLabels; i++) {
        const v = s.values[i];
        if (v == null) { first = true; continue; }
        const px = PAD.left + (nLabels === 1 ? cW / 2 : i * xSpacing);
        const py = PAD.top  + cH - (v / yMax) * cH;
        if (first) { ctx.moveTo(px, py); first = false; }
        else        ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Dots
      for (let i = 0; i < nLabels; i++) {
        const v = s.values[i];
        if (v == null) continue;
        const px = PAD.left + (nLabels === 1 ? cW / 2 : i * xSpacing);
        const py = PAD.top  + cH - (v / yMax) * cH;
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = s.pointColorFn ? s.pointColorFn(v, i) : s.color;
        ctx.fill();
        // Hover highlight
        if (hoverPoint && hoverPoint.name === s.name && hoverPoint.i === i) {
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.strokeStyle = s.color;
          ctx.lineWidth   = 2;
          ctx.stroke();
        }
      }
    }

    // Axis lines
    ctx.strokeStyle = '#c8c3bc';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, PAD.top + cH);
    ctx.lineTo(PAD.left + cW, PAD.top + cH);
    ctx.stroke();
  }

  draw();

  // Mouse interaction
  canvas.addEventListener('mousemove', e => {
    const rect   = canvas.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const my     = e.clientY - rect.top;
    const labels  = data.labels  || [];
    const nLabels = labels.length;
    const xSpacing = cW / Math.max(nLabels - 1, 1);
    let maxVal = 0;
    for (const s of data.series) if (s.visible) for (const v of s.values) if (v != null) maxVal = Math.max(maxVal, v);
    const yMax = niceMax(maxVal || 10);

    let found = null, best = Infinity;
    for (const s of data.series) {
      if (!s.visible) continue;
      for (let i = 0; i < nLabels; i++) {
        const v = s.values[i];
        if (v == null) continue;
        const px = PAD.left + (nLabels === 1 ? cW / 2 : i * xSpacing);
        const py = PAD.top  + cH - (v / yMax) * cH;
        const d  = Math.hypot(mx - px, my - py);
        if (d < best && d < 20) { best = d; found = { name: s.name, i, v, px, py, color: s.color }; }
      }
    }
    hoverPoint = found ? { name: found.name, i: found.i } : null;
    draw();
    if (found) {
      Tooltip.show(
        e.clientX, e.clientY,
        `<strong style="color:${found.color}">${esc(found.name)}</strong><br>${esc(labels[found.i])}: <strong>${fmtNum(found.v)} pts</strong>`
      );
    } else {
      Tooltip.hide();
    }
  });
  canvas.addEventListener('mouseleave', () => { hoverPoint = null; draw(); Tooltip.hide(); });

  return { draw, canvas };
}

// ════════════════════════════════════════════════════════════
// BAR CHART  (dashboard composition panel)
// ════════════════════════════════════════════════════════════

/**
 * data = {
 *   labels: string[],   // designer names or month labels
 *   groups: [{          // one per segment (aprob / prod)
 *     label: string,
 *     color: string,
 *     values: number[],
 *   }],
 *   mode: 'grouped' | 'stacked',
 * }
 */
function createBarChart(canvasId, data, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const W   = opts.width  || canvas.parentElement.clientWidth  || 600;
  const H   = opts.height || 280;
  const ctx = setupCanvas(canvas, W, H);

  const PAD = { top: 28, right: 20, bottom: 52, left: 52 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const labels = data.labels || [];
    const groups = data.groups || [];
    const mode   = data.mode   || 'stacked';
    const n      = labels.length;
    if (!n || !groups.length) return;

    // Y-axis max
    let maxVal = 0;
    if (mode === 'grouped') {
      for (const g of groups) for (const v of g.values) maxVal = Math.max(maxVal, v);
    } else {
      for (let i = 0; i < n; i++) {
        const sum = groups.reduce((s, g) => s + (g.values[i] || 0), 0);
        maxVal = Math.max(maxVal, sum);
      }
    }
    const yMax  = niceMax(maxVal || 10);
    const yStep = niceStep(yMax, 5);

    // Grid + Y labels
    ctx.font      = '11px system-ui';
    ctx.fillStyle = '#6b6660';
    ctx.textAlign = 'right';
    ctx.strokeStyle = '#e2ddd5';
    ctx.lineWidth   = 1;
    for (let y = 0; y <= yMax + 0.001; y += yStep) {
      const py = PAD.top + cH - (y / yMax) * cH;
      ctx.beginPath();
      ctx.moveTo(PAD.left, py);
      ctx.lineTo(PAD.left + cW, py);
      ctx.stroke();
      ctx.fillText(fmtNum(y), PAD.left - 6, py + 4);
    }

    // Bars
    const slotW  = cW / n;
    const barPad = slotW * 0.15;

    for (let i = 0; i < n; i++) {
      const slotX = PAD.left + i * slotW;

      if (mode === 'grouped') {
        const bW = (slotW - barPad * 2) / groups.length;
        for (let g = 0; g < groups.length; g++) {
          const v  = groups[g].values[i] || 0;
          const bH = (v / yMax) * cH;
          const bX = slotX + barPad + g * bW;
          const bY = PAD.top + cH - bH;
          ctx.fillStyle = groups[g].color;
          ctx.fillRect(bX, bY, bW - 2, bH);
        }
      } else {
        const bW = slotW - barPad * 2;
        let stackY = PAD.top + cH;
        for (const g of groups) {
          const v  = g.values[i] || 0;
          const bH = (v / yMax) * cH;
          ctx.fillStyle = g.color;
          ctx.fillRect(slotX + barPad, stackY - bH, bW, bH);
          stackY -= bH;
        }
      }

      // X label
      ctx.fillStyle = '#6b6660';
      ctx.textAlign = 'center';
      ctx.font      = '11px system-ui';
      // Truncate long names
      let lbl = labels[i];
      if (lbl.length > 10) lbl = lbl.slice(0, 9) + '…';
      ctx.fillText(lbl, slotX + slotW / 2, H - PAD.bottom + 16);
    }

    // Axis
    ctx.strokeStyle = '#c8c3bc';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, PAD.top + cH);
    ctx.lineTo(PAD.left + cW, PAD.top + cH);
    ctx.stroke();

    // Legend (top-right)
    let lx = W - PAD.right;
    for (let g = groups.length - 1; g >= 0; g--) {
      const lbl = groups[g].label;
      ctx.font      = '11px system-ui';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#6b6660';
      ctx.fillText(lbl, lx - 14, PAD.top - 8);
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = groups[g].color;
      ctx.fillRect(lx - 14 - tw - 14, PAD.top - 18, 10, 10);
      lx = lx - 14 - tw - 22;
    }
  }

  draw();

  canvas.addEventListener('mousemove', e => {
    const rect   = canvas.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const labels = data.labels || [];
    const groups = data.groups || [];
    const mode   = data.mode   || 'stacked';
    const n      = labels.length;
    if (!n) return;
    const slotW = cW / n;
    const i     = Math.floor((mx - PAD.left) / slotW);
    if (i < 0 || i >= n) { Tooltip.hide(); return; }
    let html = `<strong>${esc(labels[i])}</strong><br>`;
    for (const g of groups) {
      html += `<span style="color:${g.color}">■</span> ${esc(g.label)}: <strong>${fmtNum(g.values[i] || 0)}</strong><br>`;
    }
    if (mode === 'stacked') {
      const sum = groups.reduce((s, g) => s + (g.values[i] || 0), 0);
      html += `Total: <strong>${fmtNum(sum)}</strong>`;
    }
    Tooltip.show(e.clientX, e.clientY, html);
  });
  canvas.addEventListener('mouseleave', () => Tooltip.hide());

  return { draw, canvas };
}

// ════════════════════════════════════════════════════════════
// SCATTER CHART  (dashboard volume vs complexity)
// ════════════════════════════════════════════════════════════

/**
 * data = {
 *   points: [{
 *     name: string,       // designer name
 *     color: string,
 *     x: number,          // item count (volume)
 *     y: number,          // mean score per item (complexity)
 *     r: number,          // radius proportional to total pts
 *     label: string,      // tooltip month label
 *   }]
 * }
 */
function createScatterChart(canvasId, data, opts = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const W   = opts.width  || canvas.parentElement.clientWidth  || 600;
  const H   = opts.height || 300;
  const ctx = setupCanvas(canvas, W, H);

  const PAD = { top: 28, right: 28, bottom: 48, left: 52 };
  const cW  = W - PAD.left - PAD.right;
  const cH  = H - PAD.top  - PAD.bottom;

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const points = data.points || [];

    let xMax = 1, yMax = 1;
    for (const p of points) { xMax = Math.max(xMax, p.x); yMax = Math.max(yMax, p.y); }
    xMax = niceMax(xMax);
    yMax = niceMax(yMax);

    const xStep = niceStep(xMax, 5);
    const yStep = niceStep(yMax, 5);

    // Grid
    ctx.strokeStyle = '#e2ddd5';
    ctx.lineWidth   = 1;
    ctx.font        = '11px system-ui';
    ctx.fillStyle   = '#6b6660';

    ctx.textAlign = 'center';
    for (let x = 0; x <= xMax + 0.001; x += xStep) {
      const px = PAD.left + (x / xMax) * cW;
      ctx.beginPath(); ctx.moveTo(px, PAD.top); ctx.lineTo(px, PAD.top + cH); ctx.stroke();
      ctx.fillText(fmtNum(x), px, H - PAD.bottom + 16);
    }

    ctx.textAlign = 'right';
    for (let y = 0; y <= yMax + 0.001; y += yStep) {
      const py = PAD.top + cH - (y / yMax) * cH;
      ctx.beginPath(); ctx.moveTo(PAD.left, py); ctx.lineTo(PAD.left + cW, py); ctx.stroke();
      ctx.fillText(fmtNum(y), PAD.left - 6, py + 4);
    }

    // Quadrant lines (at mean of all points)
    if (points.length > 1) {
      const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
      const my = points.reduce((s, p) => s + p.y, 0) / points.length;
      const qx = PAD.left + (mx / xMax) * cW;
      const qy = PAD.top  + cH - (my / yMax) * cH;
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#c8c3bc';
      ctx.lineWidth   = 1;
      ctx.beginPath(); ctx.moveTo(qx, PAD.top); ctx.lineTo(qx, PAD.top + cH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(PAD.left, qy); ctx.lineTo(PAD.left + cW, qy); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Points
    const rMax = points.reduce((m, p) => Math.max(m, p.r || 1), 1);
    for (const p of points) {
      const px  = PAD.left + (p.x / xMax) * cW;
      const py  = PAD.top  + cH - (p.y / yMax) * cH;
      const rad = 5 + (p.r / rMax) * 14;
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fillStyle   = p.color + 'cc';
      ctx.fill();
      ctx.strokeStyle = p.color;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Name label
      ctx.font      = '10px system-ui';
      ctx.fillStyle = p.color;
      ctx.textAlign = 'center';
      ctx.fillText(p.name.split(' ')[0], px, py - rad - 3);
    }

    // Axis
    ctx.strokeStyle = '#c8c3bc';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, PAD.top);
    ctx.lineTo(PAD.left, PAD.top + cH);
    ctx.lineTo(PAD.left + cW, PAD.top + cH);
    ctx.stroke();

    // Axis labels
    ctx.font      = '11px system-ui';
    ctx.fillStyle = '#6b6660';
    ctx.textAlign = 'center';
    ctx.fillText(opts.xLabel || 'Cantidad de ítems', PAD.left + cW / 2, H - 4);
    ctx.save();
    ctx.translate(14, PAD.top + cH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(opts.yLabel || 'Complejidad media', 0, 0);
    ctx.restore();
  }

  draw();

  canvas.addEventListener('mousemove', e => {
    const rect   = canvas.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const my     = e.clientY - rect.top;
    const points = data.points || [];
    let maxX = 1, maxY = 1;
    for (const p of points) { maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    maxX = niceMax(maxX); maxY = niceMax(maxY);
    const rMax = points.reduce((m, p) => Math.max(m, p.r || 1), 1);

    let found = null, best = Infinity;
    for (const p of points) {
      const px  = PAD.left + (p.x / maxX) * cW;
      const py  = PAD.top  + cH - (p.y / maxY) * cH;
      const rad = 5 + (p.r / rMax) * 14;
      const d   = Math.hypot(mx - px, my - py);
      if (d < rad + 4 && d < best) { best = d; found = { p, px, py }; }
    }
    if (found) {
      const { p } = found;
      Tooltip.show(
        e.clientX, e.clientY,
        `<strong style="color:${p.color}">${esc(p.name)}</strong><br>` +
        `${esc(p.label || '')}<br>` +
        `Ítems: <strong>${p.x}</strong> · Complejidad: <strong>${fmtNum(p.y)}</strong><br>` +
        `Total: <strong>${fmtNum(p.r)}</strong> pts`
      );
    } else {
      Tooltip.hide();
    }
  });
  canvas.addEventListener('mouseleave', () => Tooltip.hide());

  return { draw, canvas };
}

// ════════════════════════════════════════════════════════════
// RADAR CHART  (compare screen, one per designer)
// ════════════════════════════════════════════════════════════

/**
 * data = {
 *   axes:   string[],        // month labels (3–6 recommended)
 *   series: [{
 *     label: string,
 *     color: string,
 *     values: number[],      // one per axis
 *   }]
 * }
 */
function createRadarChart(canvas, data, opts = {}) {
  if (!canvas) return null;

  const W   = opts.size || 220;
  const H   = W;
  const ctx = setupCanvas(canvas, W, H);

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const axes   = data.axes   || [];
    const series = data.series || [];
    const n      = axes.length;
    if (n < 3) return;

    const cx    = W / 2;
    const cy    = H / 2;
    const R     = Math.min(W, H) / 2 - 30;
    const rings = 4;

    // Max value across all series
    let maxVal = 0;
    for (const s of series) for (const v of s.values) maxVal = Math.max(maxVal, v);
    maxVal = niceMax(maxVal || 10);

    const angle = (i) => (i / n) * Math.PI * 2 - Math.PI / 2;

    // Spiderweb rings
    ctx.strokeStyle = '#e2ddd5';
    ctx.lineWidth   = 1;
    for (let ring = 1; ring <= rings; ring++) {
      const r = R * (ring / rings);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = angle(i);
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Spokes
    for (let i = 0; i < n; i++) {
      const a = angle(i);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
      ctx.stroke();
    }

    // Axis labels
    ctx.font      = '10px system-ui';
    ctx.fillStyle = '#6b6660';
    ctx.textAlign = 'center';
    for (let i = 0; i < n; i++) {
      const a  = angle(i);
      const lx = cx + (R + 14) * Math.cos(a);
      const ly = cy + (R + 14) * Math.sin(a);
      ctx.fillText(axes[i], lx, ly + 4);
    }

    // Series polygons
    for (const s of series) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = s.values[i] || 0;
        const r = (v / maxVal) * R;
        const a = angle(i);
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle   = s.color + '33';
      ctx.fill();
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 2;
      ctx.stroke();

      // Dots
      for (let i = 0; i < n; i++) {
        const v = s.values[i] || 0;
        const r = (v / maxVal) * R;
        const a = angle(i);
        ctx.beginPath();
        ctx.arc(cx + r * Math.cos(a), cy + r * Math.sin(a), 3, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      }
    }
  }

  draw();

  canvas.addEventListener('mousemove', e => {
    const rect   = canvas.getBoundingClientRect();
    const mx     = e.clientX - rect.left;
    const my     = e.clientY - rect.top;
    const axes   = data.axes   || [];
    const series = data.series || [];
    const n      = axes.length;
    if (n < 3) return;

    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) / 2 - 30;
    let maxVal = 0;
    for (const s of series) for (const v of s.values) maxVal = Math.max(maxVal, v);
    maxVal = niceMax(maxVal || 10);

    let found = null, best = Infinity;
    for (const s of series) {
      for (let i = 0; i < n; i++) {
        const v = s.values[i] || 0;
        const r = (v / maxVal) * R;
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        const d  = Math.hypot(mx - px, my - py);
        if (d < 10 && d < best) { best = d; found = { s, i, v }; }
      }
    }
    if (found) {
      Tooltip.show(
        e.clientX, e.clientY,
        `<strong style="color:${found.s.color}">${esc(found.s.label)}</strong><br>` +
        `${esc(axes[found.i])}: <strong>${fmtNum(found.v)} pts</strong>`
      );
    } else {
      Tooltip.hide();
    }
  });
  canvas.addEventListener('mouseleave', () => Tooltip.hide());

  return { draw, canvas };
}

// ════════════════════════════════════════════════════════════
// CHARTS NAMESPACE  — lifecycle management
// ════════════════════════════════════════════════════════════

const Charts = {
  _instances: {},

  _register(id, inst) {
    this._instances[id] = inst;
    return inst;
  },

  destroy(id) {
    delete this._instances[id];
  },

  destroyAll() {
    this._instances = {};
    Tooltip.hide();
  },

  line(canvasId, data, opts)    { return this._register(canvasId, createLineChart(canvasId, data, opts)); },
  bar(canvasId, data, opts)     { return this._register(canvasId, createBarChart(canvasId, data, opts)); },
  scatter(canvasId, data, opts) { return this._register(canvasId, createScatterChart(canvasId, data, opts)); },
  radar(canvas, data, opts)     { return createRadarChart(canvas, data, opts); },
};
