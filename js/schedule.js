// ─────────────────────────────────────────────────────────────
// js/schedule.js — Cronograma tab
//
// Depends on: config.js (PC_ROLES, DESIGNER_COLORS, CU_MAP,
//             CU_EXCLUDE, mapDesignersCU, normStr, esc, fmtNum)
//             parser.js (_cuFieldVal, parseCUDate)
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
  // Returns items with all 5 ClickUp date fields as Date|null.

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

    // Date columns
    const iFechaInicio = hdr.findIndex(h =>
      h.includes('fecha de inicio') || h.includes('start date') || h === 'start');
    const iFinDibujo   = hdr.findIndex(h => h.startsWith('fin de dibujo'));
    const iEnvioApv    = hdr.findIndex(h => h.includes('envio a aprobacion'));
    const iAprobado    = hdr.findIndex(h => h === 'aprobado' || h.startsWith('aprobado'));
    const iEnvioFab    = hdr.findIndex(h => h.includes('envio a fabrica'));

    const getDate = (row, i) => i !== -1 ? parseCUDate(row[i] || '') : null;

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
        items.push({
          id:              `${name}|${project}`,
          name, project, nivel,
          status:          rawStatus,
          corrections:     corr,
          designer,
          fechaInicio:     getDate(row, iFechaInicio),
          finDibujo:       getDate(row, iFinDibujo),
          envioAprobacion: getDate(row, iEnvioApv),
          aprobado:        getDate(row, iAprobado),
          envioFabrica:    getDate(row, iEnvioFab),
        });
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

    // Convert a Unix-ms timestamp (number or string) to Date or null.
    const toDate = ts => {
      if (!ts) return null;
      const n = Number(ts);
      return !isNaN(n) && n > 0 ? new Date(n) : null;
    };

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

      // Date fields: start_date is a standard ClickUp field; others are custom.
      const fechaInicio     = toDate(t.start_date);
      const finDibujo       = toDate(_cuFieldVal(t, fids.finDibujo));
      const envioAprobacion = toDate(_cuFieldVal(t, fids.envioAprobacion));
      const aprobado        = toDate(_cuFieldVal(t, fids.aprobado));
      const envioFabrica    = toDate(_cuFieldVal(t, fids.envio));

      for (const designer of designers) {
        items.push({
          id:  `${t.name || ''}|${parent}`,
          name: t.name || '',
          project: parent,
          nivel,
          status:          rawStatus,
          corrections:     parseInt(corrRaw || '0') || 0,
          designer,
          fechaInicio,
          finDibujo,
          envioAprobacion,
          aprobado,
          envioFabrica,
        });
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

  // Each item is calculated independently using its own ClickUp dates.
  // No sequential chaining — each item's phases are anchored to real dates.
  _calcTimeline(pair, orderedItems) {
    const times  = this._cfg.times;
    const srOnly = !pair.jr;
    return orderedItems.map(item => this._calcItemDates(item, times, srOnly));
  },

  // ── Phase date helper ──────────────────────────────────────
  //
  // Returns { date: Date, source: 'clickup'|'completed'|'overdue'|'estimated' }.
  // isCurrentPhase: true when the item's status shows it's still in this phase.
  _phaseEnd(cuDate, startDate, standardDays, isCurrentPhase) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (cuDate) {
      if (cuDate > today) return { date: cuDate, source: 'clickup' };
      // Past ClickUp date — overdue if status hasn't advanced past this phase.
      return { date: cuDate, source: isCurrentPhase ? 'overdue' : 'completed' };
    }
    return { date: this._addBizDays(startDate, standardDays), source: 'estimated' };
  },

  // Build the 5-phase timeline for one item using ClickUp dates where available.
  // Completed phases are shown only when a real ClickUp date exists for them.
  _calcItemDates(item, times, srOnly) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const s = normStr(item.status || '');

    const skip1 = s === 'revision de constructivo' || s === 'enviado a aprobacion' || s === 'aprobado';
    const skip2 = s === 'enviado a aprobacion' || s === 'aprobado';
    const skip3 = s === 'aprobado';

    const phases = [];
    let lastEnd = today;

    // Phase 1: dibujando
    const p1Start = item.fechaInicio || today;
    if (skip1) {
      if (item.finDibujo) {
        phases.push({ id: 1, label: srOnly ? 'Sr dibujando' : 'Jr dibujando',
          startDate: p1Start, endDate: item.finDibujo, source: 'completed' });
        lastEnd = item.finDibujo;
      }
      // No date → skip silently; lastEnd stays at today.
    } else {
      const drawDays  = this._getDrawDays(item.nivel, times);
      const isCurrent = s === 'en dibujo' || s === 'proximos a entrar';
      const { date: end, source } = this._phaseEnd(item.finDibujo, p1Start, drawDays, isCurrent);
      phases.push({ id: 1, label: srOnly ? 'Sr dibujando' : 'Jr dibujando',
        startDate: p1Start, endDate: end, source });
      lastEnd = end;
    }

    // Phase 2: Sr revisa + envía aprobación
    if (skip2) {
      if (item.envioAprobacion) {
        phases.push({ id: 2, label: 'Sr revisa + envía',
          startDate: lastEnd, endDate: item.envioAprobacion, source: 'completed' });
        lastEnd = item.envioAprobacion;
      }
    } else {
      const isCurrent = s === 'revision de constructivo';
      const { date: end, source } = this._phaseEnd(item.envioAprobacion, lastEnd, 1, isCurrent);
      phases.push({ id: 2, label: 'Sr revisa + envía',
        startDate: lastEnd, endDate: end, source });
      lastEnd = end;
    }

    // Phase 3: En aprobación (cliente)
    if (skip3) {
      if (item.aprobado) {
        phases.push({ id: 3, label: 'En aprobación',
          startDate: lastEnd, endDate: item.aprobado, source: 'completed' });
        lastEnd = item.aprobado;
      }
    } else {
      const isCurrent = s === 'enviado a aprobacion';
      const { date: end, source } = this._phaseEnd(item.aprobado, lastEnd, times.clientWait, isCurrent);
      phases.push({ id: 3, label: 'En aprobación',
        startDate: lastEnd, endDate: end, source });
      lastEnd = end;
    }

    // Phase 4: correcciones (always estimated — no ClickUp field for this phase)
    const corrDays = Math.max(0.5, (item.corrections || 0) * times.jrCorr);
    const p4End = this._addBizDays(lastEnd, corrDays);
    phases.push({ id: 4, label: srOnly ? 'Sr correcciones' : 'Jr correcciones',
      startDate: lastEnd, endDate: p4End, source: 'estimated' });
    lastEnd = p4End;

    // Phase 5: Sr elabora OP + envía fábrica
    const { date: p5End, source: p5Src } =
      this._phaseEnd(item.envioFabrica, lastEnd, times.srElabOP, false);
    phases.push({ id: 5, label: 'Sr elabora OP + fábrica',
      startDate: lastEnd, endDate: p5End, source: p5Src });
    lastEnd = p5End;

    return { ...item, phases, fabricaDate: lastEnd, currentPhase: this._currentPhase(s, srOnly) };
  },

  _currentPhase(status, srOnly) {
    const map = {
      'proximos a entrar':        srOnly ? 'Sr dibujando'    : 'Jr dibujando',
      'en dibujo':                srOnly ? 'Sr dibujando'    : 'Jr dibujando',
      'revision de constructivo': 'Sr revisa + envía',
      'enviado a aprobacion':     'En aprobación',
      'aprobado':                 srOnly ? 'Sr correcciones' : 'Jr correcciones',
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
            <div class="sched-cfg-title">Tiempos estándar (cuando no hay fecha en ClickUp)</div>
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

  // ── View 1: Gantt (grouped by project, real ClickUp dates) ─

  _renderGantt(container, pairResults) {
    const LABEL_W = 200;
    const PX      = 22;     // pixels per calendar day
    const MS      = 86400000;
    const today   = new Date(); today.setHours(0, 0, 0, 0);

    const active = pairResults.filter(p => p.items.length > 0);
    if (!active.length) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">No hay ítems activos en ClickUp.</p>';
      return;
    }

    // Day-offset range (relative to today = 0)
    let minDay = 0, maxDay = 7;
    for (const { timeline } of active) {
      for (const item of timeline) {
        for (const ph of item.phases) {
          const s = (ph.startDate - today) / MS;
          const e = (ph.endDate   - today) / MS;
          if (s < minDay) minDay = s;
          if (e > maxDay) maxDay = e;
        }
      }
    }
    minDay = Math.floor(minDay) - 2;
    maxDay = Math.ceil(maxDay)  + 3;

    const dayToX  = d  => LABEL_W + (d - minDay) * PX;
    const dateToX = dt => dayToX((dt - today) / MS);
    const totalW  = LABEL_W + (maxDay - minDay) * PX;

    // Phase base palettes
    const PC = {
      1: { light: '#dbeafe', dark: '#1d4ed8', text: '#1e3a8a', base: '#3b82f6' },
      2: { light: '#ede9fe', dark: '#5b21b6', text: '#4c1d95', base: '#7c3aed' },
      3: { light: '#f3f4f6', dark: '#6b7280', text: '#374151', base: '#9ca3af' },
      4: { light: '#fef3c7', dark: '#b45309', text: '#78350f', base: '#d97706' },
      5: { light: '#d1fae5', dark: '#065f46', text: '#022c22', base: '#10b981' },
    };

    const barStyle = ph => {
      const c   = PC[ph.id] || PC[1];
      const src = ph.source;
      if (src === 'completed') return { bg: '#e5e7eb', bd: '1px solid #9ca3af', tx: '#6b7280', op: '0.65' };
      if (src === 'overdue')   return { bg: '#fee2e2', bd: '2px solid #ef4444', tx: '#991b1b', op: '1'    };
      if (src === 'clickup')   return { bg: c.dark,   bd: `2px solid ${c.base}`, tx: '#fff',  op: '1'    };
      /* estimated */          return { bg: c.light,  bd: `1px dashed ${c.base}`, tx: c.text, op: '0.9'  };
    };

    const srcIcon = src => src === 'clickup' ? '📅' : src === 'overdue' ? '⚠' : '';

    const fmtD = d => d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const tooltip = ph => {
      const d = fmtD(ph.endDate);
      const map = {
        clickup:   `Fecha en ClickUp: ${d}`,
        estimated: `Estimado por tiempo estándar: ${d}`,
        completed: `Completado: ${d}`,
        overdue:   `⚠ Atrasado — fecha ClickUp: ${d}`,
      };
      return `${ph.label} — ${map[ph.source] || d}`;
    };

    // Axis grid lines (every 7 calendar days)
    const gridLines = [];
    const firstGrid = Math.ceil(minDay / 7) * 7;
    for (let d = firstGrid; d <= maxDay; d += 7) {
      const x  = dayToX(d);
      const dt = new Date(today.getTime() + d * MS);
      const lbl = d === 0 ? 'Hoy'
        : dt.toLocaleDateString('es', { day: '2-digit', month: 'short' });
      gridLines.push(
        `<div style="position:absolute;left:${x}px;top:0;bottom:0;width:1px;background:var(--divider);pointer-events:none"></div>`,
        `<div style="position:absolute;left:${x}px;bottom:3px;font-size:10px;color:var(--faint);transform:translateX(-50%);white-space:nowrap;pointer-events:none">${lbl}</div>`
      );
    }

    // Today line
    const todayX    = dayToX(0);
    const todayLine = `<div class="gantt-today-vline" style="position:absolute;left:${todayX}px;top:0;bottom:0;width:2px;background:#ef4444;z-index:10;pointer-events:none">
      <div style="position:absolute;top:2px;left:4px;font-size:9px;color:#ef4444;font-weight:700;white-space:nowrap">Hoy</div>
    </div>`;

    const pairsHTML = active.map(({ pair, pairKey, timeline }) => {
      const title = pair.jr ? `${pair.sr} + ${pair.jr}` : `${pair.sr} (sin Jr)`;
      const color = DESIGNER_COLORS[pair.sr] || '#888';

      // Group items by project, preserving priority order
      const projMap = new Map();
      for (const item of timeline) {
        const proj = item.project || '(Sin proyecto)';
        if (!projMap.has(proj)) projMap.set(proj, []);
        projMap.get(proj).push(item);
      }

      let innerHtml = '';
      let projIdx   = 0;

      for (const [proj, projItems] of projMap) {
        const pid = `${pairKey}-p${projIdx++}`;

        // Compute project span from all phase dates
        const allTs = projItems.flatMap(i => i.phases.flatMap(p => [p.startDate.getTime(), p.endDate.getTime()]));
        const minTs = Math.min(...allTs);
        const maxTs = Math.max(...projItems.map(i => i.fabricaDate.getTime()));
        const fabStr  = new Date(maxTs).toLocaleDateString('es', { day: '2-digit', month: 'short' });
        const projName = proj.length > 28 ? proj.slice(0, 27) + '…' : proj;

        // Mini phase-distribution bar (4px stacked)
        const counts = { draw: 0, review: 0, wait: 0, corr: 0, done: 0 };
        for (const item of projItems) {
          const ph = item.currentPhase;
          if      (ph.includes('dibujando'))                            counts.draw++;
          else if (ph.includes('revisa') || ph.includes('envia'))       counts.review++;
          else if (ph.includes('aprobaci'))                             counts.wait++;
          else if (ph.includes('correcci'))                             counts.corr++;
          else                                                          counts.done++;
        }
        const miniSegs = [
          { n: counts.draw,   bg: '#93c5fd' },
          { n: counts.review, bg: '#c4b5fd' },
          { n: counts.wait,   bg: '#d1d5db' },
          { n: counts.corr,   bg: '#fcd34d' },
          { n: counts.done,   bg: '#6ee7b7' },
        ].filter(s => s.n > 0)
         .map(s => `<div style="flex:${s.n};background:${s.bg}"></div>`)
         .join('');

        const spanX = dayToX((minTs - today.getTime()) / MS);
        const flagX = dayToX((maxTs - today.getTime()) / MS);
        const spanW = Math.max(8, flagX - spanX);

        const projTimelineHtml =
          `<div style="position:absolute;left:${spanX}px;width:${spanW}px;top:50%;transform:translateY(-50%);height:5px;background:#cbd5e1;border-radius:3px"></div>` +
          `<div title="Est. fábrica: ${fabStr}" style="position:absolute;left:${flagX}px;top:50%;transform:translate(-2px,-50%);font-size:14px;z-index:2;cursor:default">🏁</div>` +
          `<div style="position:absolute;left:${flagX + 16}px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted);white-space:nowrap">${fabStr}</div>`;

        innerHtml += `
          <div class="gantt-proj-row" data-pid="${pid}" data-expanded="false"
               style="display:flex;align-items:center;min-width:${totalW}px;border-bottom:1px solid var(--divider);background:var(--bg);cursor:pointer;user-select:none">
            <div style="width:${LABEL_W}px;min-width:${LABEL_W}px;padding:7px 10px;display:flex;align-items:center;gap:7px;flex-shrink:0">
              <span class="gprow-arrow" style="font-size:10px;color:var(--faint);width:10px;flex-shrink:0;transition:transform .15s">▶</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(proj)}">${esc(projName)}</div>
                <div style="display:flex;height:4px;border-radius:2px;overflow:hidden;width:80px;gap:1px;margin-top:3px">${miniSegs}</div>
              </div>
              <span style="font-size:11px;color:var(--faint);white-space:nowrap;flex-shrink:0">${projItems.length} ítem${projItems.length !== 1 ? 's' : ''}</span>
            </div>
            <div style="position:relative;flex:1;height:36px">${projTimelineHtml}</div>
          </div>`;

        for (let ii = 0; ii < projItems.length; ii++) {
          const item      = projItems[ii];
          const globalIdx = timeline.indexOf(item);
          const nStr      = item.nivel !== null ? `N${item.nivel}` : '—';

          const bars = item.phases.map(ph => {
            const sx  = dateToX(ph.startDate);
            const ex  = dateToX(ph.endDate);
            const w   = Math.max(4, ex - sx - 1);
            const st  = barStyle(ph);
            const icon = srcIcon(ph.source);
            const showLabel = w > 60;
            const showIcon  = icon && w > 20;
            const labelTxt  = showLabel
              ? (showIcon ? `${icon} ${ph.label}` : ph.label)
              : (showIcon ? icon : '');
            return `<div title="${esc(tooltip(ph))}" style="position:absolute;left:${sx}px;width:${w}px;top:8px;height:24px;background:${st.bg};border:${st.bd};color:${st.tx};opacity:${st.op};border-radius:4px;font-size:9px;font-weight:500;overflow:hidden;white-space:nowrap;padding:0 4px;line-height:24px">${esc(labelTxt)}</div>`;
          }).join('');

          const fabricaX  = dateToX(item.fabricaDate);
          const fabricaLbl = item.fabricaDate.toLocaleDateString('es', { day: '2-digit', month: 'short' });

          innerHtml += `
            <div class="gantt-row" draggable="true"
                 data-id="${esc(item.id)}" data-pk="${esc(pairKey)}" data-idx="${globalIdx}" data-pid="${pid}"
                 style="display:none;min-height:40px;background:#fff;padding-left:0">
              <div class="gantt-item-label" style="width:${LABEL_W}px;min-width:${LABEL_W}px;padding:5px 10px 5px 28px">
                <div class="gantt-item-name" style="white-space:normal;word-break:break-word;font-size:12px;font-weight:500;line-height:1.3">${esc(item.name)}</div>
                <div class="gantt-item-meta">${esc(nStr)} · ${esc(item.currentPhase)}</div>
              </div>
              <div style="position:relative;flex:1;min-height:40px">
                ${bars}
                <div title="Est. fábrica: ${fabricaLbl}"
                     style="position:absolute;left:${fabricaX}px;top:10px;font-size:13px;z-index:3;cursor:default">🏁</div>
              </div>
            </div>`;
        }
      }

      return `<div class="sched-pair-block">
        <div class="sched-pair-title">
          <span class="sched-pair-dot" style="background:${color}"></span>
          ${esc(title)}
          <span class="sched-pair-count">${timeline.length} ítem${timeline.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="overflow-x:auto">
          <div style="position:relative;min-width:${totalW}px">
            ${todayLine}
            <div style="position:relative;height:28px;border-bottom:2px solid var(--border);background:var(--bg)">
              ${gridLines.join('')}
            </div>
            ${innerHtml}
          </div>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = `
      <div class="sched-legend">
        <span class="sched-legend-item" style="background:#1d4ed8;border:2px solid #3b82f6;color:#fff">📅 Fecha ClickUp</span>
        <span class="sched-legend-item" style="background:#dbeafe;border:1px dashed #3b82f6;color:#1e40af">~ Estimado</span>
        <span class="sched-legend-item" style="background:#e5e7eb;border:1px solid #9ca3af;color:#6b7280">✓ Completado</span>
        <span class="sched-legend-item" style="background:#fee2e2;border:2px solid #ef4444;color:#991b1b">⚠ Atrasado</span>
        <span style="font-size:11px;color:var(--faint);padding:3px 0">🏁 = fábrica estimada &nbsp;· Arrastra para reordenar</span>
      </div>
      ${pairsHTML}`;

    // Bind project row collapse/expand (pure DOM toggle, no re-render)
    container.querySelectorAll('.gantt-proj-row').forEach(projRow => {
      projRow.addEventListener('click', () => {
        const pid      = projRow.dataset.pid;
        const expanded = projRow.dataset.expanded === 'true';
        projRow.dataset.expanded = expanded ? 'false' : 'true';
        const arrow = projRow.querySelector('.gprow-arrow');
        if (arrow) arrow.textContent = expanded ? '▶' : '▼';
        projRow.style.background = expanded ? 'var(--bg)' : 'var(--divider)';
        container.querySelectorAll(`.gantt-row[data-pid="${pid}"]`).forEach(r => {
          r.style.display = expanded ? 'none' : 'flex';
        });
      });
    });

    this._bindDrag(container, pairResults);
  },

  // ── View 2: Lista por par ──────────────────────────────────

  _renderLista(container, pairResults) {
    const BADGE = {
      'Jr dibujando':          '#dbeafe|#1e40af',
      'Sr dibujando':          '#dbeafe|#1e40af',
      'Sr revisa + envía':     '#ede9fe|#5b21b6',
      'En aprobación':         '#f3f4f6|#374151',
      'Jr correcciones':       '#fef3c7|#92400e',
      'Sr correcciones':       '#fef3c7|#92400e',
      'Sr elabora OP + fábrica': '#d1fae5|#065f46',
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
        const fabDate  = item.fabricaDate;
        const fabStr   = fabDate.toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' });
        const days     = Math.round((fabDate - today) / 86400000);
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
    const today  = new Date();
    const active = pairResults.filter(p => p.timeline.length > 0);

    if (!active.length) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">No hay ítems activos.</p>';
      return;
    }

    const fmt     = d => d.toLocaleDateString('es', { day: '2-digit', month: 'long' });
    const fmtNext = d => {
      const n = new Date(d);
      n.setDate(n.getDate() + (n.getDay() === 5 ? 3 : n.getDay() === 6 ? 2 : 1));
      return fmt(n);
    };

    const rows = active.flatMap(({ pair, timeline }) => {
      // Availability = latest fabricaDate among each designer's items.
      const srItems = timeline.filter(i => i.designer === pair.sr);
      const jrItems = pair.jr ? timeline.filter(i => i.designer === pair.jr) : [];

      const srFinMs = srItems.length
        ? Math.max(...srItems.map(i => i.fabricaDate.getTime()))
        : today.getTime();
      const srFin = new Date(srFinMs);
      const srLate = srFin < today;

      const out = [`<tr>
        <td class="avail-name"><span class="sched-pair-dot" style="background:${DESIGNER_COLORS[pair.sr] || '#888'}"></span>${esc(pair.sr)} <span style="color:var(--faint);font-size:11px">(Sr)</span></td>
        <td class="avail-date">${fmt(srFin)}</td>
        <td class="avail-next"${srLate ? ' style="color:var(--below-text)"' : ''}>${fmtNext(srFin)}${srLate ? ' ⚠' : ''}</td>
      </tr>`];

      if (pair.jr && jrItems.length) {
        const jrFinMs = Math.max(...jrItems.map(i => i.fabricaDate.getTime()));
        const jrFin   = new Date(jrFinMs);
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
