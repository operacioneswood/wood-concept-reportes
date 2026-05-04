// ─────────────────────────────────────────────────────────────
// js/schedule.js — Cronograma tab
//
// Depends on: config.js (PC_ROLES, DESIGNER_COLORS, CU_MAP,
//             CU_EXCLUDE, mapDesignersCU, normStr, esc, fmtNum)
//             parser.js (_cuFieldVal)
// ─────────────────────────────────────────────────────────────

const Schedule = {
  _cuRows:   null,
  _rawTasks: null,
  _fieldIds: null,
  _items:    [],
  _view:     'gantt',
  _cfg:      null,

  SCHED_KEY: 'wc_sched_cfg',
  SR_LIST:   ['Ana G', 'Johana Ruiz', 'Daniel B', 'Karla Díaz'],
  JR_LIST:   ['Fabián P', 'Sebastian R', 'Luis V'],

  DEFAULT_TIMES: {
    drawTiers: [
      { maxNivel: 2.0,  days: 1   },
      { maxNivel: 4.0,  days: 2   },
      { maxNivel: 6.0,  days: 2.5 },
      { maxNivel: 8.0,  days: 3   },
      { maxNivel: 10.0, days: 4   },
    ],
    srReview:     0.5,
    srSend:       0.5,
    clientWait:   7,
    jrCorr:       1,
    srReviewCorr: 0.5,
    srElabOP:     1,
  },

  // ── Public API ─────────────────────────────────────────────

  render(cuRows) {
    if (cuRows !== undefined) this._cuRows = cuRows;
    this._loadConfig();
    if (this._cuRows) this._items = this._parseCSV(this._cuRows);
    this._purgeOldPC();
    this._renderAll();
  },

  renderFromAPI(rawTasks, fieldIds) {
    if (rawTasks !== undefined) this._rawTasks = rawTasks;
    if (fieldIds  !== undefined) this._fieldIds  = fieldIds;
    this._loadConfig();
    if (this._rawTasks) this._items = this._parseAPI(this._rawTasks, this._fieldIds);
    this._purgeOldPC();
    this._renderAll();
  },

  // ── LocalStorage helpers ───────────────────────────────────

  _purgeOldPC() {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('wc_pc_')) localStorage.removeItem(k);
    }
  },

  _loadConfig() {
    try {
      const raw = localStorage.getItem(this.SCHED_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        const dt = this.DEFAULT_TIMES;
        const tiers = Array.isArray(p.times?.drawTiers) && p.times.drawTiers.length === 5
          ? p.times.drawTiers.map((t, i) => ({ maxNivel: dt.drawTiers[i].maxNivel, days: +t.days || dt.drawTiers[i].days }))
          : dt.drawTiers.map(t => ({ ...t }));
        this._cfg = {
          pairs:    p.pairs    || {},
          priority: p.priority || {},
          times: {
            drawTiers:    tiers,
            srReview:     +(p.times?.srReview     ?? dt.srReview),
            srSend:       +(p.times?.srSend        ?? dt.srSend),
            clientWait:   +(p.times?.clientWait    ?? dt.clientWait),
            jrCorr:       +(p.times?.jrCorr        ?? dt.jrCorr),
            srReviewCorr: +(p.times?.srReviewCorr  ?? dt.srReviewCorr),
            srElabOP:     +(p.times?.srElabOP       ?? dt.srElabOP),
          },
        };
        return;
      }
    } catch (_) {}
    const dt = this.DEFAULT_TIMES;
    this._cfg = {
      pairs:    {},
      priority: {},
      times: { ...dt, drawTiers: dt.drawTiers.map(t => ({ ...t })) },
    };
  },

  _saveConfig() {
    localStorage.setItem(this.SCHED_KEY, JSON.stringify(this._cfg));
  },

  // ── CSV parsing ────────────────────────────────────────────

  _parseCSV(rows) {
    if (!rows || rows.length < 2) return [];
    const hdr = rows[0].map(h => normStr(h));
    const col  = key => hdr.findIndex(h => h === key || h.startsWith(key));

    const iName   = col('task name') !== -1 ? col('task name') : col('name');
    const iParent = col('parent name');
    const iNivel  = hdr.findIndex(h => h.startsWith('nivel'));
    const iAsgn   = col('assignee');
    const iStatus = col('status');
    const iCorr   = hdr.findIndex(h => h.includes('correcciones'));

    const ACTIVE = new Set(['en dibujo', 'enviado a aprobacion',
      'revision de constructivo', 'aprobado', 'proximos a entrar']);

    const items = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(c => !c.trim())) continue;
      const rawStatus = normStr(row[iStatus] || '');
      if (!ACTIVE.has(rawStatus)) continue;

      const designers = mapDesignersCU(row[iAsgn] || '');
      if (!designers.length) continue;

      const nivelRaw = iNivel !== -1 ? (row[iNivel] || '').trim() : '';
      const nivel    = nivelRaw ? (parseFloat(nivelRaw) || null) : null;
      const name     = iName   !== -1 ? (row[iName]   || '').trim() : '';
      const project  = iParent !== -1 ? (row[iParent] || '').trim() : '';
      const corr     = iCorr   !== -1 ? (parseInt(row[iCorr] || '0') || 0) : 0;

      for (const designer of designers) {
        items.push({ id: `${name}|${project}`, name, project, nivel, status: rawStatus, corrections: corr, designer });
      }
    }
    return items;
  },

  // ── API parsing ────────────────────────────────────────────

  _parseAPI(rawTasks, fieldIds) {
    const fids = fieldIds || {};
    const ACTIVE = new Set(['en dibujo', 'enviado a aprobacion',
      'revision de constructivo', 'aprobado', 'proximos a entrar']);
    const nameById = new Map((rawTasks || []).map(t => [t.id, t.name || '']));

    const items = [];
    for (const t of (rawTasks || [])) {
      const rawStatus = normStr(t.status?.status || '');
      if (!ACTIVE.has(rawStatus)) continue;

      const designers = (t.assignees || [])
        .map(a => (a.username || a.name || '').trim())
        .filter(Boolean)
        .map(n => { const f = normStr(n.split(' ')[0]); return CU_EXCLUDE.has(f) ? null : (CU_MAP[n] || n); })
        .filter(Boolean);
      if (!designers.length) continue;

      const nivRaw  = _cuFieldVal(t, fids.nivel);
      const nivel   = nivRaw !== '' ? (parseFloat(nivRaw) || null) : null;
      const corrRaw = _cuFieldVal(t, fids.corrections);
      const parent  = t.parent ? (nameById.get(t.parent) || '') : (t.folder?.name || t.list?.name || '');

      for (const designer of designers) {
        items.push({ id: `${t.name || ''}|${parent}`, name: t.name || '', project: parent,
          nivel, status: rawStatus, corrections: parseInt(corrRaw || '0') || 0, designer });
      }
    }
    return items;
  },

  // ── Timeline calculation ───────────────────────────────────

  _getDrawDays(nivel, times) {
    if (nivel === null || nivel === undefined) return times.drawTiers[2].days;
    for (const tier of times.drawTiers) {
      if (nivel <= tier.maxNivel) return tier.days;
    }
    return times.drawTiers[times.drawTiers.length - 1].days;
  },

  _getPairs() {
    return this.SR_LIST.map(sr => ({ sr, jr: this._cfg.pairs[sr] || null }));
  },

  _itemsForPair(pair) {
    return this._items.filter(item =>
      item.designer === pair.sr || (pair.jr && item.designer === pair.jr)
    );
  },

  _applyPriority(items, pairKey) {
    const order   = this._cfg.priority[pairKey] || [];
    const rankOf  = new Map(order.map((id, i) => [id, i]));
    return [...items].sort((a, b) => {
      const ai = rankOf.has(a.id) ? rankOf.get(a.id) : Infinity;
      const bi = rankOf.has(b.id) ? rankOf.get(b.id) : Infinity;
      return ai - bi;
    });
  },

  _calcTimeline(pair, orderedItems) {
    const times = this._cfg.times;
    const srOnly = !pair.jr;
    let jrAvail = 0, srAvail = 0;
    return orderedItems.map(item => {
      const r = this._calcItem(item, times, jrAvail, srAvail, srOnly);
      jrAvail = r._jrE;
      srAvail = r._srE;
      return r;
    });
  },

  _calcItem(item, times, jrAvail, srAvail, srOnly) {
    const s       = normStr(item.status || '');
    const drawDays = this._getDrawDays(item.nivel, times);
    const corrDays = Math.max(1, item.corrections || 0) * times.jrCorr;

    if (srOnly) return this._calcSrOnly(item, times, Math.max(jrAvail, srAvail), drawDays, corrDays, s);

    let jrE = jrAvail, srE = srAvail;
    const phases = [];

    const skip1  = s === 'revision de constructivo' || s === 'enviado a aprobacion' || s === 'aprobado';
    const skip23 = s === 'enviado a aprobacion' || s === 'aprobado';
    const skip4  = s === 'aprobado';

    if (!skip1) {
      const e = jrE + drawDays;
      phases.push({ id: 1, label: 'Jr dibujando', start: jrE, end: e });
      jrE = e;
    }

    if (!skip23) {
      const s2 = Math.max(skip1 ? 0 : jrE, srE);
      const e2 = s2 + times.srReview;
      phases.push({ id: 2, label: 'Sr revisando', start: s2, end: e2 });
      srE = e2;
      const e3 = srE + times.srSend;
      phases.push({ id: 3, label: 'Sr enviando', start: srE, end: e3 });
      srE = e3;
    }

    let clientEnd = 0;
    if (!skip4) {
      const s4 = skip23 ? 0 : srE;
      const e4 = s4 + times.clientWait;
      phases.push({ id: 4, label: 'En aprobación', start: s4, end: e4 });
      clientEnd = e4;
    }

    const s5 = Math.max(clientEnd, jrE);
    const e5 = s5 + corrDays;
    phases.push({ id: 5, label: 'Jr correcciones', start: s5, end: e5 });
    jrE = e5;

    const s6 = Math.max(jrE, srE);
    const e6 = s6 + times.srReviewCorr;
    phases.push({ id: 6, label: 'Sr rev. corr.', start: s6, end: e6 });
    srE = e6;

    const e7 = srE + times.srElabOP;
    phases.push({ id: 7, label: 'Listo para fábrica', start: srE, end: e7 });
    srE = e7;

    return { ...item, phases, fabricaDays: srE, currentPhase: this._currentPhase(s, false), _jrE: jrE, _srE: srE };
  },

  _calcSrOnly(item, times, avail, drawDays, corrDays, s) {
    let t = avail;
    const phases = [];
    const skip1  = s === 'revision de constructivo' || s === 'enviado a aprobacion' || s === 'aprobado';
    const skip23 = s === 'enviado a aprobacion' || s === 'aprobado';
    const skip4  = s === 'aprobado';

    if (!skip1) { phases.push({ id: 1, label: 'Sr dibujando', start: t, end: t + drawDays }); t += drawDays; }
    if (!skip23) {
      phases.push({ id: 2, label: 'Sr revisando', start: t, end: t + times.srReview }); t += times.srReview;
      phases.push({ id: 3, label: 'Sr enviando',  start: t, end: t + times.srSend   }); t += times.srSend;
    }
    if (!skip4) {
      const s4 = skip23 ? avail : t;
      const e4 = s4 + times.clientWait;
      phases.push({ id: 4, label: 'En aprobación', start: s4, end: e4 });
      t = Math.max(t, e4);
    }
    phases.push({ id: 5, label: 'Sr correcciones', start: t, end: t + corrDays }); t += corrDays;
    phases.push({ id: 6, label: 'Sr rev. corr.',   start: t, end: t + times.srReviewCorr }); t += times.srReviewCorr;
    phases.push({ id: 7, label: 'Listo para fábrica', start: t, end: t + times.srElabOP }); t += times.srElabOP;

    return { ...item, phases, fabricaDays: t, currentPhase: this._currentPhase(s, true), _jrE: t, _srE: t };
  },

  _currentPhase(status, srOnly) {
    const map = {
      'proximos a entrar':         srOnly ? 'Sr dibujando'   : 'Jr dibujando',
      'en dibujo':                 srOnly ? 'Sr dibujando'   : 'Jr dibujando',
      'revision de constructivo':  'Sr revisando',
      'enviado a aprobacion':      'En aprobación',
      'aprobado':                  srOnly ? 'Sr correcciones': 'Jr correcciones',
    };
    return map[status] || (srOnly ? 'Sr dibujando' : 'Jr dibujando');
  },

  // ── Business day helpers ───────────────────────────────────

  _addBizDays(date, n) {
    const d = new Date(date);
    let rem = n;
    while (rem > 0.001) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) rem = Math.max(0, rem - 1);
    }
    return d;
  },

  _bizDateStr(bizDays, short) {
    const d = this._addBizDays(new Date(), bizDays);
    return short
      ? d.toLocaleDateString('es', { day: '2-digit', month: 'short' })
      : d.toLocaleDateString('es', { day: '2-digit', month: 'long' });
  },

  // ── Main render ────────────────────────────────────────────

  _renderAll() {
    const body = document.getElementById('sched-body');
    if (!body) return;

    const hasSource = this._cuRows || this._rawTasks;
    if (!hasSource) {
      body.innerHTML = `<div class="wl-prompt">
        <div class="wl-prompt-icon">📅</div>
        <p>Carga datos de ClickUp en <strong>Inicio</strong> para ver el cronograma.</p>
      </div>`;
      return;
    }

    const pairs       = this._getPairs();
    const pairResults = pairs.map(pair => {
      const pairKey = `${pair.sr}|${pair.jr || ''}`;
      const raw     = this._itemsForPair(pair);
      const ordered = this._applyPriority(raw, pairKey);
      const timeline = this._calcTimeline(pair, ordered);
      return { pair, pairKey, items: ordered, timeline };
    });

    body.innerHTML = `
      <div class="sched-toolbar">
        <div class="sched-view-tabs">
          <button class="sched-tab ${this._view === 'gantt'          ? 'active' : ''}" data-view="gantt">📊 Gantt</button>
          <button class="sched-tab ${this._view === 'lista'          ? 'active' : ''}" data-view="lista">📋 Lista por par</button>
          <button class="sched-tab ${this._view === 'disponibilidad' ? 'active' : ''}" data-view="disponibilidad">⏱ Disponibilidad</button>
        </div>
        <button class="btn-secondary" id="sched-cfg-btn">⚙ Configuración</button>
      </div>
      <div id="sched-cfg-panel" style="display:none"></div>
      <div id="sched-content"></div>`;

    body.querySelectorAll('.sched-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._view = btn.dataset.view;
        body.querySelectorAll('.sched-tab').forEach(b => b.classList.toggle('active', b.dataset.view === this._view));
        this._renderContent(document.getElementById('sched-content'), pairResults);
      });
    });

    const cfgBtn = document.getElementById('sched-cfg-btn');
    if (cfgBtn) cfgBtn.addEventListener('click', () => {
      const panel = document.getElementById('sched-cfg-panel');
      if (!panel) return;
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      cfgBtn.textContent  = open ? '⚙ Configuración' : '✕ Cerrar configuración';
      if (!open) this._renderConfig(panel);
    });

    this._renderContent(document.getElementById('sched-content'), pairResults);
  },

  _renderContent(el, pairResults) {
    if (!el) return;
    if      (this._view === 'gantt')          this._renderGantt(el, pairResults);
    else if (this._view === 'lista')          this._renderLista(el, pairResults);
    else if (this._view === 'disponibilidad') this._renderDisp(el, pairResults);
  },

  // ── Config panel ───────────────────────────────────────────

  _renderConfig(panel) {
    const { pairs, times } = this._cfg;

    const pairRows = this.SR_LIST.map(sr => {
      const cur = pairs[sr] || '';
      const opts = `<option value="">Sin asignar</option>` +
        this.JR_LIST.map(jr => {
          const owner = Object.entries(pairs).find(([s, j]) => j === jr && s !== sr)?.[0];
          return `<option value="${jr}" ${cur === jr ? 'selected' : ''} ${owner ? 'disabled' : ''}>${esc(jr)}${owner ? ` (→ ${esc(owner)})` : ''}</option>`;
        }).join('');
      return `<tr><td class="cfg-sr-name">${esc(sr)}</td><td>→</td>
        <td><select class="cfg-jr-select" data-sr="${esc(sr)}">${opts}</select></td></tr>`;
    }).join('');

    const tierRows = times.drawTiers.map((t, i) => {
      const from = i === 0 ? 1 : times.drawTiers[i - 1].maxNivel + 0.5;
      return `<tr>
        <td class="cfg-time-label">Nivel ${from}–${t.maxNivel}</td>
        <td><input class="cfg-time-input" type="number" min="0.5" max="10" step="0.5" data-key="draw" data-idx="${i}" value="${t.days}"></td>
        <td class="cfg-time-unit">días en dibujo</td></tr>`;
    }).join('');

    const fixedRows = [
      { key: 'srReview',     label: 'Sr revisa dibujo',         val: times.srReview     },
      { key: 'srSend',       label: 'Sr envía aprobación',       val: times.srSend       },
      { key: 'clientWait',   label: 'Espera cliente (hábiles)',  val: times.clientWait   },
      { key: 'jrCorr',       label: 'Jr correcciones / ronda',   val: times.jrCorr       },
      { key: 'srReviewCorr', label: 'Sr revisa correcciones',    val: times.srReviewCorr },
      { key: 'srElabOP',     label: 'Sr elabora OP + fábrica',  val: times.srElabOP     },
    ].map(ft => `<tr>
      <td class="cfg-time-label">${esc(ft.label)}</td>
      <td><input class="cfg-time-input" type="number" min="0.5" max="30" step="0.5" data-key="${ft.key}" value="${ft.val}"></td>
      <td class="cfg-time-unit">días hábiles</td></tr>`).join('');

    panel.innerHTML = `
      <div class="sched-config-panel">
        <div class="sched-config-inner">
          <div class="sched-cfg-section">
            <div class="sched-cfg-title">Pares Sr + Jr</div>
            <table class="cfg-pairs-table">${pairRows}</table>
          </div>
          <div class="sched-cfg-section">
            <div class="sched-cfg-title">Días por nivel</div>
            <table class="cfg-times-table">${tierRows}</table>
          </div>
          <div class="sched-cfg-section">
            <div class="sched-cfg-title">Tiempos fijos</div>
            <table class="cfg-times-table">${fixedRows}</table>
          </div>
        </div>
      </div>`;

    panel.querySelectorAll('.cfg-jr-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const sr = sel.dataset.sr;
        const jr = sel.value || null;
        if (jr) {
          for (const [s] of Object.entries(this._cfg.pairs)) {
            if (this._cfg.pairs[s] === jr && s !== sr) this._cfg.pairs[s] = null;
          }
        }
        this._cfg.pairs[sr] = jr;
        this._saveConfig();
        this._renderAll();
        // Re-open config
        const p = document.getElementById('sched-cfg-panel');
        if (p) { p.style.display = 'block'; this._renderConfig(p); }
      });
    });

    panel.querySelectorAll('.cfg-time-input').forEach(inp => {
      inp.addEventListener('change', () => {
        const key = inp.dataset.key;
        const val = parseFloat(inp.value) || 0;
        if (key === 'draw') {
          this._cfg.times.drawTiers[parseInt(inp.dataset.idx)].days = val;
        } else {
          this._cfg.times[key] = val;
        }
        this._saveConfig();
        this._renderAll();
        const p = document.getElementById('sched-cfg-panel');
        if (p) { p.style.display = 'block'; this._renderConfig(p); }
      });
    });
  },

  // ── View 1: Gantt ──────────────────────────────────────────

  _renderGantt(container, pairResults) {
    const PX = 50; // pixels per business day
    const active = pairResults.filter(p => p.items.length > 0);

    if (!active.length) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">No hay ítems activos en ClickUp.</p>';
      return;
    }

    const maxDays  = Math.max(1, ...active.flatMap(p => p.timeline.map(t => t.fabricaDays)));
    const LABEL_W  = 190;
    const totalW   = LABEL_W + Math.ceil(maxDays + 2) * PX;

    const STYLE = {
      1: 'background:#dbeafe;border:1px solid #93c5fd;color:#1e40af',
      2: 'background:#ede9fe;border:1px solid #c4b5fd;color:#5b21b6',
      3: 'background:#ede9fe;border:1px solid #c4b5fd;color:#5b21b6',
      4: 'background:#f3f4f6;border:1px dashed #9ca3af;color:#6b7280',
      5: 'background:#fef3c7;border:1px solid #fcd34d;color:#92400e',
      6: 'background:#ede9fe;border:1px solid #c4b5fd;color:#5b21b6',
      7: 'background:#d1fae5;border:1px solid #6ee7b7;color:#065f46',
    };

    // Build axis ticks
    const ticks = [];
    for (let d = 0; d <= Math.ceil(maxDays) + 1; d += 2) {
      ticks.push(`<div style="position:absolute;left:${LABEL_W + d * PX}px;bottom:0;font-size:10px;color:var(--faint);transform:translateX(-50%);white-space:nowrap">${d === 0 ? 'Hoy' : '+' + d + 'd'}</div>`);
    }

    const pairsHTML = active.map(({ pair, pairKey, timeline }) => {
      const title = pair.jr ? `${pair.sr} + ${pair.jr}` : `${pair.sr} (sin Jr)`;

      const rowsHTML = timeline.map((item, idx) => {
        const bars = item.phases.map(ph => {
          const x = LABEL_W + ph.start * PX;
          const w = Math.max(3, (ph.end - ph.start) * PX);
          return `<div title="${esc(ph.label)}" style="position:absolute;left:${x}px;width:${w}px;top:7px;height:22px;${STYLE[ph.id]};border-radius:3px;font-size:9px;overflow:hidden;white-space:nowrap;padding:0 3px;line-height:22px">${esc(ph.label)}</div>`;
        }).join('');
        const flagX = LABEL_W + item.fabricaDays * PX;
        const nStr  = item.nivel !== null ? `N${item.nivel}` : '—';
        const nameShort = item.name.length > 22 ? item.name.slice(0, 21) + '…' : item.name;

        return `<div class="gantt-row" draggable="true" data-id="${esc(item.id)}" data-pk="${esc(pairKey)}" data-idx="${idx}" style="min-height:36px">
          <div class="gantt-item-label" style="width:${LABEL_W}px;min-width:${LABEL_W}px;padding:4px 10px">
            <div class="gantt-item-name" title="${esc(item.name)}">${esc(nameShort)}</div>
            <div class="gantt-item-meta">${esc(nStr)} · ${esc(item.currentPhase)}</div>
          </div>
          <div style="position:relative;flex:1;height:36px">
            ${bars}
            <div title="Fábrica: ${this._bizDateStr(item.fabricaDays, true)}" style="position:absolute;left:${flagX}px;top:6px;font-size:14px;z-index:3">🏁</div>
          </div>
        </div>`;
      }).join('');

      return `<div class="sched-pair-block">
        <div class="sched-pair-title">
          <span class="sched-pair-dot" style="background:${DESIGNER_COLORS[pair.sr] || '#888'}"></span>
          ${esc(title)}
          <span class="sched-pair-count">${timeline.length} ítem${timeline.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="overflow-x:auto;padding-bottom:4px">
          <div style="position:relative;height:24px;min-width:${totalW}px;background:var(--bg);border-bottom:1px solid var(--divider)">
            ${ticks.join('')}
            <div style="position:absolute;left:${LABEL_W}px;top:0;bottom:0;width:2px;background:#ef4444"></div>
          </div>
          <div style="position:relative;min-width:${totalW}px">
            <div style="position:absolute;left:${LABEL_W}px;top:0;bottom:0;width:2px;background:#ef4444;opacity:0.25;z-index:1"></div>
            ${rowsHTML}
          </div>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="sched-legend">
        <span class="sched-legend-item" style="background:#dbeafe;border:1px solid #93c5fd;color:#1e40af">Jr dibujando</span>
        <span class="sched-legend-item" style="background:#ede9fe;border:1px solid #c4b5fd;color:#5b21b6">Sr revisando/enviando</span>
        <span class="sched-legend-item" style="background:#f3f4f6;border:1px dashed #9ca3af;color:#6b7280">En aprobación</span>
        <span class="sched-legend-item" style="background:#fef3c7;border:1px solid #fcd34d;color:#92400e">Correcciones</span>
        <span class="sched-legend-item" style="background:#d1fae5;border:1px solid #6ee7b7;color:#065f46">Listo/fábrica</span>
        <span style="font-size:11px;color:var(--faint);padding:3px 0">🏁 = fecha estimada de envío a fábrica</span>
      </div>
      ${pairsHTML}`;

    this._bindDrag(container, pairResults);
  },

  // ── View 2: Lista por par ──────────────────────────────────

  _renderLista(container, pairResults) {
    const BADGE = {
      'Jr dibujando':      '#dbeafe|#1e40af',
      'Sr dibujando':      '#dbeafe|#1e40af',
      'Sr revisando':      '#ede9fe|#5b21b6',
      'En aprobación':     '#f3f4f6|#374151',
      'Jr correcciones':   '#fef3c7|#92400e',
      'Sr correcciones':   '#fef3c7|#92400e',
      'Listo para fábrica':'#d1fae5|#065f46',
    };

    const active = pairResults.filter(p => p.items.length > 0);
    if (!active.length) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">No hay ítems activos.</p>';
      return;
    }

    const today = new Date();
    const html  = active.map(({ pair, pairKey, timeline }) => {
      const title = pair.jr ? `${pair.sr} + ${pair.jr}` : `${pair.sr} (sin Jr)`;

      const rows = timeline.map((item, idx) => {
        const [bg, fg] = (BADGE[item.currentPhase] || '#f3f4f6|#374151').split('|');
        const fabDate  = this._addBizDays(today, item.fabricaDays);
        const fabStr   = fabDate.toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' });
        const days     = Math.ceil(item.fabricaDays);
        const daysHTML = days < 0
          ? `<span style="color:var(--below-text)">Atrasado ${Math.abs(days)}d</span>`
          : `${days} día${days !== 1 ? 's' : ''}`;
        const nStr  = item.nivel !== null ? `Nivel ${item.nivel}` : 'Sin nivel';
        const cStr  = item.corrections > 0 ? ` · ${item.corrections} corr.` : '';

        return `<div class="sched-list-row" draggable="true" data-id="${esc(item.id)}" data-pk="${esc(pairKey)}" data-idx="${idx}">
          <div class="sched-list-num">${idx + 1}</div>
          <div>
            <div class="sched-list-name">${esc(item.name)}</div>
            <div class="sched-list-meta">${esc(item.project || '—')} · ${nStr}${esc(cStr)}</div>
          </div>
          <div><span class="sched-phase-badge" style="background:${bg};color:${fg}">${esc(item.currentPhase)}</span></div>
          <div>
            <div class="sched-fab-date">🏁 ${fabStr}</div>
            <div class="sched-fab-days">${daysHTML}</div>
          </div>
        </div>`;
      }).join('');

      return `<div class="sched-pair-block">
        <div class="sched-pair-title">
          <span class="sched-pair-dot" style="background:${DESIGNER_COLORS[pair.sr] || '#888'}"></span>
          ${esc(title)}
          <span class="sched-pair-count">${timeline.length} ítem${timeline.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="sched-list-header">
          <div>#</div><div>Ítem</div><div>Estado actual</div><div>Fecha fábrica</div>
        </div>
        ${rows}
      </div>`;
    }).join('');

    container.innerHTML = html;
    this._bindDrag(container, pairResults);
  },

  // ── View 3: Disponibilidad ─────────────────────────────────

  _renderDisp(container, pairResults) {
    const today = new Date();
    const active = pairResults.filter(p => p.timeline.length > 0);

    if (!active.length) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">No hay ítems activos.</p>';
      return;
    }

    const rows = active.flatMap(({ pair, timeline }) => {
      const last  = timeline[timeline.length - 1];
      const srFin = this._addBizDays(today, last._srE);
      const jrFin = pair.jr ? this._addBizDays(today, last._jrE) : null;
      const fmt   = d => d.toLocaleDateString('es', { day: '2-digit', month: 'long' });
      const fmtNext = d => { const n = new Date(d); n.setDate(n.getDate() + (n.getDay() === 5 ? 3 : n.getDay() === 6 ? 2 : 1)); return fmt(n); };

      const out = [`<tr>
        <td class="avail-name"><span class="sched-pair-dot" style="background:${DESIGNER_COLORS[pair.sr] || '#888'}"></span>${esc(pair.sr)} <span style="color:var(--faint);font-size:11px">(Sr)</span></td>
        <td class="avail-date">${fmt(srFin)}</td>
        <td class="avail-next"${last._srE < 0 ? ' style="color:var(--below-text)"' : ''}>${fmtNext(srFin)}${last._srE < 0 ? ' ⚠' : ''}</td>
      </tr>`];

      if (pair.jr && jrFin) {
        out.push(`<tr>
          <td class="avail-name" style="padding-left:28px"><span class="sched-pair-dot" style="background:${DESIGNER_COLORS[pair.jr] || '#888'}"></span>${esc(pair.jr)} <span style="color:var(--faint);font-size:11px">(Jr)</span></td>
          <td class="avail-date">${fmt(jrFin)}</td>
          <td class="avail-next">${fmtNext(jrFin)}</td>
        </tr>`);
      }
      return out;
    });

    container.innerHTML = `<div class="sched-pair-block">
      <div class="sched-pair-title">Disponibilidad del equipo</div>
      <table class="avail-table">
        <thead><tr>
          <th class="avail-name">Diseñador</th>
          <th class="avail-date">Último ítem termina</th>
          <th class="avail-next">Disponible a partir de</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
  },

  // ── Drag-and-drop ──────────────────────────────────────────

  _bindDrag(container, pairResults) {
    let src = null;
    container.querySelectorAll('[draggable="true"]').forEach(row => {
      row.addEventListener('dragstart', e => {
        src = { id: row.dataset.id, pk: row.dataset.pk, idx: +row.dataset.idx };
        e.dataTransfer.effectAllowed = 'move';
        row.style.opacity = '0.45';
      });
      row.addEventListener('dragend',  () => { row.style.opacity = ''; src = null; });
      row.addEventListener('dragover',  e => { e.preventDefault(); row.style.outline = '2px solid var(--aprob-text)'; });
      row.addEventListener('dragleave', () => { row.style.outline = ''; });
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.style.outline = '';
        if (!src || src.pk !== row.dataset.pk) return;
        const targetIdx = +row.dataset.idx;
        if (src.idx === targetIdx) return;
        const pr  = pairResults.find(p => p.pairKey === src.pk);
        if (!pr) return;
        const ids = pr.items.map(i => i.id);
        const [moved] = ids.splice(src.idx, 1);
        ids.splice(targetIdx, 0, moved);
        this._cfg.priority[src.pk] = ids;
        this._saveConfig();
        this._renderAll();
      });
    });
  },
};
