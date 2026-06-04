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
  _cuTasks:  [],     // live ClickUp tasks — used by _renderAlerts

  // ── Public API ────────────────────────────────────────────

  /** Render a freshly-built report (from scoring.js). */
  render(report, mode, cuFile, regFile, cuTasks) {
    this._report   = report;
    this._mode     = mode;
    this._cuFile   = cuFile   || '';
    this._regFile  = regFile  || '';
    this._cuTasks  = cuTasks  || [];
    this._valOpen  = true;
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
      { l: 'Pts reprocesos',        v: fmtNum(mt.tRep  || 0),         s: 'Solo causa: Cliente (+10%)',   x: '' },
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
    // Note: pct, isAbove/isBelow use d.total (precise) for accurate bar/comparison.
    // The header pill uses displayTotal (computed below) for visual consistency.
    const showTiered = mode !== 'C'; // Mode C only has Producción

    // Display-consistent total: sum the already-rounded column values so that the
    // header always matches what the column subtotals add up to visually.
    // (Raw d.total can differ by ±0.1 due to float rounding, e.g. 10.25 → "10.3" but
    //  1.5 + 10.25 + 0.2 = 11.9499... → "11.9" instead of "12".)
    const displayTotal = parseFloat(fmtNum(d.dTotal || 0))
                       + parseFloat(fmtNum(d.apvTotal || 0))
                       + parseFloat(fmtNum(d.pTotal || 0))
                       + parseFloat(fmtNum(d.rTotal || 0));

    const ptsPerItem = d.itemCount > 0 ? (displayTotal / d.itemCount).toFixed(1) : '0.0';

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
         <span class="pill pill-neutral">${totalItems} ítem${totalItems !== 1 ? 's' : ''}</span>
         ${(d.reprocesos || []).length > 0 ? `<span class="pill pill-reproc">${(d.reprocesos||[]).length} reproc</span>` : ''}`
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

    const reprocesos    = d.reprocesos || [];
    const mkReprocesoCol = items => {
      const hdr = `<div class="col-heading"><div class="col-dot" style="background:#f59e0b"></div><span style="color:#f59e0b">Reprocesos</span></div>`;
      if (!items.length) return `<div class="item-col reproc-col">${hdr}<div class="col-empty">Sin reprocesos este mes</div></div>`;
      const subtotal = parseFloat(items.reduce((s,i) => s + i.pts, 0).toFixed(2));
      return `<div class="item-col reproc-col">${hdr}${items.map(reprocesoRowHTML).join('')}<div class="col-subtotal"><span>Subtotal</span><span>${fmtNum(subtotal)} pts</span></div></div>`;
    };

    const bodyClass = showTiered ? 'four-col' : 'single-col';
    const bodyContent = showTiered
      ? mkCol(d.drawings    || [], 'Dibujo',     'var(--aprob-text)')
      + mkCol(d.approved    || [], 'Aprobado',   'var(--apv-text)')
      + mkCol(d.productions,       'Producción', 'var(--prod-text)')
      + mkReprocesoCol(reprocesos)
      : mkCol(d.productions,       'Producción', 'var(--prod-text)');

    // Safe ID for per-designer alert placeholder (no spaces or special chars)
    const safeId = 'dalerts-' + d.name.replace(/[^a-zA-Z0-9]/g, '_');

    return `
    <div class="designer-card">
      <div class="card-header">
        <div class="card-top">
          <div class="designer-dot" style="background:${d.color}"></div>
          <div class="designer-name">${esc(d.name)}</div>
          <div class="pills">
            <span class="pill ${pc}">${fmtNum(displayTotal)} pts${arrow}</span>
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
      <div class="designer-alerts-wrap" id="${safeId}"></div>
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
  // Scans ALL stored snapshots to surface items stalled across
  // 3 categories. Uses live cuTasks for current status + dates.
  // Called fire-and-forget from _paint(); updates DOM when ready.
  async _renderAlerts() {
    const wrap = el('alerts-section');
    if (!wrap) return;
    wrap.innerHTML = '';

    const { month, year } = this._report;
    const cuTasks = this._cuTasks || [];

    // ── Live task lookup maps ──────────────────────────────
    const cuByOp = new Map();
    const cuByNP = new Map();
    for (const t of cuTasks) {
      const op = (t.op || '').trim();
      if (op) cuByOp.set(op, t);
      cuByNP.set((t.name || '') + '|' + (t.parent || ''), t);
    }
    const getLive = (op, name, project) => {
      if (op && cuByOp.has(op)) return cuByOp.get(op);
      return cuByNP.get((name || '') + '|' + (project || '')) || null;
    };

    // ── Key helpers ────────────────────────────────────────
    // stored items have .op / .name / .project
    const sKey = i => i.op ? 'op:' + i.op
      : 'np:' + (i.name || '') + '|' + (i.project || '');
    // current-report items have .op / .name / .parent
    const mKey = i => i.op ? 'op:' + i.op
      : 'np:' + (i.name || '') + '|' + (i.parent || '');

    // ── Load all previous snapshots ────────────────────────
    const allSnaps = await Storage.loadAll();
    const prevSnaps = allSnaps.filter(
      s => s.year < year || (s.year === year && s.month < month)
    );

    // ── Build per-item history from previous snapshots ─────
    // history[key] = {
    //   phases: Set<phase>,
    //   mostRecent: { dibujo|aprobado|produccion: {year,month,date} },
    //   designer, name, project, op
    // }
    const INFER_PHASE = { drawing: 'dibujo', approved: 'aprobado', prod: 'produccion' };
    const history = new Map();

    for (const snap of prevSnaps) {
      for (const [dName, d] of Object.entries(snap.designers || {})) {
        for (const [arr, inferPhase] of Object.entries(INFER_PHASE)) {
          for (const item of (d[arr] || [])) {
            const k = sKey(item);
            const phase = item.phase || inferPhase;
            if (!history.has(k)) {
              history.set(k, {
                phases:     new Set(),
                mostRecent: {},
                _lastSnap:  null,
                designer:   dName,
                name:       item.name    || '',
                project:    item.project || '',
                op:         item.op      || '',
              });
            }
            const h = history.get(k);
            h.phases.add(phase);
            // Track most-recent month per phase
            const mr = h.mostRecent[phase];
            if (!mr || snap.year > mr.year || (snap.year === mr.year && snap.month > mr.month)) {
              h.mostRecent[phase] = { year: snap.year, month: snap.month, date: item.date || null };
            }
            // Update designer to most-recently-seen snapshot
            if (!h._lastSnap || snap.year > h._lastSnap.year ||
                (snap.year === h._lastSnap.year && snap.month > h._lastSnap.month)) {
              h._lastSnap = { year: snap.year, month: snap.month };
              h.designer  = dName;
            }
          }
        }
      }
    }

    // ── Current-report key sets ────────────────────────────
    const currAllKeys  = new Set();
    const currProdKeys = new Set();
    for (const d of this._report.designers) {
      for (const i of (d.drawings    || [])) currAllKeys.add(mKey(i));
      for (const i of (d.approved    || [])) currAllKeys.add(mKey(i));
      for (const i of (d.productions || [])) {
        currAllKeys.add(mKey(i));
        currProdKeys.add(mKey(i));
      }
    }

    // ── Status sets for filtering ──────────────────────────
    const DRAW_STALLED = new Set([
      'en dibujo', 'enviado a aprobacion', 'revision de constructivo',
    ]);
    const COMPLETED = new Set([
      'completado', 'cerrado', 'produccion completada',
      'entregado', 'archivado', 'complete', 'closed',
    ]);

    // ── Helper: format a date string for display ───────────
    // Accepts either "DD/MM/YYYY" (stored) or ClickUp "Weekday, Month D YYYY"
    const fmtAlertDate = str => {
      if (!str) return '';
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(str)) return fmtDateShort(str);
      const d = parseCUDate(str);
      return d ? fmtDateShort(fmtDate(d)) : '';
    };

    // ── Classify into 3 categories ─────────────────────────
    const cat1 = [], cat2 = [];

    for (const [key, h] of history) {
      const live       = getLive(h.op, h.name, h.project);
      const liveStatus = normStr(live?.status || '');

      // ─── Cat 1: Estancado en dibujo ───────────────────────
      if (
        h.phases.has('dibujo') &&
        !h.phases.has('aprobado') &&
        !h.phases.has('produccion') &&
        !currAllKeys.has(key)
      ) {
        // Only alert if live status confirms still in drawing, or no live task found
        if (!live || DRAW_STALLED.has(liveStatus)) {
          const mr = h.mostRecent['dibujo'];
          let dateRaw, dateLbl;
          if (live?.envioAprobacion) {
            dateRaw = live.envioAprobacion;
            dateLbl = 'Fecha envío a aprobación';
          } else if (live?.finDibujo) {
            dateRaw = live.finDibujo;
            dateLbl = 'Fecha fin dibujo';
          } else {
            dateRaw = mr?.date || null;
            dateLbl = 'Últ. fecha dibujo';
          }
          cat1.push({
            ...h, key, live, liveStatus, dateRaw, dateLbl,
            stuckSince: mr ? `${MONTH_NAMES[mr.month]} ${mr.year}` : '—',
          });
        }
      }

      // ─── Cat 2: Aprobado sin producción ───────────────────
      if (
        h.phases.has('aprobado') &&
        !h.phases.has('produccion') &&
        !currProdKeys.has(key)
      ) {
        if (!live || liveStatus === 'aprobado') {
          const mr      = h.mostRecent['aprobado'];
          const dateRaw = live?.aprobado || mr?.date || null;
          cat2.push({
            ...h, key, live, liveStatus, dateRaw,
            stuckSince: mr ? `${MONTH_NAMES[mr.month]} ${mr.year}` : '—',
          });
        }
      }

    }

    // ── Cat 4: Reprocesos pendientes ───────────────────────
    const cat4 = [];
    const today = new Date();
    for (const t of cuTasks) {
      if (!t.inicioReproceso || t.finReproceso) continue;
      const dIni = parseCUDate(t.inicioReproceso);
      if (!dIni) continue;
      const daysDiff = Math.floor((today - dIni) / (1000 * 60 * 60 * 24));
      if (daysDiff < 7) continue;
      const designersList = mapDesignersCU(t.assignee || '');
      const designer      = designersList[0] || '—';
      const causa         = normalizeCausa(t.causaReproceso);
      const live          = getLive(t.op || '', t.name || '', t.parent || '');
      cat4.push({
        name:       t.name    || '',
        op:         t.op      || '',
        project:    t.parent  || '',
        designer,
        daysDiff,
        dateRaw:    fmtDate(dIni),
        causa,
        liveStatus: normStr(live?.status || ''),
        live,
      });
    }

    const total = cat1.length + cat2.length + cat4.length;

    // ── Status badge class (shared by per-designer + global) ──
    const sbClass = rawStatus => {
      if (!rawStatus) return 'sb-notfound';
      const s = normStr(rawStatus);
      if (s === 'en dibujo')                              return 'sb-dibujo';
      if (s.includes('aprobacion'))                       return 'sb-aprobacion';
      if (s.includes('revision') || s.includes('constructivo')) return 'sb-revision';
      if (s === 'aprobado')                               return 'sb-aprobado';
      if (s.includes('ebanisteria') || s.includes('fabrica') ||
          s.includes('produccion'))                       return 'sb-ebanisteria';
      return 'sb-other';
    };

    // ── Row HTML ───────────────────────────────────────────
    const CAT_ICON  = { 1: '🟡', 2: '🟠', 3: '🔴' };
    const DATE_LBL  = { 1: 'Últ. fecha dibujo', 2: 'Fecha aprobado', 3: 'Envío fábrica' };

    const mkRow = (e, cat) => {
      const statusLabel = e.live?.status ? esc(e.live.status) : '—';
      const dateFmt     = fmtAlertDate(e.dateRaw);
      const dateLbl     = e.dateLbl || DATE_LBL[cat];
      const metaParts   = [
        e.project ? esc(e.project)    : '',
        e.op      ? `OP ${esc(e.op)}` : '',
        esc(e.designer),
      ].filter(Boolean).join(' · ');

      return `<div class="alert-row alert-cat-${cat}">
        <div class="alert-row-top">
          <span class="alert-icon-inline">${CAT_ICON[cat]}</span>
          <span class="alert-name">${esc(e.name)}</span>
          <span class="alert-status-badge ${sbClass(e.live?.status)}">${statusLabel}</span>
        </div>
        <div class="alert-meta2">${metaParts}</div>
        <div class="alert-stuck">Desde ${esc(e.stuckSince)}${cat === 3 ? ` · ${e.monthsDiff} mes${e.monthsDiff !== 1 ? 'es' : ''}` : ''}</div>
        ${dateFmt
          ? `<div class="alert-date"><span class="alert-date-lbl">${dateLbl}</span> ${dateFmt}</div>`
          : `<div class="alert-date alert-date-none">Sin fecha registrada</div>`}
      </div>`;
    };

    // ── Group HTML (always shows all 3 categories) ─────────
    const mkGroup = (items, cat, emoji, title) => `
      <div class="alert-group">
        <div class="alert-group-hdr">
          <span class="alert-group-emoji">${emoji}</span>
          <span class="alert-group-title">${esc(title)}</span>
          ${items.length ? `<span class="alerts-badge">${items.length}</span>` : ''}
        </div>
        ${items.length
          ? `<div class="alert-rows">${items.map(e => mkRow(e, cat)).join('')}</div>`
          : `<div class="alert-ok">✓ Sin ítems en esta categoría</div>`}
      </div>`;

    const mkRow4 = e => {
      const causeTxt = e.causa === 'Cliente' ? 'Cliente' : e.causa === 'Diseñador' ? 'Diseñador' : 'Sin causa';
      const metaParts = [
        e.project ? esc(e.project) : '',
        e.op      ? `OP ${esc(e.op)}` : '',
        esc(e.designer),
      ].filter(Boolean).join(' · ');
      return `<div class="alert-row alert-cat-1">
        <div class="alert-row-top">
          <span class="alert-icon-inline">⚠</span>
          <span class="alert-name">${esc(e.name)}</span>
          <span class="alert-status-badge sb-revision">En reproceso</span>
        </div>
        <div class="alert-meta2">${metaParts}</div>
        <div class="alert-stuck">Iniciado el ${esc(e.dateRaw || '—')} · ${e.daysDiff} día${e.daysDiff !== 1 ? 's' : ''} sin entregar</div>
        <div class="alert-date"><span class="alert-date-lbl">Causa</span> <span class="reproc-cause-badge ${e.causa === 'Cliente' ? 'reproc-cause-cliente' : 'reproc-cause-disenador'}">${esc(causeTxt)}</span></div>
      </div>`;
    };

    // ── Inject per-designer alert mini-panels ─────────────
    for (const d of this._report.designers) {
      const safeId  = 'dalerts-' + d.name.replace(/[^a-zA-Z0-9]/g, '_');
      const slot    = document.getElementById(safeId);
      if (!slot) continue;

      const dCat1 = cat1.filter(e => e.designer === d.name);
      const dCat2 = cat2.filter(e => e.designer === d.name);
      const dTotal = dCat1.length + dCat2.length;

      if (!dTotal) { slot.innerHTML = ''; continue; }

      const mkDGroup = (items, cat, emoji, label) => items.length === 0 ? '' : `
        <div class="dalert-group">
          <div class="dalert-group-hdr">
            <span>${emoji}</span>
            <span class="dalert-group-title">${label}</span>
            <span class="dalert-count">${items.length}</span>
          </div>
          <div class="alert-rows">${items.map(e => mkRow(e, cat)).join('')}</div>
        </div>`;

      slot.innerHTML = `
        <div class="designer-alerts-inner">
          <div class="dalert-hdr">
            <span class="dalert-title">⚠ Alertas de seguimiento</span>
            <span class="alerts-badge">${dTotal}</span>
          </div>
          ${mkDGroup(dCat1, 1, '🟡', 'Estancado en dibujo')}
          ${mkDGroup(dCat2, 2, '🟠', 'Aprobado sin producción')}
        </div>`;
    }

    const reportTitle = `Alertas · ${MONTH_NAMES[month]} ${year}`;

    wrap.innerHTML = `
      <div class="alerts-section">
        <div class="alerts-header" id="alerts-header">
          <span class="alerts-title">⚠ ALERTAS DE SEGUIMIENTO</span>
          ${total ? `<span class="alerts-badge">${total} alerta${total !== 1 ? 's' : ''}</span>` : ''}
          <button class="alerts-print-btn" id="alerts-print-btn" title="Imprimir / guardar como PDF">🖨</button>
          <button class="alerts-toggle" id="alerts-toggle">▲ Colapsar</button>
        </div>
        <div id="alerts-body">
          ${mkGroup(cat1, 1, '🟡', 'Estancado en dibujo')}
          ${mkGroup(cat2, 2, '🟠', 'Aprobado sin producción')}
          ${cat4.length ? `<div class="alert-group"><div class="alert-group-hdr"><span class="alert-group-emoji">⚠</span><span class="alert-group-title">Reprocesos pendientes</span><span class="alerts-badge">${cat4.length}</span></div><div class="alert-rows">${cat4.map(mkRow4).join('')}</div></div>` : ''}
        </div>
      </div>`;

    // ── Collapse toggle ────────────────────────────────────
    const hdr = el('alerts-header');
    if (hdr) hdr.addEventListener('click', e => {
      // Don't collapse when clicking the print or toggle buttons directly
      if (e.target.closest('#alerts-toggle, #alerts-print-btn')) return;
      const body = el('alerts-body');
      const btn  = el('alerts-toggle');
      if (!body || !btn) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      btn.textContent    = open ? '▼ Expandir' : '▲ Colapsar';
    });
    const toggleBtn = el('alerts-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
      const body = el('alerts-body');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      toggleBtn.textContent = open ? '▼ Expandir' : '▲ Colapsar';
    });

    // ── Print button ───────────────────────────────────────
    const printBtn = el('alerts-print-btn');
    if (printBtn) printBtn.addEventListener('click', e => {
      e.stopPropagation();
      this._printAlerts(reportTitle);
    });
  },

  /** Open a stripped-down window with just the alerts and trigger print. */
  _printAlerts(title) {
    const body = el('alerts-body');
    if (!body) return;

    // Pull the main stylesheet href so the popup gets the same classes
    const styleLink = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map(l => `<link rel="stylesheet" href="${l.href}">`)
      .join('\n');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>${esc(title)}</title>
  ${styleLink}
  <style>
    body { margin: 24px 28px; font-family: inherit; background: #fff; }
    .alerts-print-title { font-size: 17px; font-weight: 700; margin-bottom: 16px; color: #1e293b; }
    /* hide print / toggle controls inside the popup */
    #alerts-print-btn, .alerts-toggle { display: none !important; }
    .alerts-header { cursor: default !important; }
    @media print {
      body { margin: 10mm 12mm; }
      @page { margin: 10mm 12mm; size: A4; }
    }
  </style>
</head>
<body>
  <div class="alerts-print-title">${esc(title)}</div>
  <div class="alerts-section">
    <div class="alerts-header">
      <span class="alerts-title">⚠ ALERTAS DE SEGUIMIENTO</span>
    </div>
    <div id="alerts-body">${body.innerHTML}</div>
  </div>
  <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); };<\/script>
</body>
</html>`;

    const w = window.open('', '_blank', 'width=900,height=700');
    if (w) { w.document.write(html); w.document.close(); }
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

function reprocesoRowHTML(item) {
  const isMuted  = item.causa !== 'Cliente';
  const causeTxt = item.causa === 'Cliente'   ? 'Cliente'
                 : item.causa === 'Diseñador' ? 'Diseñador' : 'Sin causa';
  const causeCls = item.causa === 'Cliente' ? 'reproc-cause-cliente' : 'reproc-cause-disenador';
  const ptsLabel = item.pts > 0 ? `+${fmtNum(item.pts)} pt` : '0 pts';
  const ptsCls   = item.pts > 0 ? 'reproc-pts-cliente' : 'reproc-pts-zero';
  const nivStr   = item.level !== null ? `N${fmtNum(item.level)}` : '—';
  const dateFmt  = item.finReproceso ? fmtDateShort(item.finReproceso) : '';
  const metaParts = [
    item.op      ? `OP ${esc(item.op)}` : '',
    dateFmt,
    `<span class="item-niv">${esc(nivStr)}</span>`,
  ].filter(Boolean);
  return `<div class="item-row reproc-row${isMuted ? ' reproc-muted' : ''}">
    <div class="item-info">
      <div class="item-name">${esc(item.name)}</div>
      ${item.parent ? `<div class="item-project">${esc(item.parent)}</div>` : ''}
      ${metaParts.length ? `<div class="item-meta">${metaParts.join(' · ')}</div>` : ''}
    </div>
    <div class="item-score">
      <span class="${ptsCls}">${ptsLabel}</span>
      <span class="reproc-cause-badge ${causeCls}">${esc(causeTxt)}</span>
    </div>
  </div>`;
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
