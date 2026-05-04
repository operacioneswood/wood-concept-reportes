// ─────────────────────────────────────────────────────────────
// js/report.js — Monthly report rendering
//
// Depends on: config.js, storage.js
// ─────────────────────────────────────────────────────────────

const Report = {
  _report:   null,   // current in-memory report
  _mode:     'A',
  _cuFile:   '',
  _regFile:  '',
  _valOpen:  true,

  // ── Public API ────────────────────────────────────────────

  /** Render a freshly-built report (from scoring.js). */
  render(report, mode, cuFile, regFile) {
    this._report  = report;
    this._mode    = mode;
    this._cuFile  = cuFile  || '';
    this._regFile = regFile || '';
    this._valOpen = true;
    this._paint();
  },

  /** Render a stored snapshot loaded from localStorage. */
  renderFromStored(stored) {
    const report  = storedToRender(stored);
    this._report  = report;
    this._mode    = stored.mode || 'A';
    this._cuFile  = '';
    this._regFile = '';
    this._valOpen = true;
    this._paint();
  },

  // ── Internal render pipeline ──────────────────────────────

  _paint() {
    const { _report: r, _mode: mode, _cuFile: cu, _regFile: reg } = this;
    const modeLbl = mode === 'A' ? 'Modo A · Solo ClickUp'
                  : mode === 'B' ? 'Modo B · ClickUp + Fábrica'
                  :                'Modo C · Solo Fábrica';
    const ts    = new Date().toLocaleString('es', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
    const files = [cu, reg].filter(Boolean).join(' · ');

    el('report-sub').innerHTML =
      `${MONTH_NAMES[r.month]} ${r.year} &nbsp;·&nbsp; ${modeLbl}` +
      (files ? ` &nbsp;·&nbsp; ${files}` : '') +
      `<br><span style="color:var(--faint)">Generado el ${ts}</span>`;

    this._renderMetrics();
    this._renderValPanel();
    el('designers-heading').textContent =
      mode === 'C' ? 'Equipo de diseño — Producción' : 'Equipo de diseño';
    this._renderTeamSummary();
    this._renderCards();
    this._renderUnassigned();
    this._renderFooter();
    this._bindSaveBtn();
  },

  _renderMetrics() {
    const { _mode } = this;
    const r    = this._report;
    const mt   = r.metrics;
    const noteA = _mode === 'A' ? '<div class="metric-note">Sin verificación de fábrica</div>' : '';
    const noteC = _mode === 'C' ? '<div class="metric-note">Solo producción</div>' : '';
    const top  = mt.topDesigner;
    const star = mt.starProject || '—';

    const srCount = r.designers.filter(d => PC_ROLES.senior.has(d.name)).length;
    const jrCount = r.designers.filter(d => PC_ROLES.junior.has(d.name)).length;
    const srSub   = `${srCount} senior${srCount !== 1 ? 'es' : ''} activo${srCount !== 1 ? 's' : ''}`;
    const jrSub   = `${jrCount} junior${jrCount !== 1 ? 'es' : ''} activo${jrCount !== 1 ? 's' : ''}`;

    const cards = [
      // ── Totals ───────────────────────────────────────────
      { l: 'Puntos totales',        v: fmtNum(mt.tPts),               s: `${r.activeCount} diseñadores activos`, x: noteA + noteC },
      { l: 'Puntos dibujo',         v: fmtNum(mt.tDraw || 0),         s: 'Planos de dibujo (×1.0)',    x: '' },
      { l: 'Puntos aprobados',      v: fmtNum(mt.tApv  || 0),         s: 'Planos aprobados (×1.25)',   x: '' },
      { l: 'Puntos producción',     v: fmtNum(mt.tPrd  || 0),         s: 'Planos de producción (×1.5)', x: '' },
      // ── General ──────────────────────────────────────────
      { type: 'header', label: 'General' },
      { l: 'Ítems trabajados',      v: String(mt.uniqueItems || 0),   s: 'Únicos este mes',            x: '' },
      { l: 'Proyecto estrella',     v: esc(star), s: fmtNum(mt.starPts || 0) + ' pts combinados',     x: '', sm: true },
      { l: 'Diseñador del mes',     v: esc(top ? top.name : '—'), s: top ? fmtNum(top.total) + ' pts' : '—', x: '', sm: true },
      // ── Seniors ──────────────────────────────────────────
      { type: 'header', label: 'Seniors' },
      { l: 'Media Sr — Total',      v: fmtNum(mt.meanSrTotal || 0),   s: srSub,        x: '' },
      { l: 'Media Sr — Dibujo',     v: fmtNum(mt.meanSrDraw  || 0),   s: 'Por senior', x: '' },
      { l: 'Media Sr — Aprobado',   v: fmtNum(mt.meanSrApv   || 0),   s: 'Por senior', x: '' },
      { l: 'Media Sr — Producción', v: fmtNum(mt.meanSrProd  || 0),   s: 'Por senior', x: '' },
      // ── Juniors ──────────────────────────────────────────
      { type: 'header', label: 'Juniors' },
      { l: 'Media Jr — Total',      v: fmtNum(mt.meanJrTotal || 0),   s: jrSub,        x: '' },
      { l: 'Media Jr — Dibujo',     v: fmtNum(mt.meanJrDraw  || 0),   s: 'Por junior', x: '' },
      { l: 'Media Jr — Aprobado',   v: fmtNum(mt.meanJrApv   || 0),   s: 'Por junior', x: '' },
      { l: 'Media Jr — Producción', v: fmtNum(mt.meanJrProd  || 0),   s: 'Por junior', x: '' },
    ];

    el('metrics-grid').innerHTML = cards.map(c =>
      c.type === 'header'
        ? `<div class="metric-group-header">${c.label}</div>`
        : `<div class="metric-card">
            <div class="metric-label">${c.l}</div>
            <div class="metric-value${c.sm ? ' metric-value-text' : ''}">${c.v}</div>
            <div class="metric-sub">${c.s}</div>${c.x}
           </div>`
    ).join('');
  },

  _renderValPanel() {
    const wrap = el('val-panel-wrap');
    const v = this._report.validation;
    if (!v) { wrap.innerHTML = ''; return; }
    const { month, year } = this._report;
    const total    = v.coinciden.length + v.soloFabrica.length;
    const confirmed = v.coinciden.length;
    const summary  = `${confirmed} de ${total} ítem${total !== 1 ? 's' : ''} de fábrica confirmados en ClickUp`;

    const mkReg = e =>
      `<div class="val-item">${esc(e.descripcion || e.rawOP || '')}
       <span class="val-item-op">${esc(e.rawOP || '')}</span></div>`;
    const mkCU = t =>
      `<div class="val-item">${esc(t.name || t.op || '')}
       <span class="val-item-op">${esc(t.op || '')}</span></div>`;

    wrap.innerHTML = `
      <div class="val-panel">
        <div class="val-header" id="val-header">
          <div class="val-header-left">
            <span class="val-title-text">Verificación de producción — ${MONTH_NAMES[month]} ${year}</span>
            <span class="val-summary-pill">${summary}</span>
          </div>
          <button class="val-toggle-btn" id="val-toggle-btn">▲ Colapsar</button>
        </div>
        <div id="val-body">
          <div class="val-sections">
            <div class="val-section">
              <div class="val-sec-title green">✓ Coinciden (${v.coinciden.length})</div>
              ${v.coinciden.length ? v.coinciden.map(mkReg).join('') : '<div class="val-empty">—</div>'}
            </div>
            <div class="val-section">
              <div class="val-sec-title amber">⊕ Solo en fábrica (${v.soloFabrica.length})</div>
              <div class="val-sec-note" style="font-size:11px;color:var(--added);margin-bottom:6px">Añadidos al reporte automáticamente</div>
              ${v.soloFabrica.length ? v.soloFabrica.map(mkReg).join('') : '<div class="val-empty">Ninguno</div>'}
            </div>
            <div class="val-section">
              <div class="val-sec-title amber">⚠ Solo en ClickUp (${v.soloClickUp.length})</div>
              <div class="val-sec-note" style="font-size:11px;color:var(--warn);margin-bottom:6px">No confirmados por fábrica</div>
              ${v.soloClickUp.length ? v.soloClickUp.map(mkCU).join('') : '<div class="val-empty">Ninguno</div>'}
            </div>
          </div>
        </div>
      </div>`;

    el('val-header').addEventListener('click', () => this._toggleVal());
  },

  _toggleVal() {
    this._valOpen = !this._valOpen;
    const body = el('val-body');
    const btn  = el('val-toggle-btn');
    if (body) body.style.display = this._valOpen ? '' : 'none';
    if (btn)  btn.textContent   = this._valOpen ? '▲ Colapsar' : '▼ Expandir';
  },

  _renderTeamSummary() {
    const wrap = el('team-summary');
    if (!wrap) return;
    const { designers, metrics } = this._report;
    const showTiered = this._mode !== 'C';
    if (!designers.length) { wrap.innerHTML = ''; return; }

    const teamDraw = showTiered ? (metrics.rawDraw || 0) : 0;
    const teamApv  = showTiered ? (metrics.rawApv  || 0) : 0;
    const teamProd = metrics.rawProd || 0;
    const teamTotal = teamDraw + teamApv + teamProd;

    const rows = designers.map(d => {
      const draw  = showTiered ? (d.drawings    || []).length : 0;
      const apv   = showTiered ? (d.approved    || []).length : 0;
      const prod  = d.productions.length;
      const total = draw + apv + prod;
      return `<tr>
        <td class="ts-name"><span class="ts-dot" style="background:${d.color}"></span>${esc(d.name)}</td>
        ${showTiered ? `<td class="ts-num" style="color:var(--aprob-text)">${draw}</td>` : ''}
        ${showTiered ? `<td class="ts-num" style="color:var(--apv-text)">${apv}</td>`  : ''}
        <td class="ts-num" style="color:var(--prod-text)">${prod}</td>
        <td class="ts-num ts-total">${total}</td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <table class="team-summary-table">
        <thead>
          <tr>
            <th class="ts-name">Diseñador</th>
            ${showTiered ? `<th class="ts-num" style="color:var(--aprob-text)">Dibujo</th>` : ''}
            ${showTiered ? `<th class="ts-num" style="color:var(--apv-text)">Aprobado</th>` : ''}
            <th class="ts-num" style="color:var(--prod-text)">Producción</th>
            <th class="ts-num ts-total">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td class="ts-name ts-team">Equipo</td>
            ${showTiered ? `<td class="ts-num ts-team" style="color:var(--aprob-text)">${teamDraw}</td>` : ''}
            ${showTiered ? `<td class="ts-num ts-team" style="color:var(--apv-text)">${teamApv}</td>`  : ''}
            <td class="ts-num ts-team" style="color:var(--prod-text)">${teamProd}</td>
            <td class="ts-num ts-team ts-total">${teamTotal}</td>
          </tr>
        </tfoot>
      </table>`;
  },

  _renderCards() {
    const { designers, metrics, maxTotal } = this._report;
    el('designers-container').innerHTML = designers.length
      ? designers.map(d => {
          const isSr    = PC_ROLES.senior.has(d.name);
          const grpMean = isSr ? (metrics.meanSrTotal || 0) : (metrics.meanJrTotal || 0);
          return this._cardHTML(d, grpMean, maxTotal);
        }).join('')
      : '<p style="font-size:14px;color:var(--muted)">No se encontraron datos para el mes seleccionado.</p>';
  },

  _cardHTML(d, mean, maxTotal) {
    const mode    = this._mode;
    const role    = PC_ROLES.senior.has(d.name) ? 'Sr' : 'Jr';
    const pct     = maxTotal > 0 ? (d.total / maxTotal) * 100 : 0;
    const mPct    = maxTotal > 0 ? Math.min((mean / maxTotal) * 100, 100) : 0;
    const isAbove = d.total > mean + 0.001;
    const isBelow = d.total < mean - 0.001;
    const pc      = isAbove ? 'pill-above' : isBelow ? 'pill-below' : 'pill-neutral';
    const arrow   = isAbove ? ' ↑' : isBelow ? ' ↓' : '';
    const showTiered = mode !== 'C'; // Mode C only has Producción

    const ptsPerItem = d.itemCount > 0 ? (d.total / d.itemCount).toFixed(1) : '0.0';

    // Inline stats
    const allItems   = showTiered
      ? [...(d.drawings || []), ...(d.approved || []), ...d.productions]
      : d.productions;
    const dTotalCorr = allItems.reduce((s, i) => s + (i.corrections || 0), 0);
    const dAvgCorr   = allItems.length > 0 ? (dTotalCorr / allItems.length).toFixed(2) : '0.00';

    const statsLine = showTiered
      ? `<div class="card-designer-stats">
          <span>${fmtNum(d.dTotal || 0)} dibujo</span><span class="dstats-sep">·</span>
          <span>${fmtNum(d.apvTotal || 0)} aprobado</span><span class="dstats-sep">·</span>
          <span>${fmtNum(d.pTotal)} prod</span><span class="dstats-sep">·</span>
          <span>${dAvgCorr} corr/ítem</span>
        </div>`
      : `<div class="card-designer-stats">
          <span>${fmtNum(d.pTotal)} prod</span><span class="dstats-sep">·</span>
          <span>${dAvgCorr} corr/ítem</span>
        </div>`;

    const tags = d.projects.map(p => {
      const label = p.length > 20 ? p.slice(0, 19) + '…' : p;
      return `<span class="project-tag" title="${esc(p)}">${esc(label)}</span>`;
    }).join('');

    // Pills: show draw/apv/prod counts when tiered
    const drawCount = (d.drawings    || []).length;
    const apvCount  = (d.approved    || []).length;
    const prodCount = (d.productions || []).length;
    const totalItems = drawCount + apvCount + prodCount;
    const pillCounts = showTiered
      ? `<span class="pill pill-neutral" style="color:var(--aprob-text)">${drawCount} dibujo</span>
         <span class="pill pill-neutral" style="color:var(--apv-text)">${apvCount} aprobado</span>
         <span class="pill pill-neutral" style="color:var(--prod-text)">${prodCount} prod</span>
         <span class="pill pill-neutral">${totalItems} ítem${totalItems !== 1 ? 's' : ''}</span>`
      : `<span class="pill pill-neutral">${d.itemCount} ítem${d.itemCount !== 1 ? 's' : ''}</span>`;

    // Item rows per tier
    const mkCol = (items, label, color) => `
      <div class="item-col">
        <div class="col-heading">
          <div class="col-dot" style="background:${color}"></div>
          <span style="color:${color}">${label}</span>
        </div>
        ${items.length ? items.map(itemRowHTML).join('') : '<div class="col-empty">Sin planos este mes</div>'}
        ${items.length ? `<div class="col-subtotal"><span>Subtotal</span><span>${fmtNum(items.reduce((s,i)=>s+i.score,0))} pts</span></div>` : ''}
      </div>`;

    const bodyClass = showTiered ? 'three-col' : 'single-col';
    const bodyContent = showTiered
      ? mkCol(d.drawings    || [], 'Dibujo',     'var(--aprob-text)')
      + mkCol(d.approved    || [], 'Aprobado',   'var(--apv-text)')
      + mkCol(d.productions,       'Producción', 'var(--prod-text)')
      : mkCol(d.productions,       'Producción', 'var(--prod-text)');

    return `
    <div class="designer-card">
      <div class="card-header">
        <div class="card-top">
          <div class="designer-dot" style="background:${d.color}"></div>
          <div class="designer-name">${esc(d.name)}</div>
          <div class="pills">
            <span class="pill ${pc}">${fmtNum(d.total)} pts${arrow}</span>
            ${pillCounts}
            <span class="pill pill-neutral">${ptsPerItem} pts/ítem</span>
          </div>
        </div>
        <div class="bar-wrap">
          <div class="bar-track">
            <div class="bar-fill" style="width:${pct.toFixed(1)}%;background:${d.color}"></div>
          </div>
          ${mPct > 0 ? `
            <div class="bar-tick" style="left:${mPct.toFixed(1)}%"></div>
            <div class="bar-tick-label" style="left:${mPct.toFixed(1)}%">media ${role}</div>` : ''}
        </div>
        <div class="project-tags">${tags}</div>
        ${statsLine}
      </div>
      <div class="card-body ${bodyClass}">
        ${bodyContent}
      </div>
    </div>`;
  },

  _renderUnassigned() {
    const ua   = this._report.unassigned;
    const sec  = el('unassigned-section');
    const card = el('unassigned-card');
    const drawings    = ua.drawings    || ua.approvals || [];
    const approved    = ua.approved    || [];
    const productions = ua.productions || [];
    const tot = drawings.length + approved.length + productions.length;
    if (!tot) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    const showTiered = this._mode !== 'C';

    const mkSec = (items, label, color) => items.length
      ? `<div>
           <div class="col-heading" style="margin-bottom:8px">
             <span style="color:${color}">${label} (${items.length})</span>
           </div>
           ${items.map(itemRowHTML).join('')}
         </div>`
      : `<div><div class="col-empty">—</div></div>`;

    card.innerHTML = `
      <div class="unassigned-label">Ítems sin diseñador asignado</div>
      <div class="unassigned-grid" style="display:grid;grid-template-columns:${showTiered ? '1fr 1fr 1fr' : '1fr'};gap:16px">
        ${showTiered ? mkSec(drawings,    'Dibujo',     'var(--aprob-text)') : ''}
        ${showTiered ? mkSec(approved,    'Aprobado',   'var(--apv-text)')   : ''}
        ${mkSec(productions, 'Producción', 'var(--prod-text)')}
      </div>`;
  },

  _renderFooter() {
    el('report-footer').innerHTML = `
      <strong>Leyenda de puntuación</strong><br>
      <span style="color:var(--aprob-text)">Dibujo</span> = nivel × 1.0
      &nbsp;·&nbsp;
      <span style="color:var(--apv-text)">Aprobado</span> = nivel × 1.25
      &nbsp;·&nbsp;
      <span style="color:var(--prod-text)">Producción</span> = nivel × 1.5
      &nbsp;·&nbsp; Cada ítem aparece una sola vez al estado más avanzado del mes
      <div class="legend-row">
        <div class="legend-item"><span class="mark-fallback" style="font-size:13px">†</span> Nivel tomado del Registro de Fábrica — actualizar en ClickUp</div>
        <div class="legend-item"><span class="mark-added"    style="font-size:13px">⊕</span> Ítem añadido desde Registro, no encontrado en ClickUp</div>
        <div class="legend-item"><span class="mark-warn"     style="font-size:13px">⚠</span> Ítem en ClickUp no confirmado por Registro</div>
        <div class="legend-item"><span style="color:var(--faint);font-size:12px;font-style:italic">— (sin nivel)</span> No suma puntos</div>
      </div>`;
  },

  _bindSaveBtn() {
    const btn = el('btn-save-report');
    if (!btn) return;
    btn.onclick = () => this._handleSave();
  },

  async _handleSave() {
    const r   = this._report;
    const btn = el('btn-save-report');
    if (!r) return;
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    try {
      const exists = await Storage.exists(r.year, r.month);
      if (exists) {
        const label = `${MONTH_NAMES[r.month]} ${r.year}`;
        if (!confirm(`Ya existe un reporte guardado para ${label}. ¿Sobrescribir?`)) {
          if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar reporte'; }
          return;
        }
      }
      await Storage.save(r, this._mode);
      await App.refreshSavedMonths();
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✓ Guardado';
        btn.style.color = 'var(--prod-text)';
        setTimeout(() => { btn.textContent = '💾 Guardar reporte'; btn.style.color = ''; }, 2000);
      }
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Guardar reporte'; }
      alert(err.message);
    }
  },
};

// ════════════════════════════════════════════════════════════
// ITEM ROW HTML — shared by Report and unassigned rendering
// ════════════════════════════════════════════════════════════

function correctionsBadge(n) {
  if (!n) return '';
  const cls = n >= 5 ? 'corr-high' : n >= 3 ? 'corr-mid' : 'corr-low';
  return `<span class="${cls}">↺ ${n}</span>`;
}

function itemRowHTML(item) {
  const markers = [];
  if (item.fromRegOnly) markers.push('<span class="mark-added" title="Añadido desde Registro de Fábrica">⊕</span>');
  if (item.unconfirmed) markers.push('<span class="mark-warn"  title="No confirmado por Registro de Fábrica">⚠</span>');

  const scoreHTML = item.hasLevel
    ? fmtNum(item.score) + (item.fromReg ? '&thinsp;<span class="mark-fallback">†</span>' : '')
    : '—&ensp;<span style="color:var(--faint);font-size:11px">(sin nivel)</span>';

  const metaParts = [];
  if (item.op)   metaParts.push(esc(item.op));
  if (item.date) metaParts.push(fmtDateShort(item.date));
  if (item.corrections >= 1) metaParts.push(correctionsBadge(item.corrections));

  return `<div class="item-row">
    <div class="item-info">
      <div class="item-name${item.hasLevel ? '' : ' no-level'}">${markers.join('')}${esc(item.name)}</div>
      ${item.parent ? `<div class="item-project">${esc(item.parent)}</div>` : ''}
      ${metaParts.length ? `<div class="item-meta">${metaParts.join(' · ')}</div>` : ''}
    </div>
    <div class="item-score${item.hasLevel ? '' : ' no-level'}">${scoreHTML}</div>
  </div>`;
}

// ── Small DOM helper used throughout report.js ─────────────
function el(id) { return document.getElementById(id); }
