// ─────────────────────────────────────────────────────────────
// js/schedule.js — Cronograma tab
//
// Depends on: config.js (PC_ROLES, DESIGNER_COLORS, CU_MAP,
//             CU_EXCLUDE, mapDesignersCU, normStr, esc, fmtNum)
//             parser.js (_cuFieldVal, parseCUDate)
// ─────────────────────────────────────────────────────────────

const Schedule = {
  _cuRows:      null,
  _rawTasks:    null,
  _fieldIds:    null,
  _items:       [],
  _view:        'gantt',
  _cfg:         null,
  _mainView:    'cronograma',   // 'cronograma' | 'asignacion'
  _asignDraft:  null,           // Map: taskId → draft change (lazy-init)
  _userIdMap:   {},             // display name → ClickUp numeric user ID
  _apiTasks:    [],             // flat task list for Asignación view (API mode)
  _unloadHandler: null,         // stored beforeunload ref for cleanup

  SCHED_KEY:   'wc_sched_cfg',
  USER_ID_KEY: 'wc_user_ids',
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
    this._loadUserIds();
    if (this._cuRows) this._items = this._parseCSV(this._cuRows);
    this._purgeOldPC();
    this._renderAll();
  },

  renderFromAPI(rawTasks, fieldIds) {
    if (rawTasks !== undefined) this._rawTasks = rawTasks;
    if (fieldIds  !== undefined) this._fieldIds  = fieldIds;
    this._loadConfig();
    this._loadUserIds();
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
        const p  = JSON.parse(raw);
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
  // Items with status 'proximos a entrar' or 'asignado' are flagged pending:true.

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

    // 'asignado' and 'proximos a entrar' are included but flagged as pending (no Gantt bars)
    const ACTIVE = new Set([
      'en dibujo', 'enviado a aprobacion',
      'revision de constructivo', 'aprobado',
      'proximos a entrar', 'asignado',
    ]);

    const items = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(c => !c.trim())) continue;
      const rawStatus = normStr(row[iStatus] || '');
      if (!ACTIVE.has(rawStatus)) continue;

      const designers = mapDesignersCU(row[iAsgn] || '');
      if (!designers.length) continue;

      const nivelRaw  = iNivel !== -1 ? (row[iNivel] || '').trim() : '';
      const nivel     = nivelRaw ? (parseFloat(nivelRaw) || null) : null;
      const name      = iName   !== -1 ? (row[iName]   || '').trim() : '';
      const project   = iParent !== -1 ? (row[iParent] || '').trim() : '';
      const corr      = iCorr   !== -1 ? (parseInt(row[iCorr] || '0') || 0) : 0;
      const isPending = rawStatus === 'proximos a entrar' || rawStatus === 'asignado';

      for (const designer of designers) {
        items.push({
          id:              `${name}|${project}`,
          name, project, nivel,
          status:          rawStatus,
          pending:         isPending,
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
    const ACTIVE = new Set([
      'en dibujo', 'enviado a aprobacion',
      'revision de constructivo', 'aprobado',
      'proximos a entrar', 'asignado',
    ]);
    const nameById = new Map((rawTasks || []).map(t => [t.id, t.name || '']));

    // Blacklist: exclude children from Asignación when the parent project
    // is in one of these statuses (not started, or already past design phase).
    // Items without a parent task are always included.
    const INACTIVE_PARENT = new Set([
      'asignado', 'prospecto',
      'cotizacion', 'cotización',
      'en pintura',
    ]);

    // Pre-build a map of every task's status and designers (all tasks, not just ACTIVE).
    // Used to resolve parent task ownership for items that have no assignee of their own.
    const parentInfoById = new Map();
    for (const t of (rawTasks || [])) {
      const ds = [];
      for (const a of (t.assignees || [])) {
        const rawN = (a.username || a.name || '').trim();
        if (!rawN) continue;
        const fi = normStr(rawN.split(' ')[0]);
        if (CU_EXCLUDE.has(fi)) continue;
        ds.push(CU_MAP[rawN] || rawN);
      }
      parentInfoById.set(t.id, { status: normStr(t.status?.status || ''), designers: ds });
    }

    // Convert a Unix-ms timestamp (number or string) to Date or null.
    const toDate = ts => {
      if (!ts) return null;
      const n = Number(ts);
      return !isNaN(n) && n > 0 ? new Date(n) : null;
    };

    // Reset _apiTasks each parse
    this._apiTasks = [];

    const items = [];
    for (const t of (rawTasks || [])) {
      const rawStatus = normStr(t.status?.status || '');
      if (!ACTIVE.has(rawStatus)) continue;

      // Map raw assignees → display names, and capture userId per name
      const designers = [];
      for (const a of (t.assignees || [])) {
        const rawName = (a.username || a.name || '').trim();
        if (!rawName) continue;
        const first = normStr(rawName.split(' ')[0]);
        if (CU_EXCLUDE.has(first)) continue;
        const displayName = CU_MAP[rawName] || rawName;
        designers.push(displayName);
        // Store userId for later ClickUp PUT calls (keep first seen, don't overwrite)
        if (a.id && !this._userIdMap[displayName]) {
          this._userIdMap[displayName] = a.id;
        }
      }

      const nivRaw    = _cuFieldVal(t, fids.nivel);
      const nivel     = nivRaw !== '' ? (parseFloat(nivRaw) || null) : null;
      const corrRaw   = _cuFieldVal(t, fids.corrections);
      const opVal     = _cuFieldVal(t, fids.op) || '';
      const parent    = t.parent ? (nameById.get(t.parent) || '') : (t.name || '');
      const isPending = rawStatus === 'proximos a entrar' || rawStatus === 'asignado';

      // Resolve parent task info for Asignación routing
      const parentInfo     = t.parent ? (parentInfoById.get(t.parent) || null) : null;
      const parentSrs      = (parentInfo?.designers || []).filter(d => this.SR_LIST.includes(d));
      const parentInactive = parentInfo ? INACTIVE_PARENT.has(parentInfo.status) : false;

      // If this subtask has no own assignees, inherit the parent task's designers so it
      // shows up under the correct Sr/Jr in both Cronograma and Estado actual.
      // (e.g. HARROUCHE subtasks that are "proximos a entrar" with no assignee assigned yet)
      const effectiveDesigners = designers.length > 0
        ? designers
        : (parentInfo?.designers || []);

      // Push to _apiTasks when:
      //   a) parent project is in an active design status, OR
      //   b) the task (or its parent) is assigned to someone.
      if (!parentInactive || effectiveDesigners.length > 0) {
        this._apiTasks.push({
          taskId:       t.id,
          name:         t.name || '',
          project:      parent,
          parentId:     t.parent || null,
          parentSrs,
          nivel,
          op:           opVal,
          status:       rawStatus,
          pending:      isPending,
          allDesigners:     effectiveDesigners,
          hasOwnDesigners:  designers.length > 0,
        });
      }

      // Only add to items (Cronograma) when at least one designer is known (own or inherited)
      if (!effectiveDesigners.length) continue;

      const fechaInicio     = toDate(t.start_date);
      const finDibujo       = toDate(_cuFieldVal(t, fids.finDibujo));
      const envioAprobacion = toDate(_cuFieldVal(t, fids.envioAprobacion));
      const aprobado        = toDate(_cuFieldVal(t, fids.aprobado));
      const envioFabrica    = toDate(_cuFieldVal(t, fids.envio));

      for (const designer of effectiveDesigners) {
        items.push({
          id:  `${t.name || ''}|${parent}`,
          name: t.name || '',
          project: parent,
          nivel,
          op:              opVal,
          status:          rawStatus,
          pending:         isPending,
          corrections:     parseInt(corrRaw || '0') || 0,
          designer,
          taskId:          t.id,
          allDesigners:    effectiveDesigners,
          fechaInicio,
          finDibujo,
          envioAprobacion,
          aprobado,
          envioFabrica,
        });
      }
    }

    // Persist updated userId map
    this._saveUserIds();
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
    const order  = this._cfg.priority[pairKey] || [];
    const rankOf = new Map(order.map((id, i) => [id, i]));
    return [...items].sort((a, b) => {
      const ai = rankOf.has(a.id) ? rankOf.get(a.id) : Infinity;
      const bi = rankOf.has(b.id) ? rankOf.get(b.id) : Infinity;
      return ai - bi;
    });
  },

  // Each item is calculated independently using its own ClickUp dates.
  _calcTimeline(pair, orderedItems) {
    const times  = this._cfg.times;
    const srOnly = !pair.jr;
    return orderedItems.map(item => this._calcItemDates(item, times, srOnly));
  },

  // Build the 5-phase timeline for one item.
  //
  // Pending items (proximos a entrar / asignado):
  //   → { phases: [], fabricaDate: null, currentPhase: 'Pendiente de inicio' }
  //
  // Completed phase (status has advanced past it):
  //   → Shown only if a real past ClickUp date exists; otherwise silently skipped.
  //   → startDate = previous phase end (or estimated backwards for phase 1).
  //
  // Current phase (status = this phase):
  //   → Always anchored to today: startDate = today.
  //   → endDate = future ClickUp date if available, else today + standard days.
  //   → Past ClickUp dates for the current phase are IGNORED (extended forward from today).
  //
  // Future phase (status is before this phase):
  //   → startDate = lastEnd (end of previous phase).
  //   → endDate = future ClickUp date if available, else estimate from lastEnd.
  _calcItemDates(item, times, srOnly) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const MS    = 86400000;
    const s     = normStr(item.status || '');

    // Pending items: no Gantt bars, no fabricaDate
    if (item.pending) {
      return { ...item, phases: [], fabricaDate: null, currentPhase: 'Pendiente de inicio' };
    }

    // Determine which phase (1–4) is currently active based on status.
    // Phase 5 (Sr elabora OP + fábrica) is always a future phase.
    const curr =
      s === 'en dibujo'                ? 1 :
      s === 'revision de constructivo' ? 2 :
      s === 'enviado a aprobacion'     ? 3 :
      s === 'aprobado'                 ? 4 : 1;

    const phases   = [];
    let   lastEnd  = today;

    const drawDays = this._getDrawDays(item.nivel, times);
    const label1   = srOnly ? 'Sr dibujando'    : 'Jr dibujando';
    const label4   = srOnly ? 'Sr correcciones' : 'Jr correcciones';
    const corrDays = Math.max(0.5, (item.corrections || 0) * times.jrCorr);

    // ── Phase helpers ──────────────────────────────────────────

    // Completed phase: render only when we have a real past ClickUp date.
    // approxDays is used to estimate startDate when lastEnd has not yet been set to a past date.
    const pushCompleted = (id, label, cuDate, approxDays) => {
      if (!cuDate || cuDate > today) return; // no real past date → skip silently
      const startDate = lastEnd <= cuDate
        ? lastEnd
        : new Date(cuDate.getTime() - Math.round(approxDays * 1.4) * MS);
      phases.push({ id, label, startDate, endDate: cuDate, source: 'completed' });
      lastEnd = cuDate;
    };

    // Current phase: anchored to today. Past ClickUp dates are ignored.
    const pushCurrent = (id, label, cuDate, standardDays) => {
      let end, src;
      if (cuDate && cuDate > today) {
        end = cuDate; src = 'clickup';
      } else {
        end = this._addBizDays(today, standardDays); src = 'estimated';
      }
      phases.push({ id, label, startDate: today, endDate: end, source: src });
      lastEnd = end;
    };

    // Future phase: starts at lastEnd. Past ClickUp dates are ignored.
    const pushFuture = (id, label, cuDate, standardDays) => {
      let end, src;
      if (cuDate && cuDate > today) {
        end = cuDate; src = 'clickup';
      } else {
        end = this._addBizDays(lastEnd, standardDays); src = 'estimated';
      }
      phases.push({ id, label, startDate: lastEnd, endDate: end, source: src });
      lastEnd = end;
    };

    // ── Build phases in order ──────────────────────────────────

    // Phase 1: dibujando
    if      (curr === 1) pushCurrent  (1, label1, item.finDibujo, drawDays);
    else                 pushCompleted(1, label1, item.finDibujo, drawDays);

    // Phase 2: Sr revisa + envía aprobación
    if      (curr === 2) pushCurrent  (2, 'Sr revisa + envía', item.envioAprobacion, 1);
    else if (curr > 2)   pushCompleted(2, 'Sr revisa + envía', item.envioAprobacion, 1);
    else                 pushFuture   (2, 'Sr revisa + envía', item.envioAprobacion, 1);

    // Phase 3: En aprobación (cliente)
    if      (curr === 3) pushCurrent  (3, 'En aprobación', item.aprobado, times.clientWait);
    else if (curr > 3)   pushCompleted(3, 'En aprobación', item.aprobado, times.clientWait);
    else                 pushFuture   (3, 'En aprobación', item.aprobado, times.clientWait);

    // Phase 4: correcciones — no ClickUp date field; anchored to today when current
    if (curr === 4) {
      const end = this._addBizDays(today, corrDays);
      phases.push({ id: 4, label: label4, startDate: today, endDate: end, source: 'estimated' });
      lastEnd = end;
    } else {
      pushFuture(4, label4, null, corrDays);
    }

    // Phase 5: Sr elabora OP + fábrica — always a future phase (no status for it)
    pushFuture(5, 'Sr elabora OP + fábrica', item.envioFabrica, times.srElabOP);

    return {
      ...item,
      phases,
      fabricaDate: lastEnd,
      currentPhase: this._currentPhase(s, srOnly),
    };
  },

  _currentPhase(status, srOnly) {
    const map = {
      'proximos a entrar':        'Pendiente de inicio',
      'asignado':                 'Pendiente de inicio',
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

    // Remove any pending beforeunload listener from Asignación view
    if (this._unloadHandler) {
      window.removeEventListener('beforeunload', this._unloadHandler);
      this._unloadHandler = null;
    }

    const hasSource = this._cuRows || this._rawTasks;
    if (!hasSource) {
      body.innerHTML = `<div class="wl-prompt">
        <div class="wl-prompt-icon">📅</div>
        <p>Carga datos de ClickUp en <strong>Inicio</strong> para ver el cronograma.</p>
      </div>`;
      return;
    }

    // Lazy-init draft map
    if (!this._asignDraft) this._asignDraft = new Map();

    // Top-level pills — only available in API mode (task IDs required for PUT calls)
    if (this._rawTasks) {
      body.innerHTML = `
        <div class="asign-main-tabs">
          <button class="asign-main-tab ${this._mainView === 'cronograma' ? 'active' : ''}" data-main="cronograma">📊 Cronograma</button>
          <button class="asign-main-tab ${this._mainView === 'asignacion' ? 'active' : ''}" data-main="asignacion">👥 Asignación</button>
        </div>
        <div id="sched-main-area"></div>`;

      body.querySelectorAll('.asign-main-tab').forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.dataset.main === this._mainView) return;
          if (this._asignDraft.size > 0 && btn.dataset.main !== 'asignacion') {
            if (!confirm('Tienes cambios de asignación sin guardar. ¿Salir de todos modos?')) return;
            this._asignDraft.clear();
          }
          this._mainView = btn.dataset.main;
          body.querySelectorAll('.asign-main-tab').forEach(b =>
            b.classList.toggle('active', b.dataset.main === this._mainView));
          this._renderViewArea(document.getElementById('sched-main-area'));
        });
      });

      this._renderViewArea(document.getElementById('sched-main-area'));
    } else {
      // CSV mode — only Cronograma, no pills
      this._mainView = 'cronograma';
      this._renderCronograma(body);
    }
  },

  _renderViewArea(area) {
    if (!area) return;
    if (this._mainView === 'asignacion') {
      this._renderAsignacion(area);
    } else {
      this._renderCronograma(area);
    }
  },

  _renderCronograma(container) {
    const pairs       = this._getPairs();
    const pairResults = pairs.map(pair => {
      const pairKey  = `${pair.sr}|${pair.jr || ''}`;
      const raw      = this._itemsForPair(pair);
      const ordered  = this._applyPriority(raw, pairKey);
      const timeline = this._calcTimeline(pair, ordered);
      return { pair, pairKey, items: ordered, timeline };
    });

    container.innerHTML = `
      <div class="sched-toolbar">
        <div class="sched-view-tabs">
          <button class="sched-tab ${this._view === 'gantt'          ? 'active' : ''}" data-view="gantt">📊 Gantt</button>
          <button class="sched-tab ${this._view === 'lista'          ? 'active' : ''}" data-view="lista">📋 Resumen</button>
          <button class="sched-tab ${this._view === 'disponibilidad' ? 'active' : ''}" data-view="disponibilidad">⏱ Disponibilidad</button>
        </div>
        <button class="btn-secondary" id="sched-cfg-btn">⚙ Configuración</button>
      </div>
      <div id="sched-cfg-panel" style="display:none"></div>
      <div id="sched-content"></div>`;

    container.querySelectorAll('.sched-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this._view = btn.dataset.view;
        container.querySelectorAll('.sched-tab').forEach(b =>
          b.classList.toggle('active', b.dataset.view === this._view));
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
      const cur  = pairs[sr] || '';
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
      { key: 'srReview',     label: 'Sr revisa dibujo',        val: times.srReview     },
      { key: 'srSend',       label: 'Sr envía aprobación',      val: times.srSend       },
      { key: 'clientWait',   label: 'Espera cliente (hábiles)', val: times.clientWait   },
      { key: 'jrCorr',       label: 'Jr correcciones / ronda',  val: times.jrCorr       },
      { key: 'srReviewCorr', label: 'Sr revisa correcciones',   val: times.srReviewCorr },
      { key: 'srElabOP',     label: 'Sr elabora OP + fábrica', val: times.srElabOP     },
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

  // ── View 1: Gantt ──────────────────────────────────────────
  //
  // Coordinate system:
  //   dayToX(d)   = LABEL_W + (d - minDay) * PX
  //     → inner-wrapper coords (includes label column width).
  //     → used only for the today vertical line (positioned in the inner wrapper).
  //
  //   tlDateX(dt) = ((dt - today) / MS - minDay) * PX
  //     → timeline-div coords (does NOT include LABEL_W).
  //     → used for all bars, flags, span bars inside the flex:1 timeline divs.
  //
  // The axis label row and every content row use display:flex with a sticky
  // label div (position:sticky; left:0) and a flex:1 timeline div.
  // This gives a frozen label column during horizontal scroll.

  _renderGantt(container, pairResults) {
    const LABEL_W = 220;    // px — frozen label column width
    const PX      = 28;     // px per calendar day
    const MS      = 86400000;
    const today   = new Date(); today.setHours(0, 0, 0, 0);

    const active = pairResults.filter(p => p.items.length > 0);
    if (!active.length) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">No hay ítems activos en ClickUp.</p>';
      return;
    }

    // X-axis always starts 1 calendar day before today (fixed).
    const minDay = -1;

    // Right edge: at least 60 calendar days; otherwise furthest fabricaDate + 10.
    let maxFabricaDay = 0;
    for (const { timeline } of active) {
      for (const item of timeline) {
        if (item.fabricaDate) {
          const d = Math.ceil((item.fabricaDate.getTime() - today.getTime()) / MS);
          if (d > maxFabricaDay) maxFabricaDay = d;
        }
      }
    }
    const maxDay = Math.max(60, maxFabricaDay + 10);
    // +200 px right padding so nothing gets clipped at the scroll edge
    const totalW = LABEL_W + (maxDay - minDay) * PX + 200;

    // Two coordinate helpers (see comment above):
    const dayToX  = d  => LABEL_W + (d - minDay) * PX;
    const tlDateX = dt => ((dt.getTime() - today.getTime()) / MS - minDay) * PX;

    // Phase colour palette
    const PC = {
      1: { light: '#dbeafe', dark: '#1d4ed8', text: '#1e3a8a', base: '#3b82f6' },
      2: { light: '#ede9fe', dark: '#5b21b6', text: '#4c1d95', base: '#7c3aed' },
      3: { light: '#f3f4f6', dark: '#6b7280', text: '#374151', base: '#9ca3af' },
      4: { light: '#fef3c7', dark: '#b45309', text: '#78350f', base: '#d97706' },
      5: { light: '#d1fae5', dark: '#065f46', text: '#022c22', base: '#10b981' },
    };

    const barStyle = ph => {
      const c = PC[ph.id] || PC[1];
      if (ph.source === 'completed') return { bg: '#e5e7eb', bd: '1px solid #d1cdc7', tx: '#6b6560', op: '0.65' };
      if (ph.source === 'clickup')   return { bg: c.dark,   bd: `2px solid ${c.base}`, tx: '#fff',  op: '1'    };
      /* estimated */                return { bg: c.light,  bd: `1px dashed ${c.base}`, tx: c.text, op: '0.9'  };
    };

    const fmtD    = d => d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const tooltip = ph => {
      const d   = fmtD(ph.endDate);
      const map = { clickup: `Fecha en ClickUp: ${d}`, estimated: `Estimado: ${d}`, completed: `Completado: ${d}` };
      return `${ph.label} — ${map[ph.source] || d}`;
    };

    // Axis date labels — positioned in timeline-div coords (no LABEL_W).
    const axisLabels = [];
    const firstGrid  = Math.ceil(minDay / 7) * 7;
    for (let d = firstGrid; d <= maxDay; d += 7) {
      const x   = (d - minDay) * PX;
      const dt  = new Date(today.getTime() + d * MS);
      const lbl = d === 0 ? 'Hoy'
        : dt.toLocaleDateString('es', { day: '2-digit', month: 'short' });
      axisLabels.push(
        `<div style="position:absolute;left:${x}px;top:0;bottom:0;width:1px;background:var(--divider);pointer-events:none"></div>`,
        `<div style="position:absolute;left:${x}px;bottom:3px;font-size:10px;color:var(--faint);transform:translateX(-50%);white-space:nowrap;pointer-events:none">${lbl}</div>`
      );
    }

    // Today vertical line — positioned in inner-wrapper coords (includes LABEL_W).
    const todayLineX = dayToX(0); // = LABEL_W + 1 * PX
    const todayLine  = `<div style="position:absolute;left:${todayLineX}px;top:0;bottom:0;width:2px;background:#c41c1c;z-index:10;pointer-events:none">
      <div style="position:absolute;top:2px;left:4px;font-size:9px;color:#c41c1c;font-weight:700;white-space:nowrap">Hoy</div>
    </div>`;

    // ── Build HTML for each Sr+Jr pair ─────────────────────────
    const pairsHTML = active.map(({ pair, pairKey, timeline }) => {
      const title = pair.jr ? `${pair.sr} + ${pair.jr}` : pair.sr;
      const color = DESIGNER_COLORS[pair.sr] || '#888';

      // Group items by project while preserving priority order.
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

        // Mini phase-distribution bar for the project row label.
        const counts = { pending: 0, draw: 0, review: 0, wait: 0, corr: 0, done: 0 };
        for (const item of projItems) {
          const ph = item.currentPhase;
          if      (ph === 'Pendiente de inicio')                       counts.pending++;
          else if (ph.includes('dibujando'))                           counts.draw++;
          else if (ph.includes('revisa') || ph.includes('envía'))      counts.review++;
          else if (ph.includes('aprobaci'))                            counts.wait++;
          else if (ph.includes('correcci'))                            counts.corr++;
          else                                                         counts.done++;
        }
        const miniSegs = [
          { n: counts.pending, bg: '#e8e4df' },
          { n: counts.draw,    bg: '#93c5fd' },
          { n: counts.review,  bg: '#c4b5fd' },
          { n: counts.wait,    bg: '#d1cdc7' },
          { n: counts.corr,    bg: '#fcd34d' },
          { n: counts.done,    bg: '#6ee7b7' },
        ].filter(s => s.n > 0)
         .map(s => `<div style="flex:${s.n};background:${s.bg}"></div>`)
         .join('');

        // Project span bar — only from items that have phases (not pending).
        const activeItems = projItems.filter(i => i.phases && i.phases.length > 0);
        let projTimelineHtml = '';
        if (activeItems.length > 0) {
          const allTs  = activeItems.flatMap(i => i.phases.flatMap(p => [p.startDate.getTime(), p.endDate.getTime()]));
          const minTs  = Math.min(...allTs);
          const maxTs  = Math.max(...activeItems.map(i => i.fabricaDate.getTime()));
          const fabStr = new Date(maxTs).toLocaleDateString('es', { day: '2-digit', month: 'short' });
          const spanX  = tlDateX(new Date(minTs));
          const flagX  = tlDateX(new Date(maxTs));
          const spanW  = Math.max(8, flagX - spanX);
          projTimelineHtml =
            `<div style="position:absolute;left:${spanX}px;width:${spanW}px;top:50%;transform:translateY(-50%);height:5px;background:#cbd5e1;border-radius:3px"></div>` +
            `<div title="Est. fábrica: ${fabStr}" style="position:absolute;left:${flagX}px;top:50%;transform:translate(-2px,-50%);font-size:14px;z-index:2;cursor:default">🏁</div>` +
            `<div style="position:absolute;left:${flagX + 16}px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted);white-space:nowrap">${fabStr}</div>`;
        } else {
          projTimelineHtml = `<span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--muted)">Solo pendientes</span>`;
        }

        const projName = proj.length > 30 ? proj.slice(0, 29) + '…' : proj;

        // Project row (collapsible header) — display:flex with sticky label
        innerHtml += `
          <div class="gantt-proj-row" data-pid="${pid}" data-expanded="false"
               style="display:flex;align-items:center;min-width:${totalW}px;border-bottom:1px solid var(--divider);cursor:pointer;user-select:none">
            <div style="width:${LABEL_W}px;flex-shrink:0;position:sticky;left:0;z-index:4;background:var(--bg);padding:7px 10px;display:flex;align-items:center;gap:7px">
              <span class="gprow-arrow" style="font-size:10px;color:var(--faint);width:10px;flex-shrink:0;transition:transform .15s">▶</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(proj)}">${esc(projName)}</div>
                <div style="display:flex;height:4px;border-radius:2px;overflow:hidden;width:80px;gap:1px;margin-top:3px">${miniSegs}</div>
              </div>
              <span style="font-size:11px;color:var(--faint);white-space:nowrap;flex-shrink:0">${projItems.length} ítem${projItems.length !== 1 ? 's' : ''}</span>
            </div>
            <div style="position:relative;flex:1;height:36px;overflow:visible">${projTimelineHtml}</div>
          </div>`;

        // Item rows (collapsed by default; display toggled to 'flex' on expand)
        for (let ii = 0; ii < projItems.length; ii++) {
          const item      = projItems[ii];
          const globalIdx = timeline.indexOf(item);
          const nStr      = item.nivel !== null ? `N${item.nivel}` : '—';

          // Jr badge — show first Jr's first name if any Jr is in allDesigners
          const jrOnItem = (item.allDesigners || []).find(d => this.JR_LIST.includes(d));
          const jrBadge  = jrOnItem
            ? `<span class="gantt-jr-badge">${esc(jrOnItem.split(' ')[0])}</span>`
            : '';

          if (item.pending) {
            // Pending item: badge only, no phase bars
            innerHtml += `
              <div class="gantt-row" draggable="true"
                   data-id="${esc(item.id)}" data-pk="${esc(pairKey)}" data-idx="${globalIdx}" data-pid="${pid}"
                   style="display:none;min-height:40px;background:var(--card)">
                <div style="width:${LABEL_W}px;flex-shrink:0;position:sticky;left:0;z-index:3;background:var(--card);padding:5px 10px 5px 28px">
                  <div style="font-size:12px;font-weight:500;line-height:1.3">${esc(item.name)}${jrBadge}</div>
                  <div style="font-size:10px;color:var(--muted)">${esc(nStr)} · Pendiente</div>
                </div>
                <div style="position:relative;flex:1;min-height:40px;display:flex;align-items:center;padding:0 12px">
                  <span style="background:var(--slate-bg);color:var(--slate);padding:3px 10px;border-radius:4px;font-size:11px;border:1px solid var(--slate-border);white-space:nowrap">Pendiente de inicio</span>
                </div>
              </div>`;
            continue;
          }

          // Normal item with phase bars — bars use tlDateX (timeline-div coords)
          const bars = item.phases.map(ph => {
            const sx  = tlDateX(ph.startDate);
            const ex  = tlDateX(ph.endDate);
            const w   = Math.max(4, ex - sx - 1);
            const st  = barStyle(ph);
            const icon = ph.source === 'clickup' ? '📅' : '';
            const showLabel = w > 60;
            const showIcon  = icon && w > 20;
            const labelTxt  = showLabel
              ? (showIcon ? `${icon} ${ph.label}` : ph.label)
              : (showIcon ? icon : '');
            return `<div title="${esc(tooltip(ph))}" style="position:absolute;left:${sx}px;width:${w}px;top:8px;height:24px;background:${st.bg};border:${st.bd};color:${st.tx};opacity:${st.op};border-radius:4px;font-size:9px;font-weight:500;overflow:hidden;white-space:nowrap;padding:0 4px;line-height:24px">${esc(labelTxt)}</div>`;
          }).join('');

          const fabricaX   = tlDateX(item.fabricaDate);
          const fabricaLbl = item.fabricaDate.toLocaleDateString('es', { day: '2-digit', month: 'short' });

          innerHtml += `
            <div class="gantt-row" draggable="true"
                 data-id="${esc(item.id)}" data-pk="${esc(pairKey)}" data-idx="${globalIdx}" data-pid="${pid}"
                 style="display:none;min-height:40px;background:var(--card)">
              <div style="width:${LABEL_W}px;flex-shrink:0;position:sticky;left:0;z-index:3;background:var(--card);padding:5px 10px 5px 28px">
                <div style="font-size:12px;font-weight:500;line-height:1.3">${esc(item.name)}${jrBadge}</div>
                <div class="gantt-item-meta">${esc(nStr)} · ${esc(item.currentPhase)}</div>
              </div>
              <div style="position:relative;flex:1;min-height:40px;overflow:visible">
                ${bars}
                <div title="Est. fábrica: ${fabricaLbl}"
                     style="position:absolute;left:${fabricaX}px;top:10px;font-size:13px;z-index:3;cursor:default">🏁</div>
              </div>
            </div>`;
        }
      }

      // Wrap each pair in its own horizontal scroll container.
      // The inner wrapper is wider than the container → sticky columns + horizontal scroll.
      return `<div class="sched-pair-block">
        <div class="sched-pair-title">
          <span class="sched-pair-dot" style="background:${color}"></span>
          ${esc(title)}
          <span class="sched-pair-count">${timeline.length} ítem${timeline.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="gantt-scroll-wrap" style="overflow-x:auto;position:relative">
          <div style="position:relative;min-width:${totalW}px">
            ${todayLine}
            <div style="display:flex;align-items:stretch;height:28px;border-bottom:2px solid var(--border);background:var(--bg)">
              <div style="width:${LABEL_W}px;flex-shrink:0;position:sticky;left:0;z-index:5;background:var(--bg)"></div>
              <div style="position:relative;flex:1;height:28px;overflow:visible">${axisLabels.join('')}</div>
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
        <span class="sched-legend-item" style="background:#e5e7eb;border:1px solid #d1cdc7;color:#6b6560">✓ Completado</span>
        <span class="sched-legend-item" style="background:#f3f4f6;border:1px solid #e5e7eb;color:#6b6560">⏳ Pendiente</span>
        <span style="font-size:11px;color:var(--faint);padding:3px 0">🏁 = fábrica estimada &nbsp;· Arrastra para reordenar</span>
      </div>
      ${pairsHTML}`;

    // ── Expand / collapse project rows ─────────────────────────
    container.querySelectorAll('.gantt-proj-row').forEach(projRow => {
      projRow.addEventListener('click', () => {
        const pid      = projRow.dataset.pid;
        const expanded = projRow.dataset.expanded === 'true';
        projRow.dataset.expanded = expanded ? 'false' : 'true';
        const arrow = projRow.querySelector('.gprow-arrow');
        if (arrow) arrow.textContent = expanded ? '▶' : '▼';
        projRow.style.background = expanded ? '' : 'var(--divider)';
        container.querySelectorAll(`.gantt-row[data-pid="${pid}"]`).forEach(r => {
          r.style.display = expanded ? 'none' : 'flex';
        });
      });
    });

    // ── Scroll so today is at ~15 % from the left on first render ──
    // todayX in inner-wrapper coords = LABEL_W + (0 - minDay)*PX = LABEL_W + 1*PX
    const todayX = dayToX(0);
    requestAnimationFrame(() => {
      container.querySelectorAll('.gantt-scroll-wrap').forEach(wrap => {
        wrap.scrollLeft = Math.max(0, todayX - wrap.clientWidth * 0.15);
      });
    });

    this._bindDrag(container, pairResults);
  },

  // ── View 2: Resumen ────────────────────────────────────────

  _renderLista(container, pairResults) {
    const BADGE = {
      'Pendiente de inicio':     '#f3f4f6|#6b6560',
      'Jr dibujando':            '#dbeafe|#1e40af',
      'Sr dibujando':            '#dbeafe|#1e40af',
      'Sr revisa + envía':       '#ede9fe|#5b21b6',
      'En aprobación':           '#f3f4f6|#374151',
      'Jr correcciones':         '#fef3c7|#92400e',
      'Sr correcciones':         '#fef3c7|#92400e',
      'Sr elabora OP + fábrica': '#dcfce7|#166534',
    };
    // Shortened labels so they fit the narrow badge column
    const SHORT = {
      'Pendiente de inicio':     'Pendiente',
      'Sr revisa + envía':       'Sr revisa',
      'En aprobación':           'Aprobación',
      'Sr elabora OP + fábrica': 'OP fábrica',
    };

    const active = pairResults.filter(p => p.items.length > 0);
    if (!active.length) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">No hay ítems activos.</p>';
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const cols = active.map(({ pair, pairKey, timeline }, ci) => {
      const title = pair.jr ? `${pair.sr} + ${pair.jr}` : pair.sr;
      const color = DESIGNER_COLORS[pair.sr] || '#888';

      // Active first, pending at bottom
      const activeItems  = timeline.filter(i => !i.pending);
      const pendingItems = timeline.filter(i => i.pending);

      const renderRow = item => {
        const [bg, fg] = (BADGE[item.currentPhase] || '#f3f4f6|#374151').split('|');
        const label    = SHORT[item.currentPhase] || item.currentPhase;
        const tlIdx    = timeline.indexOf(item);

        let fabCell = '<span class="lista-fab-none">—</span>';
        if (item.fabricaDate) {
          const d      = item.fabricaDate;
          const str    = d.toLocaleDateString('es', { day: '2-digit', month: 'short' });
          const isLate = d < today;
          fabCell = `<span class="lista-fab-date${isLate ? ' lista-fab-late' : ''}">${str}</span>`;
        }

        return `
          <div class="lista-item-row" draggable="true"
               data-id="${esc(item.id)}" data-pk="${esc(pairKey)}" data-idx="${tlIdx}">
            <div class="lista-item-cell">
              <div class="lista-item-name" title="${esc(item.name)}">${esc(item.name)}</div>
              <div class="lista-item-proj" title="${esc(item.project || '')}">${esc(item.project || '—')}</div>
            </div>
            <div class="lista-badge-cell">
              <span class="lista-phase-badge" style="background:${bg};color:${fg}"
                    title="${esc(item.currentPhase)}">${esc(label)}</span>
            </div>
            <div class="lista-date-cell">${fabCell}</div>
          </div>`;
      };

      const activeRows  = activeItems.map(renderRow).join('');
      const pendingRows = pendingItems.length === 0 ? '' : `
        <div class="lista-pending-header">🕐 Próximos a iniciar</div>
        ${pendingItems.map(renderRow).join('')}`;

      const emptyMsg = timeline.length === 0
        ? '<p class="asign-empty-msg">Sin ítems</p>'
        : '';

      const divider = ci > 0 ? '<div class="lista-panel-divider"></div>' : '';

      return `${divider}<div class="lista-panel-col" data-pk="${esc(pairKey)}">
        <div class="lista-col-header">
          <span class="sched-pair-dot" style="background:${color}"></span>
          <span class="lista-col-title" title="${esc(title)}">${esc(title)}</span>
          <span class="lista-col-count">${timeline.length} ítem${timeline.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="lista-col-subheader">
          <div>Ítem</div><div>Estado</div><div>Fábrica</div>
        </div>
        <div class="lista-col-items">
          ${activeRows}${pendingRows}${emptyMsg}
        </div>
      </div>`;
    });

    container.innerHTML = `<div class="lista-panel">${cols.join('')}</div>`;
    this._bindDrag(container, pairResults);
  },

  // ── View 3: Disponibilidad ─────────────────────────────────

  _renderDisp(container, pairResults) {
    const today  = new Date();
    // Only pairs that have at least one non-pending item with a fabricaDate
    const active = pairResults.filter(p =>
      p.timeline.some(i => !i.pending && i.fabricaDate)
    );

    if (!active.length) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">No hay ítems activos con fecha calculada.</p>';
      return;
    }

    const fmt     = d => d.toLocaleDateString('es', { day: '2-digit', month: 'long' });
    const fmtNext = d => {
      const n = new Date(d);
      n.setDate(n.getDate() + (n.getDay() === 5 ? 3 : n.getDay() === 6 ? 2 : 1));
      return fmt(n);
    };

    const rows = active.flatMap(({ pair, timeline }) => {
      // Availability = latest fabricaDate among each designer's non-pending items.
      const srItems = timeline.filter(i => i.designer === pair.sr && !i.pending && i.fabricaDate);
      const jrItems = pair.jr
        ? timeline.filter(i => i.designer === pair.jr && !i.pending && i.fabricaDate)
        : [];

      const srFinMs = srItems.length
        ? Math.max(...srItems.map(i => i.fabricaDate.getTime()))
        : today.getTime();
      const srFin  = new Date(srFinMs);
      const srLate = srFin < today;

      const out = [`<tr>
        <td class="avail-name"><span class="sched-pair-dot" style="background:${DESIGNER_COLORS[pair.sr] || '#888'}"></span>${esc(pair.sr)} <span style="color:var(--faint);font-size:11px">(Sr)</span></td>
        <td class="avail-date">${fmt(srFin)}</td>
        <td class="avail-next"${srLate ? ' style="color:var(--below-text)"' : ''}>${fmtNext(srFin)}${srLate ? ' ⚠' : ''}</td>
      </tr>`];

      if (pair.jr && jrItems.length) {
        const jrFinMs = Math.max(...jrItems.map(i => i.fabricaDate.getTime()));
        const jrFin   = new Date(jrFinMs);
        const jrLate  = jrFin < today;
        out.push(`<tr>
          <td class="avail-name" style="padding-left:28px"><span class="sched-pair-dot" style="background:${DESIGNER_COLORS[pair.jr] || '#888'}"></span>${esc(pair.jr)} <span style="color:var(--faint);font-size:11px">(Jr)</span></td>
          <td class="avail-date">${fmt(jrFin)}</td>
          <td class="avail-next"${jrLate ? ' style="color:var(--below-text)"' : ''}>${fmtNext(jrFin)}${jrLate ? ' ⚠' : ''}</td>
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

  // ── User ID persistence ────────────────────────────────────

  _loadUserIds() {
    try {
      const raw = localStorage.getItem(this.USER_ID_KEY);
      if (raw) this._userIdMap = JSON.parse(raw) || {};
    } catch (_) {}
  },

  _saveUserIds() {
    try {
      localStorage.setItem(this.USER_ID_KEY, JSON.stringify(this._userIdMap));
    } catch (_) {}
  },

  // ── View: Asignación ───────────────────────────────────────

  _renderAsignacion(container) {
    if (!this._rawTasks) {
      container.innerHTML = '<p style="color:var(--muted);padding:24px">La vista Asignación requiere conectar ClickUp vía API.</p>';
      return;
    }

    if (!this._asignDraft) this._asignDraft = new Map();

    // Warn on page-level navigation when draft is non-empty
    if (this._unloadHandler) window.removeEventListener('beforeunload', this._unloadHandler);
    this._unloadHandler = e => {
      if (this._asignDraft && this._asignDraft.size > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', this._unloadHandler);

    // ── Status label / badge colour helpers ──────────────────
    const STATUS_LABEL = {
      'en dibujo':                'En dibujo',
      'revision de constructivo': 'En revisión',
      'enviado a aprobacion':     'Enviado a aprob.',
      'aprobado':                 'Aprobado',
      'proximos a entrar':        'Próx. a entrar',
      'asignado':                 'Asignado',
    };
    const STATUS_COLORS = {
      'en dibujo':                ['#dbeafe', '#1e40af'],
      'revision de constructivo': ['#ede9fe', '#5b21b6'],
      'enviado a aprobacion':     ['#f3f4f6', '#374151'],
      'aprobado':                 ['#dcfce7', '#166534'],
      'proximos a entrar':        ['#f3f4f6', '#6b6560'],
      'asignado':                 ['#f3f4f6', '#6b6560'],
    };

    // ── Jr workload — sourced from _apiTasks for consistency with status chips ──
    // Build reverse pair map: Jr → paired Sr
    const jrToSr = {};
    for (const [sr, jr] of Object.entries(this._cfg.pairs || {})) {
      if (jr) jrToSr[jr] = sr;
    }

    const jrLoad = {};
    for (const jr of this.JR_LIST) {
      const pairedSr = jrToSr[jr] || null;

      // Tasks explicitly assigned to this Jr (any status)
      const assignedTasks = this._apiTasks.filter(t => t.allDesigners.includes(jr));

      // Tasks from the paired Sr's projects that have no Jr explicitly assigned.
      // Shows ALL active items from the Sr's projects without a Jr — whether the
      // task is pending, assigned only to the Sr, or has no own assignee (inherited).
      // The only gate is: no Jr already on it (second condition), and it belongs to
      // the paired Sr (third condition). seenIds dedup below prevents double-counting.
      const upcomingTasks = pairedSr
        ? this._apiTasks.filter(t =>
            !t.allDesigners.some(d => this.JR_LIST.includes(d)) &&
            (
              (t.parentSrs && t.parentSrs.includes(pairedSr)) ||
              t.allDesigners.includes(pairedSr)
            )
          )
        : [];

      // Merge, dedup by taskId
      const seenIds  = new Set(assignedTasks.map(t => t.taskId));
      const allTasks = [
        ...assignedTasks,
        ...upcomingTasks.filter(t => !seenIds.has(t.taskId)),
      ];
      const PENDING_S = new Set(['proximos a entrar', 'asignado']);
      const active    = allTasks.filter(t => !PENDING_S.has(t.status));

      jrLoad[jr] = {
        // Niveles counts only active (non-pending) tasks so workload isn't inflated.
        niveles:  active.reduce((s, t) => s + (t.nivel || 0), 0),
        // Item list shows ALL tasks — pending ones appear with their grey badge.
        items:    allTasks,
        allTasks: allTasks,   // reused for status chips below
      };
    }

    // ── Sr workload (Σ nivel from Cronograma items) ──────────
    const srLoad = {};
    for (const sr of this.SR_LIST) {
      const active = this._items.filter(i => i.designer === sr && !i.pending);
      srLoad[sr] = {
        niveles: active.reduce((s, i) => s + (i.nivel || 0), 0),
        items:   active,
      };
    }

    const loadInfo = niv => {
      if (niv <= 8)  return { dot: '🟢', label: 'Disponible',  cls: 'load-ok'  };
      if (niv <= 15) return { dot: '🟡', label: 'Carga media', cls: 'load-mid' };
      return               { dot: '🔴', label: 'Saturado',    cls: 'load-hi'  };
    };

    // Store refs so helper methods (_updateJrBar, _updateBalance) can access them
    this._jrLoad    = jrLoad;
    this._loadInfoFn = loadInfo;

    // Hoisted so both Section 1 and Section 2 can use it
    const STATUS_ORDER = [
      'en dibujo', 'revision de constructivo',
      'enviado a aprobacion', 'aprobado',
      'proximos a entrar', 'asignado',
    ];
    // Store for reactive chip updates in _updateBoardChips
    this._statusLabel  = STATUS_LABEL;
    this._statusColors = STATUS_COLORS;
    this._statusOrder  = STATUS_ORDER;

    // ── Section 1: Jr status panel (horizontal, 3 columns) ───
    const jrCardsHtml = this.JR_LIST.map(jr => {
      const load  = jrLoad[jr];
      const info  = loadInfo(load.niveles);
      const color = DESIGNER_COLORS[jr] || '#888';

      const renderItem = i => {
        const opStr  = i.op ? `OP ${i.op}` : '';
        const [sbg, sfg] = STATUS_COLORS[i.status] || ['#f3f4f6', '#374151'];
        const slabel = STATUS_LABEL[i.status] || i.status;
        const niv    = i.nivel !== null ? `N${fmtNum(i.nivel)}` : '—';
        return `
          <div class="asign-jr-item" data-status="${esc(i.status)}">
            <div class="asign-jr-item-line1">
              <span class="asign-jr-item-name">${esc(i.name)}</span>
              ${opStr ? `<span class="asign-jr-item-op">${esc(opStr)}</span>` : ''}
            </div>
            <div class="asign-jr-item-proj">${esc(i.project || '—')}</div>
            <div class="asign-jr-item-meta">
              <span class="asign-jr-niv-badge">${esc(niv)}</span>
              <span class="asign-jr-status-badge" style="background:${sbg};color:${sfg}">${esc(slabel)}</span>
            </div>
          </div>`;
      };

      const PENDING_ST   = new Set(['proximos a entrar', 'asignado']);
      const pendingItems = load.items.filter(i => PENDING_ST.has(i.status));
      const activeItems  = load.items.filter(i => !PENDING_ST.has(i.status));

      const pendingSection = pendingItems.length === 0 ? '' : `
        <div class="asign-jr-pending-header">🕐 Próximos a iniciar</div>
        ${pendingItems.map(renderItem).join('')}
        ${activeItems.length > 0 ? '<div class="asign-jr-pending-sep"></div>' : ''}`;

      const itemRows = load.items.length === 0
        ? `<p class="asign-empty-msg">Sin ítems activos</p>`
        : pendingSection + activeItems.map(renderItem).join('');

      // Status breakdown summary (all tasks including pending) — same source as items list
      const allCounts = {};
      for (const t of load.allTasks) allCounts[t.status] = (allCounts[t.status] || 0) + 1;

      const summaryChips = STATUS_ORDER
        .filter(s => allCounts[s])
        .map(s => {
          const [sbg, sfg] = STATUS_COLORS[s] || ['#f3f4f6', '#374151'];
          const slabel = STATUS_LABEL[s] || s;
          return `<span class="asign-status-chip" data-jr="${esc(jr)}" data-status="${esc(s)}" style="background:${sbg};color:${sfg};cursor:pointer">${esc(slabel)} <b>${allCounts[s]}</b></span>`;
        }).join('');

      const summaryRow = summaryChips
        ? `<div class="asign-jr-summary">${summaryChips}</div>`
        : '';

      return `
        <div class="asign-jr-panel-col" data-jr="${esc(jr)}">
          <div class="asign-jr-header">
            <span class="sched-pair-dot" style="background:${color}"></span>
            <span class="asign-jr-name">${esc(jr)}</span>
            <span class="asign-jr-stats">${fmtNum(load.niveles)} niv. · ${load.items.length} ítem${load.items.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="asign-jr-items">${itemRows}</div>
          ${summaryRow}
        </div>`;
    }).join('<div class="asign-jr-panel-divider"></div>');

    // ── Section 2: Items needing a Jr ────────────────────────
    // All tasks (from _apiTasks) that do NOT yet have a Jr assigned
    const needsJr = this._apiTasks.filter(t =>
      !t.allDesigners.some(d => this.JR_LIST.includes(d))
    );

    // ── Fix 3 — Deduplicate projects: each project appears exactly once.
    // Owner Sr priority: parentSrs → item's own Sr → Sr with most items in project.
    const projectMap = new Map(); // projName → { tasks[], ownerSr, srCounts }
    for (const task of needsJr) {
      const projName = task.project || '(Sin proyecto)';
      if (!projectMap.has(projName)) {
        const ownerSr = (task.parentSrs || [])[0]
          || task.allDesigners.find(d => this.SR_LIST.includes(d))
          || null;
        projectMap.set(projName, { tasks: [], ownerSr, srCounts: new Map() });
      }
      const entry = projectMap.get(projName);
      entry.tasks.push(task);
      // Fill ownerSr if still unknown
      if (!entry.ownerSr) {
        entry.ownerSr = (task.parentSrs || [])[0]
          || task.allDesigners.find(d => this.SR_LIST.includes(d))
          || null;
      }
      // Track per-Sr item counts for tiebreaking
      for (const d of task.allDesigners) {
        if (this.SR_LIST.includes(d))
          entry.srCounts.set(d, (entry.srCounts.get(d) || 0) + 1);
      }
    }
    // Final pass: pick the Sr with the most items for projects still without an owner
    for (const entry of projectMap.values()) {
      if (!entry.ownerSr && entry.srCounts.size > 0) {
        let max = 0;
        for (const [sr, cnt] of entry.srCounts) {
          if (cnt > max) { max = cnt; entry.ownerSr = sr; }
        }
      }
    }

    // Bucket deduplicated projects by owning Sr
    const bySr = {};
    for (const sr of this.SR_LIST) bySr[sr] = [];
    const noOwnerProjects = [];
    for (const [projName, entry] of projectMap) {
      if (entry.ownerSr && bySr[entry.ownerSr]) {
        bySr[entry.ownerSr].push({ projName, tasks: entry.tasks });
      } else {
        noOwnerProjects.push({ projName, tasks: entry.tasks });
      }
    }

    // ── Render each draggable item for the board ─────────────
    const renderDragItem = (task, sr) => {
      const draft   = this._asignDraft.get(task.taskId);
      const isDraft = !!draft;
      const niv     = task.nivel !== null ? `N${fmtNum(task.nivel)}` : '—';
      const opStr   = task.op ? `OP ${task.op}` : '';
      const [sbg, sfg] = STATUS_COLORS[task.status] || ['#f3f4f6', '#374151'];
      const slabel  = STATUS_LABEL[task.status] || task.status;
      const jrBadge = isDraft
        ? `<span class="asign-draft-jr-badge">→ ${esc(draft.assignName)}</span>` : '';
      // +Sr quick-assign: only for items with NO assignee at all (not already in draft)
      const srBtn = (!isDraft && sr && !task.hasOwnDesigners)
        ? `<button class="asign-quick-sr-btn" data-task-id="${esc(task.taskId)}" data-sr="${esc(sr)}" title="Asignar a ${esc(sr)}">+ Sr</button>`
        : '';
      return `
        <div class="asign-drag-item${isDraft ? ' draft-assigned' : ''}"
             draggable="true"
             data-task-id="${esc(task.taskId)}"
             data-task-name="${esc(task.name)}"
             data-nivel="${task.nivel || 0}"
             data-sr="${esc(sr || '')}">
          <span class="asign-drag-handle">⠿</span>
          <div class="asign-drag-info">
            <div class="asign-drag-name">${esc(task.name)}${opStr ? ` <span class="asign-prow-op">${esc(opStr)}</span>` : ''}</div>
            <div class="asign-drag-proj">${esc(task.project || '—')}</div>
            <div class="asign-drag-meta">
              <span class="asign-prow-niv">${esc(niv)}</span>
              <span class="asign-prow-status" style="background:${sbg};color:${sfg}">${esc(slabel)}</span>
              ${jrBadge}${srBtn}
            </div>
          </div>
        </div>`;
    };

    // Store Sr task map so _updateSrBar can recalculate remaining nivel reactively
    this._srTasks = new Map();
    for (const sr of this.SR_LIST) {
      this._srTasks.set(sr, bySr[sr].flatMap(p => p.tasks));
    }
    if (noOwnerProjects.length > 0) {
      this._srTasks.set('', noOwnerProjects.flatMap(p => p.tasks));
    }

    // Helper: remaining unassigned nivel for an Sr (deduct already-drafted items)
    const srRemaining = tasks => {
      const drafted = Array.from(this._asignDraft.values())
        .filter(c => tasks.some(t => t.taskId === c.taskId))
        .reduce((s, c) => s + (c.nivel || 0), 0);
      return tasks.reduce((s, t) => s + (t.nivel || 0), 0) - drafted;
    };

    // ── Sr board cards (left panel) ────────────────────────────
    const srBoardCards = [
      ...this.SR_LIST.map((sr, srIdx) => {
        const projList = bySr[sr];
        if (!projList.length) return '';
        const allTasks = projList.flatMap(p => p.tasks);
        const srId      = `sr${srIdx}`;
        const remaining = srRemaining(allTasks);
        const barWidth  = Math.min(100, remaining / 20 * 100);
        const barColor  = remaining <= 8 ? '#dcfce7' : remaining <= 15 ? '#fef3c7' : '#fee2e2';
        const color     = DESIGNER_COLORS[sr] || '#888';
        return `
          <div class="asign-sr-boardcard" data-sr="${esc(sr)}">
            <div class="asign-sr-boardcard-hdr">
              <span class="sched-pair-dot" style="background:${color}"></span>
              <span class="asign-sr-boardcard-name">${esc(sr)}</span>
              <span class="asign-sr-boardcard-sigma" id="asign-sr-sigma-${srId}">Σ ${fmtNum(remaining)} pts</span>
            </div>
            <div class="asign-sr-loadbar-wrap">
              <div class="asign-sr-loadbar" id="asign-sr-bar-${srId}"
                   style="width:${barWidth}%;background:${barColor};transition:width 0.4s ease,background-color 0.3s ease"></div>
            </div>
            <div class="asign-sr-boardcard-items">
              ${allTasks.map(t => renderDragItem(t, sr)).join('')}
            </div>
          </div>`;
      }),
      noOwnerProjects.length > 0 ? (() => {
        const allTasks  = noOwnerProjects.flatMap(p => p.tasks);
        const remaining = srRemaining(allTasks);
        const barWidth  = Math.min(100, remaining / 20 * 100);
        const barColor  = remaining <= 8 ? '#dcfce7' : remaining <= 15 ? '#fef3c7' : '#fee2e2';
        return `
          <div class="asign-sr-boardcard" data-sr="">
            <div class="asign-sr-boardcard-hdr">
              <span class="sched-pair-dot" style="background:#a09890"></span>
              <span class="asign-sr-boardcard-name">Sin asignar</span>
              <span class="asign-sr-boardcard-sigma" id="asign-sr-sigma-sr-none">Σ ${fmtNum(remaining)} pts</span>
            </div>
            <div class="asign-sr-loadbar-wrap">
              <div class="asign-sr-loadbar" id="asign-sr-bar-sr-none"
                   style="width:${barWidth}%;background:${barColor};transition:width 0.4s ease,background-color 0.3s ease"></div>
            </div>
            <div class="asign-sr-boardcard-items">
              ${allTasks.map(t => renderDragItem(t, null)).join('')}
            </div>
          </div>`;
      })() : '',
    ].filter(Boolean).join('');

    // ── Jr drop cards (right column) ──────────────────────────
    const jrBoardCards = this.JR_LIST.map((jr, idx) => {
      const baseLoad  = jrLoad[jr].niveles;
      const draftLoad = Array.from(this._asignDraft.values())
        .filter(c => c.assignName === jr)
        .reduce((s, c) => s + (c.nivel || 0), 0);
      const totalLoad = baseLoad + draftLoad;
      const barWidth  = Math.min(100, totalLoad / 20 * 100);
      const barColor  = totalLoad <= 8 ? '#d1fae5' : totalLoad <= 15 ? '#fef3c7' : '#fee2e2';
      const info  = loadInfo(totalLoad);
      const color = DESIGNER_COLORS[jr] || '#888';
      const jrId  = `jr${idx}`;

      const draftItemsHtml = Array.from(this._asignDraft.values())
        .filter(c => c.assignName === jr)
        .map(c => `
          <div class="asign-dropzone-item" data-task-id="${esc(c.taskId)}">
            <span class="asign-dropzone-item-name">${esc(c.taskName)}</span>
            <span class="asign-dropzone-item-niv">${c.nivel ? `N${fmtNum(c.nivel)}` : '—'}</span>
            <button class="asign-dropzone-undo" data-task-id="${esc(c.taskId)}" title="Deshacer">✕</button>
          </div>`).join('');

      // Status breakdown chips — same as Section 1
      const boardJrTasks = this._apiTasks.filter(t => t.allDesigners.includes(jr));
      const boardCounts  = {};
      for (const t of boardJrTasks) boardCounts[t.status] = (boardCounts[t.status] || 0) + 1;
      const boardChipsHtml = STATUS_ORDER
        .filter(s => boardCounts[s])
        .map(s => {
          const [sbg, sfg] = STATUS_COLORS[s] || ['#f3f4f6', '#374151'];
          const slabel = STATUS_LABEL[s] || s;
          return `<span class="asign-status-chip" style="background:${sbg};color:${sfg}">${esc(slabel)} <b>${boardCounts[s]}</b></span>`;
        }).join('');
      // Always render container so _updateBoardChips can find it by ID
      const boardChips = `<div class="asign-jr-board-chips" id="asign-jr-chips-${jrId}">${boardChipsHtml}</div>`;

      return `
        <div class="asign-jr-dropcard" data-jr="${esc(jr)}">
          <div class="asign-jr-dropcard-hdr">
            <span class="sched-pair-dot" style="background:${color}"></span>
            <span class="asign-jr-name">${esc(jr)}</span>
            <span class="asign-load-indicator ${info.cls}" id="asign-loaddot-${jrId}">${info.dot} ${info.label}</span>
            <span class="asign-jr-sigma" id="asign-sigma-${jrId}">Σ ${fmtNum(totalLoad)} pts</span>
          </div>
          <div class="asign-jr-loadbar-wrap">
            <div class="asign-jr-loadbar" id="asign-bar-${jrId}"
                 style="width:${barWidth}%;background:${barColor};transition:width 0.4s ease,background-color 0.3s ease"></div>
          </div>
          ${boardChips}
          <div class="asign-jr-dropzone" id="asign-dropzone-${jrId}" data-jr="${esc(jr)}">
            ${draftItemsHtml || `<span class="asign-dropzone-hint">Arrastra ítems aquí</span>`}
          </div>
        </div>`;
    }).join('');

    // ── Balance indicator ─────────────────────────────────────
    const balLoads = this.JR_LIST.map(jr => {
      const base  = jrLoad[jr].niveles;
      const draft = Array.from(this._asignDraft.values())
        .filter(c => c.assignName === jr).reduce((s, c) => s + (c.nivel || 0), 0);
      return { jr, load: base + draft };
    });
    const balMin = Math.min(...balLoads.map(l => l.load));
    const balMax = Math.max(...balLoads.map(l => l.load));
    const balRatio = balMin > 0 ? balMax / balMin : 0;
    const balChips = balLoads.map(l =>
      `<span class="asign-balance-chip">${loadInfo(l.load).dot} ${esc(l.jr)} <b>${fmtNum(l.load)}</b></span>`
    ).join('');
    const balWarn = balRatio > 1.5
      ? `<span class="asign-balance-warn">⚠ ${esc(balLoads.find(l=>l.load===balMax)?.jr||'')} tiene ${fmtNum(balRatio)}× la carga del más libre — considera redistribuir</span>`
      : '';
    const balanceHtml = `
      <div class="asign-balance" id="asign-balance">
        <span class="asign-balance-label">Balance del equipo:</span>
        ${balChips} ${balWarn}
      </div>`;

    const boardHtml = `
      <div class="asign-board">
        ${balanceHtml}
        <div class="asign-board-panel">
          <div class="asign-board-left">
            <div class="asign-board-half-title">SENIORS</div>
            <div class="asign-sr-grid">${srBoardCards}</div>
          </div>
          <div class="asign-board-divider"></div>
          <div class="asign-board-right">
            <div class="asign-board-half-title">JUNIORS</div>
            <div class="asign-jr-list">${jrBoardCards}</div>
          </div>
        </div>
      </div>`;

    const draftBarHtml = this._asignDraft.size > 0 ? this._buildDraftBar() : '';

    container.innerHTML = `
      <div class="asign-wrap">
        <div class="asign-section-title">ESTADO ACTUAL DEL EQUIPO</div>
        <div class="asign-jr-panel">${jrCardsHtml}</div>

        <div class="asign-section-title" style="margin-top:40px">ASIGNAR ÍTEMS</div>
        ${needsJr.length > 0
          ? boardHtml
          : `<p class="asign-empty-msg" style="padding:16px 0">Todos los ítems activos tienen Jr asignado. 🎉</p>`
        }
      </div>
      <div id="asign-draft-bar" class="asign-draft-bar${this._asignDraft.size > 0 ? ' visible' : ''}">${draftBarHtml}</div>`;

    this._bindBoard(container);
    this._bindDraftBar(container, document.getElementById('asign-draft-bar'));
    this._bindChipFilter(container);
  },

  _bindChipFilter(container) {
    const PENDING_ST = new Set(['proximos a entrar', 'asignado']);
    container.querySelectorAll('.asign-status-chip[data-status]').forEach(chip => {
      chip.addEventListener('click', () => {
        const status   = chip.dataset.status;
        const panel    = chip.closest('.asign-jr-panel-col');
        const itemsEl  = panel?.querySelector('.asign-jr-items');
        if (!panel || !itemsEl) return;

        const wasActive = chip.classList.contains('active-filter');

        // Clear all active chips in this panel
        panel.querySelectorAll('.asign-status-chip').forEach(c => c.classList.remove('active-filter'));

        const pendingHeader = itemsEl.querySelector('.asign-jr-pending-header');
        const pendingSep    = itemsEl.querySelector('.asign-jr-pending-sep');

        if (wasActive) {
          // Remove filter — show everything
          itemsEl.querySelectorAll('.asign-jr-item').forEach(el => el.style.display = '');
          if (pendingHeader) pendingHeader.style.display = '';
          if (pendingSep)    pendingSep.style.display    = '';
        } else {
          // Apply filter
          chip.classList.add('active-filter');
          itemsEl.querySelectorAll('.asign-jr-item').forEach(el => {
            el.style.display = el.dataset.status === status ? '' : 'none';
          });
          // Show/hide pending section header based on whether filtered status is pending
          const isPending = PENDING_ST.has(status);
          if (pendingHeader) pendingHeader.style.display = isPending ? '' : 'none';
          if (pendingSep)    pendingSep.style.display    = isPending ? '' : 'none';
        }
      });
    });
  },

  _buildDraftBar() {
    const changes = Array.from(this._asignDraft.values());
    const list = changes.map(c => {
      const typeLabel = c.assignType === 'sr' ? 'Sr' : 'Jr';
      return `<span class="asign-draft-chip">
        <b>${esc(c.assignName)}</b> <span style="opacity:.6;font-size:10px">${typeLabel}</span> ← ${esc(c.taskName)}
        <button class="asign-chip-undo" data-task-id="${esc(c.taskId)}" title="Deshacer este ítem">✕</button>
      </span>`;
    }).join('');
    const n = changes.length;
    return `
      <div class="asign-draft-inner">
        <div class="asign-draft-info">
          <span class="asign-draft-count">📋 ${n} cambio${n !== 1 ? 's' : ''} pendiente${n !== 1 ? 's' : ''}</span>
          <div class="asign-draft-chips">${list}</div>
        </div>
        <div class="asign-draft-actions">
          <button class="btn-secondary" id="asign-discard-btn">Descartar todo</button>
          <button class="btn-primary"   id="asign-confirm-btn">Confirmar y sincronizar con ClickUp →</button>
        </div>
      </div>`;
  },

  _bindDraftBar(container, bar) {
    if (!bar) return;
    const discardBtn = bar.querySelector('#asign-discard-btn');
    const confirmBtn = bar.querySelector('#asign-confirm-btn');
    if (discardBtn) discardBtn.onclick = () => {
      this._asignDraft.clear();
      this._renderAsignacion(container);
    };
    if (confirmBtn) confirmBtn.onclick = () => this._syncAsignacion(container);
    bar.querySelectorAll('.asign-chip-undo').forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        this._undoDraftItem(btn.dataset.taskId, container);
      };
    });
  },

  async _syncAsignacion(container) {
    const apiKey = ClickUpIntegration.getApiKey();
    if (!apiKey) {
      alert('No se encontró el API token de ClickUp. Ve a Inicio y vuelve a conectar.');
      return;
    }

    const changes  = Array.from(this._asignDraft.values());
    const total    = changes.length;
    const bar      = document.getElementById('asign-draft-bar');
    let   succeeded = 0;
    const errors   = [];

    for (let i = 0; i < changes.length; i++) {
      const c = changes[i];
      if (bar) bar.innerHTML = `
        <div class="asign-draft-inner">
          <span style="font-size:13px;color:var(--muted)">
            Actualizando ítem ${i + 1} de ${total}… <b>${esc(c.taskName)}</b>
          </span>
        </div>`;

      if (!c.assignUserId) {
        errors.push(`${c.taskName} — user ID no encontrado para "${c.assignName}". Sincroniza de nuevo en Inicio.`);
        continue;
      }

      try {
        const resp = await fetch(`https://api.clickup.com/api/v2/task/${c.taskId}`, {
          method:  'PUT',
          headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ assignees: { add: [Number(c.assignUserId)] } }),
        });
        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data?.err || data?.error || `HTTP ${resp.status}`);
        }
        // Update local _apiTasks so the re-render reflects the new assignment
        const local = this._apiTasks.find(t => t.taskId === c.taskId);
        if (local && !local.allDesigners.includes(c.assignName)) {
          local.allDesigners.push(c.assignName);
        }
        succeeded++;
      } catch (err) {
        errors.push(`${c.taskName} — ${err.message}`);
      }
    }

    this._asignDraft.clear();

    if (errors.length === 0) {
      if (bar) {
        bar.innerHTML = `
          <div class="asign-draft-inner">
            <span style="font-size:13px;font-weight:600;color:#065f46">
              ✓ ${succeeded} ítem${succeeded !== 1 ? 's' : ''} actualizado${succeeded !== 1 ? 's' : ''} en ClickUp
            </span>
          </div>`;
      }
      setTimeout(() => this._renderAsignacion(container), 1200);
    } else {
      if (bar) {
        bar.innerHTML = `
          <div class="asign-draft-inner">
            <div style="font-size:13px">
              <b>✓ ${succeeded} de ${total} actualizado${succeeded !== 1 ? 's' : ''}.</b>
              Errores:<br>${errors.map(e => `<span style="color:var(--below-text)">${esc(e)}</span>`).join('<br>')}
            </div>
            <div class="asign-draft-actions">
              <button class="btn-secondary" id="asign-discard-btn">Cerrar</button>
            </div>
          </div>`;
        bar.querySelector('#asign-discard-btn')?.addEventListener('click', () => {
          this._renderAsignacion(container);
        });
      }
    }
  },

  // ── Board drag-and-drop (Asignación board) ────────────────

  _bindBoard(container) {
    let dragTaskId = null;
    let dragNivel  = 0;
    let dragSr     = '';   // Sr that owns the dragged item

    container.querySelectorAll('.asign-drag-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        dragTaskId = item.dataset.taskId;
        dragNivel  = parseFloat(item.dataset.nivel) || 0;
        dragSr     = item.dataset.sr || '';
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
        setTimeout(() => { item.style.opacity = '0.4'; }, 0);
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        item.style.opacity = '';
        dragTaskId = null;
        dragNivel  = 0;
        dragSr     = '';
        container.querySelectorAll('.asign-jr-dropzone').forEach(dz =>
          dz.classList.remove('dz-ok', 'dz-warn', 'dz-danger')
        );
      });
    });

    container.querySelectorAll('.asign-jr-dropzone').forEach(dz => {
      dz.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragTaskId || !this._jrLoad) return;
        const jr = dz.dataset.jr;
        if (!this.JR_LIST.includes(jr)) return;
        const base  = this._jrLoad[jr]?.niveles || 0;
        const draft = Array.from(this._asignDraft.values())
          .filter(c => c.assignName === jr && c.taskId !== dragTaskId)
          .reduce((s, c) => s + (c.nivel || 0), 0);
        const projected = base + draft + dragNivel;
        dz.classList.remove('dz-ok', 'dz-warn', 'dz-danger');
        if      (projected <= 8)  dz.classList.add('dz-ok');
        else if (projected <= 15) dz.classList.add('dz-warn');
        else                      dz.classList.add('dz-danger');
      });
      dz.addEventListener('dragleave', e => {
        if (!dz.contains(e.relatedTarget))
          dz.classList.remove('dz-ok', 'dz-warn', 'dz-danger');
      });
      dz.addEventListener('drop', e => {
        e.preventDefault();
        dz.classList.remove('dz-ok', 'dz-warn', 'dz-danger');
        if (!dragTaskId) return;
        const jr = dz.dataset.jr;
        if (!this.JR_LIST.includes(jr)) return;

        const task = this._apiTasks.find(t => t.taskId === dragTaskId);
        if (!task) return;
        const userId = this._userIdMap[jr] || null;

        // Save/update draft (fromSr needed so _undoDraftItem can update the Sr bar)
        this._asignDraft.set(dragTaskId, {
          taskId:       dragTaskId,
          taskName:     task.name,
          assignType:   'jr',
          assignName:   jr,
          assignUserId: userId,
          nivel:        task.nivel || 0,
          fromSr:       dragSr,
        });

        // Mark source Sr item as draft-assigned
        const srcItem = container.querySelector(`.asign-drag-item[data-task-id="${CSS.escape(dragTaskId)}"]`);
        if (srcItem) {
          srcItem.classList.add('draft-assigned');
          let badge = srcItem.querySelector('.asign-draft-jr-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'asign-draft-jr-badge';
            const meta = srcItem.querySelector('.asign-drag-meta');
            if (meta) meta.appendChild(badge);
          }
          badge.textContent = `→ ${jr}`;
        }

        // Remove this task from any other dropzone (if re-assigned)
        container.querySelectorAll(`.asign-dropzone-item[data-task-id="${CSS.escape(dragTaskId)}"]`).forEach(el => el.remove());

        // Remove the hint if present
        const hint = dz.querySelector('.asign-dropzone-hint');
        if (hint) hint.remove();

        // Append dropzone item (no per-element binding — delegation handles clicks)
        const niv = task.nivel !== null ? `N${fmtNum(task.nivel)}` : '—';
        const itemEl = document.createElement('div');
        itemEl.className = 'asign-dropzone-item';
        itemEl.dataset.taskId = dragTaskId;
        itemEl.innerHTML = `
          <span class="asign-dropzone-item-name">${esc(task.name)}</span>
          <span class="asign-dropzone-item-niv">${esc(niv)}</span>
          <button class="asign-dropzone-undo" data-task-id="${esc(dragTaskId)}" title="Deshacer">✕</button>`;
        dz.appendChild(itemEl);

        this._updateJrBar(jr, container);
        this._updateSrBar(dragSr, container);
        this._updateBoardChips(jr, container);
        this._updateBalance(container);
        this._refreshDraftBar(container);
      });
    });

    // ── Delegated click handler for all dynamic buttons ────────
    // Handles .asign-dropzone-undo (✕ in Jr dropzone) and
    // .asign-quick-sr-btn (+ Sr on unassigned items) — avoids stale
    // closure bugs that arise when binding directly in the drop handler.
    container.addEventListener('click', e => {
      // ✕ undo button inside a Jr dropzone
      const undoBtn = e.target.closest('.asign-dropzone-undo');
      if (undoBtn) {
        this._undoDraftItem(undoBtn.dataset.taskId, container);
        return;
      }

      // + Sr quick-assign button on an unassigned Sr item
      const srBtn = e.target.closest('.asign-quick-sr-btn');
      if (srBtn) {
        e.stopPropagation();
        const taskId = srBtn.dataset.taskId;
        const srName = srBtn.dataset.sr;
        if (!taskId || !srName || this._asignDraft.has(taskId)) return;
        const task   = this._apiTasks.find(t => t.taskId === taskId);
        if (!task) return;
        this._asignDraft.set(taskId, {
          taskId,
          taskName:     task.name,
          assignType:   'sr',
          assignName:   srName,
          assignUserId: this._userIdMap[srName] || null,
          nivel:        task.nivel || 0,
          fromSr:       srName,
        });
        // Mark item as draft-assigned and inject badge
        const itemEl = srBtn.closest('.asign-drag-item');
        if (itemEl) {
          itemEl.classList.add('draft-assigned');
          srBtn.remove();
          let badge = itemEl.querySelector('.asign-draft-jr-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'asign-draft-jr-badge';
            itemEl.querySelector('.asign-drag-meta')?.appendChild(badge);
          }
          badge.textContent = `→ ${srName}`;
        }
        this._refreshDraftBar(container);
      }
    });
  },

  _updateJrBar(jr, container) {
    const jrIdx = this.JR_LIST.indexOf(jr);
    if (jrIdx < 0 || !this._jrLoad || !this._loadInfoFn) return;
    const jrId  = `jr${jrIdx}`;
    const base  = this._jrLoad[jr]?.niveles || 0;
    const draft = Array.from(this._asignDraft.values())
      .filter(c => c.assignName === jr).reduce((s, c) => s + (c.nivel || 0), 0);
    const total    = base + draft;
    const barPct   = Math.min(100, total / 20 * 100);
    const barColor = total <= 8 ? '#dcfce7' : total <= 15 ? '#fef3c7' : '#fee2e2';
    const info     = this._loadInfoFn(total);

    const barEl   = document.getElementById(`asign-bar-${jrId}`);
    const sigmaEl = document.getElementById(`asign-sigma-${jrId}`);
    const dotEl   = document.getElementById(`asign-loaddot-${jrId}`);
    if (barEl)   { barEl.style.width = `${barPct}%`; barEl.style.background = barColor; }
    if (sigmaEl) sigmaEl.textContent = `Σ ${fmtNum(total)} pts`;
    if (dotEl)   { dotEl.textContent = `${info.dot} ${info.label}`; dotEl.className = `asign-load-indicator ${info.cls}`; }
  },

  _updateBalance(container) {
    if (!this._jrLoad || !this._loadInfoFn) return;
    const balEl = document.getElementById('asign-balance');
    if (!balEl) return;
    const balLoads = this.JR_LIST.map(jr => {
      const base  = this._jrLoad[jr]?.niveles || 0;
      const draft = Array.from(this._asignDraft.values())
        .filter(c => c.assignName === jr).reduce((s, c) => s + (c.nivel || 0), 0);
      return { jr, load: base + draft };
    });
    const balMin   = Math.min(...balLoads.map(l => l.load));
    const balMax   = Math.max(...balLoads.map(l => l.load));
    const balRatio = balMin > 0 ? balMax / balMin : 0;
    const balChips = balLoads.map(l =>
      `<span class="asign-balance-chip">${this._loadInfoFn(l.load).dot} ${esc(l.jr)} <b>${fmtNum(l.load)}</b></span>`
    ).join('');
    const balWarn = balRatio > 1.5
      ? `<span class="asign-balance-warn">⚠ ${esc(balLoads.find(l => l.load === balMax)?.jr || '')} tiene ${fmtNum(balRatio)}× la carga del más libre — considera redistribuir</span>`
      : '';
    balEl.innerHTML = `<span class="asign-balance-label">Balance del equipo:</span>${balChips} ${balWarn}`;
  },

  _updateSrBar(sr, container) {
    if (!this._srTasks) return;
    const tasks     = this._srTasks.get(sr) || [];
    const remaining = tasks
      .filter(t => !this._asignDraft.has(t.taskId))
      .reduce((s, t) => s + (t.nivel || 0), 0);
    const barPct    = Math.min(100, remaining / 20 * 100);
    const barColor  = remaining <= 8 ? '#dcfce7' : remaining <= 15 ? '#fef3c7' : '#fee2e2';
    const srIdx     = this.SR_LIST.indexOf(sr);
    const srId      = srIdx >= 0 ? `sr${srIdx}` : 'sr-none';
    const barEl     = document.getElementById(`asign-sr-bar-${srId}`);
    const sigmaEl   = document.getElementById(`asign-sr-sigma-${srId}`);
    if (barEl)   { barEl.style.width = `${barPct}%`; barEl.style.background = barColor; }
    if (sigmaEl) sigmaEl.textContent = `Σ ${fmtNum(remaining)} pts`;
  },

  _updateBoardChips(jr, container) {
    const jrIdx = this.JR_LIST.indexOf(jr);
    if (jrIdx < 0 || !this._statusOrder) return;
    const chipsEl = document.getElementById(`asign-jr-chips-jr${jrIdx}`);
    if (!chipsEl) return;

    // Tasks already assigned to this Jr in ClickUp
    const existing    = this._apiTasks.filter(t => t.allDesigners.includes(jr));
    const existingIds = new Set(existing.map(t => t.taskId));

    // Tasks being draft-assigned to this Jr (not yet in allDesigners)
    const draftAdded = Array.from(this._asignDraft.values())
      .filter(c => c.assignName === jr && c.assignType === 'jr' && !existingIds.has(c.taskId))
      .map(c => this._apiTasks.find(t => t.taskId === c.taskId))
      .filter(Boolean);

    const counts = {};
    for (const t of [...existing, ...draftAdded]) {
      counts[t.status] = (counts[t.status] || 0) + 1;
    }

    chipsEl.innerHTML = this._statusOrder
      .filter(s => counts[s])
      .map(s => {
        const [sbg, sfg] = (this._statusColors[s] || ['#f3f4f6', '#374151']);
        const slabel = this._statusLabel[s] || s;
        return `<span class="asign-status-chip" style="background:${sbg};color:${sfg}">${esc(slabel)} <b>${counts[s]}</b></span>`;
      }).join('');
  },

  _undoDraftItem(taskId, container) {
    const draft = this._asignDraft.get(taskId);
    if (!draft) return;
    const assignName  = draft.assignName;
    const fromSr      = draft.fromSr ?? '';
    const isSrAssign  = draft.assignType === 'sr';
    this._asignDraft.delete(taskId);

    // Remove item from Jr dropzone (only Jr-type drafts produce a dropzone row)
    if (!isSrAssign) {
      container.querySelectorAll(`.asign-dropzone-item[data-task-id="${CSS.escape(taskId)}"]`).forEach(el => {
        const dz = el.closest('.asign-jr-dropzone');
        el.remove();
        if (dz && !dz.querySelector('.asign-dropzone-item')) {
          dz.innerHTML = `<span class="asign-dropzone-hint">Arrastra ítems aquí</span>`;
        }
      });
    }

    // Un-mark the Sr drag item
    const srcItem = container.querySelector(`.asign-drag-item[data-task-id="${CSS.escape(taskId)}"]`);
    if (srcItem) {
      srcItem.classList.remove('draft-assigned');
      srcItem.querySelector('.asign-draft-jr-badge')?.remove();
      // Re-inject the +Sr button when undoing a Sr assignment of an unassigned item
      if (isSrAssign) {
        const task = this._apiTasks.find(t => t.taskId === taskId);
        const meta = srcItem.querySelector('.asign-drag-meta');
        if (task && !task.hasOwnDesigners && assignName && meta
            && !meta.querySelector('.asign-quick-sr-btn')) {
          const btn = document.createElement('button');
          btn.className        = 'asign-quick-sr-btn';
          btn.dataset.taskId   = taskId;
          btn.dataset.sr       = assignName;
          btn.title            = `Asignar a ${assignName}`;
          btn.textContent      = '+ Sr';
          meta.appendChild(btn);
          // No explicit listener needed — delegated click handler in _bindBoard handles it
        }
      }
    }

    // Reactive updates — skip Jr/Sr bars and chips for Sr-type assignments
    if (!isSrAssign) {
      this._updateJrBar(assignName, container);
      this._updateSrBar(fromSr, container);
      this._updateBoardChips(assignName, container);
    }
    this._updateBalance(container);
    this._refreshDraftBar(container);
  },

  _refreshDraftBar(container) {
    const bar = document.getElementById('asign-draft-bar');
    if (!bar) return;
    if (this._asignDraft.size === 0) {
      bar.classList.remove('visible');
      bar.innerHTML = '';
    } else {
      bar.classList.add('visible');
      bar.innerHTML = this._buildDraftBar();
      this._bindDraftBar(container, bar);
    }
  },

  // ── Drag-and-drop (Cronograma reorder) ────────────────────

  _bindDrag(container, pairResults) {
    let src = null;
    container.querySelectorAll('[draggable="true"]').forEach(row => {
      row.addEventListener('dragstart', e => {
        src = { id: row.dataset.id, pk: row.dataset.pk, idx: +row.dataset.idx };
        e.dataTransfer.effectAllowed = 'move';
        row.style.opacity = '0.45';
      });
      row.addEventListener('dragend',   () => { row.style.opacity = ''; src = null; });
      row.addEventListener('dragover',  e => { e.preventDefault(); row.style.outline = '2px solid var(--aprob-text)'; });
      row.addEventListener('dragleave', () => { row.style.outline = ''; });
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.style.outline = '';
        if (!src || src.pk !== row.dataset.pk) return;
        const targetIdx = +row.dataset.idx;
        if (src.idx === targetIdx) return;
        const pr = pairResults.find(p => p.pairKey === src.pk);
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
