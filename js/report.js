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
    this._renderAlerts();   // async — updates the #alerts-section when ready
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
      { l: 'Puntos dibujo',         v: fmtNum(mt.tDraw || 0),         s: 'Dibujo de aprobación (50%)',   x: '' },
      { l: 'Puntos aprobados',      v: fmtNum(mt.tApv  || 0),         s: 'Aprobado por cliente (60%)',   x: '' },
      { l: 'Puntos producción',     v: fmtNum(mt.tPrd  || 0),         s: 'Enviado a fábrica (100%)',     x: '' },
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

  // ── Alerts section — cross-month follow-up ────────────────
  // Loads the M-1 snapshot from Firestore and compares items
  // with the current month M to surface stalled items.
  // Called fire-and-forget from _paint(); updates DOM when done.
  async _renderAlerts() {
    const wrap = el('alerts-section');
    if (!wrap) return;
    wrap.innerHTML = ''; // clear stale content while loading

    const { month, year } = this._report;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear  = month === 1 ? year - 1 : year;
    const prevLabel = `${MONTH_NAMES[prevMonth]} ${prevYear}`;
    const currLabel = `${MONTH_NAMES[month]} ${year}`;

    const prev = await Storage.load(prevYear, prevMonth);
    if (!prev) return; // no prior snapshot — skip silently

    // ── Key functions ──────────────────────────────────────
    // Current report items: .op, .name, .parent
    const mKey = i => i.op ? 'op:' + i.op
      : 'np:' + (i.name || '') + '|' + (i.parent || '');
    // Stored snapshot items: .op, .name, .project
    const sKey = i => i.op ? 'op:' + i.op
      : 'np:' + (i.name || '') + '|' + (i.project || '');

    // ── M key sets from current report ─────────────────────
    const mAllKeys  = new Set();
    const mProdKeys = new Set();
    const mApvKeys  = new Set();
    for (const d of this._report.designers) {
      for (const i of (d.drawings    || [])) mAllKeys.add(mKey(i));
      for (const i of (d.approved    || [])) { mAllKeys.add(mKey(i)); mApvKeys.add(mKey(i)); }
      for (const i of (d.productions || [])) { mAllKeys.add(mKey(i)); mProdKeys.add(mKey(i)); }
    }

    // ── M-1 items from stored snapshot (dedup by key) ──────
    const seenDraw = new Set(), seenApv = new Set();
    const prevDraw = [], prevApv = [];

    for (const [dName, d] of Object.entries(prev.designers || {})) {
      for (const item of (d.drawing || [])) {
        const k = sKey(item);
        if (!seenDraw.has(k)) { seenDraw.add(k); prevDraw.push({ k, item, designer: dName }); }
      }
      for (const item of (d.approved || [])) {
        const k = sKey(item);
        if (!seenApv.has(k)) { seenApv.add(k); prevApv.push({ k, item, designer: dName }); }
      }
    }

    // ── Classify alerts ────────────────────────────────────
    // Type 1: was in M-1 drawing, absent from M entirely
    const alert1 = prevDraw.filter(e => !mAllKeys.has(e.k));

    // Type 2/3: was in M-1 approved, not yet in M production
    //   Type 3 (subset): also still in M approved → 2+ months stalled
    const alert23 = prevApv
      .filter(e => !mProdKeys.has(e.k))
      .map(e => ({ ...e, alertType: mApvKeys.has(e.k) ? 3 : 2 }));

    const total = alert1.length + alert23.length;

    // ── Row builder ────────────────────────────────────────
    const mkRow = (e, type) => {
      const i = e.item;
      const meta = [
        i.project ? esc(i.project)    : '',
        i.op      ? `OP ${esc(i.op)}` : '',
        esc(e.designer),
      ].filter(Boolean).join(' · ');

      let icon, cls, msg;
      if (type === 1) {
        icon = '⚠';
        cls  = 'alert-type-1';
        msg  = `Dibujado en ${prevLabel} · Sin avance en ${currLabel}`;
      } else if (type === 2) {
        icon = '⚠';
        cls  = 'alert-type-2';
        msg  = `Aprobado en ${prevLabel} · Sin producción en ${currLabel}`;
      } else {
        icon = '🔴';
        cls  = 'alert-type-3';
        msg  = `Aprobado hace 2 meses · ${currLabel} y ${prevLabel} sin prod.`;
      }

      return `<div class="alert-row ${cls}">
        <div class="alert-icon">${icon}</div>
        <div class="alert-body">
          <div class="alert-name">${esc(i.name)}</div>
          <div class="alert-meta">${meta}</div>
          <div class="alert-msg">${msg}</div>
        </div>
      </div>`;
    };

    // ── Zero-alerts state ──────────────────────────────────
    if (total === 0) {
      wrap.innerHTML = `<div class="alerts-section">
        <div class="alerts-zero">✓ Sin alertas de seguimiento este mes</div>
      </div>`;
      return;
    }

    // ── Build group HTML ───────────────────────────────────
    const s1 = alert1.length ? `
      <div class="alert-group">
        <div class="alert-group-title">Sin avance desde dibujo (${alert1.length})</div>
        <div class="alert-group-body">
          ${alert1.map(e => mkRow(e, 1)).join('')}
        </div>
      </div>` : '';

    const s23 = alert23.length ? `
      <div class="alert-group">
        <div class="alert-group-title">Aprobado sin enviar a fábrica (${alert23.length})</div>
        <div class="alert-group-body">
          ${alert23.map(e => mkRow(e, e.alertType)).join('')}
        </div>
      </div>` : '';

    wrap.innerHTML = `
      <div class="alerts-section">
        <div class="alerts-header" id="alerts-header">
          <span class="alerts-title">⚠ ALERTAS DE SEGUIMIENTO</span>
          <span class="alerts-badge">${total} alerta${total !== 1 ? 's' : ''}</span>
          <button class="alerts-toggle" id="alerts-toggle">▲ Colapsar</button>
        </div>
        <div id="alerts-body">${s1}${s23}</div>
      </div>`;

    el('alerts-header').addEventListener('click', () => {
      const body = el('alerts-body');
      const btn  = el('alerts-toggle');
      if (!body || !btn) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      btn.textContent    = open ? '▼ Expandir' : '▲ Colapsar';
    });
  },

  _renderFooter() {
    el('report-footer').innerHTML = `
      <strong>Leyenda de puntuación — sistema de fases acumulativas</strong><br>
      Cada ítem tiene un valor base = <em>nivel</em>. Solo se puntúa el avance incremental alcanzado en el mes.
      <br>
      <span style="color:var(--aprob-text)">Dibujo</span> = nivel × 50%
      &nbsp;·&nbsp;
      <span style="color:var(--apv-text)">Aprobado</span> = nivel × 60% acumulado
      &nbsp;·&nbsp;
      <span style="color:var(--prod-text)">Producción</span> = nivel × 100% acumulado
      <br>
      <span style="font-size:11.5px;color:var(--muted)">
        Ejemplo: ítem N4 que pasó de Dibujo (50%) a Producción (100%) → puntúa el 50% restante = 2 pts.
        Si llegó a Producción sin fases previas guardadas → puntúa el 100% = 4 pts.
      </span>
      <div class="legend-row">
        <div class="legend-item"><span class="item-prev-phase" style="font-size:11px">desde Aprobado · Abril 2026</span> Ítem que continúa desde un mes anterior</div>
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

  // Points display — show incremental percentage used this month
  let scoreHTML;
  if (!item.hasLevel) {
    scoreHTML = '—&ensp;<span style="color:var(--faint);font-size:11px">(sin nivel)</span>';
  } else {
    const pctLbl = item.pct ? `<span style="color:var(--faint);font-size:10px;margin-left:3px">(${Math.round(item.pct * 100)}%)</span>` : '';
    const regMark = item.fromReg ? '&thinsp;<span class="mark-fallback">†</span>' : '';
    scoreHTML = fmtNum(item.score) + regMark + pctLbl;
  }

  // "Desde [phase] · [month]" annotation when item continues from a previous month
  const PHASE_LBL = { dibujo: 'Dibujo', aprobado: 'Aprobado', produccion: 'Producción' };
  const prevAnnotation = (item.prevPhase && item.prevMonthLabel)
    ? `<span class="item-prev-phase">desde ${PHASE_LBL[item.prevPhase] || item.prevPhase} · ${esc(item.prevMonthLabel)}</span>`
    : '';

  const metaParts = [];
  if (item.op)   metaParts.push(esc(item.op));
  if (item.date) metaParts.push(fmtDateShort(item.date));
  if (item.corrections >= 1) metaParts.push(correctionsBadge(item.corrections));

  return `<div class="item-row">
    <div class="item-info">
      <div class="item-name${item.hasLevel ? '' : ' no-level'}">${markers.join('')}${esc(item.name)}</div>
      ${item.parent ? `<div class="item-project">${esc(item.parent)}</div>` : ''}
      ${prevAnnotation}
      ${metaParts.length ? `<div class="item-meta">${metaParts.join(' · ')}</div>` : ''}
    </div>
    <div class="item-score${item.hasLevel ? '' : ' no-level'}">${scoreHTML}</div>
  </div>`;
}

// ── Small DOM helper used throughout report.js ─────────────
function el(id) { return document.getElementById(id); }
