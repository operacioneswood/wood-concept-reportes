// ─────────────────────────────────────────────────────────────
// js/app.js — Application controller
//
// Depends on: config.js, parser.js, scoring.js, storage.js,
//             report.js, charts.js, dashboard.js, compare.js
// ─────────────────────────────────────────────────────────────

const App = {
  _screen:     'upload',
  _cuRows:     null,
  _regRows:    null,
  _cuFile:     '',
  _regFile:    '',
  _month:      null,
  _year:       null,
  _sourceMode: 'csv',   // 'csv' | 'api'
  _cuApiData:  null,    // { rawTasks, fieldIds, parsedTasks } after successful sync
  _syncing:    false,

  // ── Bootstrap ─────────────────────────────────────────────

  async init() {
    this._detectMonthYear();
    this._bindNav();
    this._bindUpload();
    this._bindModeToggle();
    this._bindReportActions();
    this._showScreen('upload');
    await this.refreshSavedMonths();
  },

  // ── Screen routing ────────────────────────────────────────

  _showScreen(id) {
    this._screen = id;
    document.querySelectorAll('.screen').forEach(s => {
      s.classList.toggle('screen-active', s.id === `screen-${id}`);
    });
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.screen === id);
    });
    if (id === 'dashboard') Dashboard.render().catch(console.error);
    if (id === 'compare')   Compare.render().catch(console.error);
    if (id === 'schedule') {
      if (this._sourceMode === 'api' && this._cuApiData) {
        Schedule.renderFromAPI(this._cuApiData.rawTasks, this._cuApiData.fieldIds);
      } else {
        Schedule.render(this._cuRows);
      }
    }
  },

  _bindNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!btn.disabled) this._showScreen(btn.dataset.screen);
      });
    });
  },

  // ── ClickUp mode toggle ───────────────────────────────────

  _bindModeToggle() {
    const csvBtn  = document.getElementById('mode-toggle-csv');
    const apiBtn  = document.getElementById('mode-toggle-api');
    const csvPane = document.getElementById('dz-left-csv');
    const apiPane = document.getElementById('dz-left-api');
    const syncBtn   = document.getElementById('cu-sync-btn');
    const forceBtn  = document.getElementById('cu-force-btn');
    const listInput = document.getElementById('cu-list-id');
    const keyInput  = document.getElementById('cu-api-key');

    if (!csvBtn || !apiBtn) return;

    // Restore saved values
    if (listInput) listInput.value = ClickUpIntegration.getListId();
    if (keyInput)  keyInput.value  = ClickUpIntegration.getApiKey();

    const switchMode = mode => {
      this._sourceMode = mode;
      csvBtn.classList.toggle('active', mode === 'csv');
      apiBtn.classList.toggle('active', mode === 'api');
      if (csvPane) csvPane.style.display = mode === 'csv' ? '' : 'none';
      if (apiPane) apiPane.style.display = mode === 'api' ? '' : 'none';

      // Restore or clear cuApiData display
      if (mode === 'api') this._updateSyncInfo();

      this._onFilesChanged();
    };

    csvBtn.addEventListener('click', () => switchMode('csv'));
    apiBtn.addEventListener('click', () => switchMode('api'));

    // Persist values on change
    if (keyInput)  keyInput.addEventListener('input',  () => ClickUpIntegration.setApiKey(keyInput.value));
    if (listInput) listInput.addEventListener('input',  () => ClickUpIntegration.setListId(listInput.value));

    // Sync buttons
    if (syncBtn)  syncBtn.addEventListener('click',  () => this._syncClickUp(false));
    if (forceBtn) forceBtn.addEventListener('click', () => this._syncClickUp(true));

    // Show last sync info if already synced
    this._updateSyncInfo();

    // ── Auto-switch to API mode and sync on page load ─────────
    if (ClickUpIntegration.getApiKey() && ClickUpIntegration.getListId()) {
      switchMode('api');
      this._syncClickUp(false);
    }
  },

  async _syncClickUp(force = false) {
    if (this._syncing) return;
    const keyInput  = document.getElementById('cu-api-key');
    const listInput = document.getElementById('cu-list-id');
    const apiKey    = (keyInput?.value  || '').trim();
    const listId    = (listInput?.value || '').trim();

    if (!apiKey)  { this._setSyncStatus('error', 'Ingresa tu API token de ClickUp.'); return; }
    if (!listId)  { this._setSyncStatus('error', 'Ingresa el ID de la lista.'); return; }

    ClickUpIntegration.setApiKey(apiKey);
    ClickUpIntegration.setListId(listId);

    this._syncing = true;
    const syncBtn  = document.getElementById('cu-sync-btn');
    const forceBtn = document.getElementById('cu-force-btn');
    if (syncBtn)  { syncBtn.disabled  = true; syncBtn.textContent  = '⟳ Sincronizando…'; }
    if (forceBtn) { forceBtn.disabled = true; }
    this._setSyncStatus('loading', force ? 'Forzando sincronización…' : 'Conectando con ClickUp…');

    try {
      const result = await ClickUpIntegration.fetchParsedTasks(listId, {
        force,
        onProgress: msg => this._setSyncStatus('loading', msg),
      });
      this._cuApiData = result;
      this._onFilesChanged();

      // Build a status message that tells the user exactly what was found
      const n     = result.rawTasks.length;
      const fn    = result.fieldNames || {};
      const ok    = k => fn[k] ? '✓' : '✗';
      const rlbl  = esc(result.resolvedLabel || '');

      // 0 tasks — the ID resolved but the lists are empty
      if (n === 0) {
        const statusEl = document.getElementById('cu-sync-status');
        if (statusEl) {
          statusEl.innerHTML  = `⚠ 0 tareas encontradas (${rlbl}).`
            + `<br><small>Las listas encontradas no tienen tareas visibles con este token, `
            + `o el ID no corresponde a ningún espacio, carpeta ni lista de ClickUp. `
            + `Prueba copiando el ID directamente desde la URL de una lista (`
            + `termina en <code>/li/XXXXXXXX</code>).</small>`;
          statusEl.className  = 'cu-sync-status cu-sync-warn';
          statusEl.style.display = 'block';
        }
        return;
      }

      // "Critical" requires at least ONE drawing-tier field OR the envio field
      const hasAnyDate = fn.finDibujo || fn.envioAprobacion || fn.aprobado || fn.envio;
      const missingCritical = !hasAnyDate;
      const missingOp       = !fn.op;

      const cacheNote = result.fromCache
        ? ` <span style="color:var(--muted);font-weight:400">(caché · ${Math.round((ClickUpIntegration.cacheAge() || 0) / 60)} min)</span>`
        : '';

      let msg = `✓ ${n} tarea${n !== 1 ? 's' : ''} · ${rlbl}${cacheNote}`;
      msg += `<br><small style="color:var(--muted)">`;
      msg += `OP ${ok('op')} &nbsp; Nivel ${ok('nivel')} &nbsp; `
           + `Dibujo ${ok('finDibujo')} &nbsp; Aprobado ${ok('aprobado')} &nbsp; Envío fábrica ${ok('envio')}`;
      msg += `</small>`;

      if (missingCritical) {
        msg += `<br><small style="color:var(--below-text)">`;
        msg += `⚠ Ninguna fecha detectada — el reporte no mostrará ítems. `;
        msg += 'Verifica los nombres de los campos en ClickUp (ver consola del navegador para la lista completa).';
        msg += `</small>`;
      } else if (missingOp) {
        msg += `<br><small style="color:var(--warn)">⚠ "NO. OP" no detectado — los ítems no se cruzarán con el Registro.</small>`;
      }

      const statusEl = document.getElementById('cu-sync-status');
      if (statusEl) {
        statusEl.innerHTML  = msg;
        statusEl.className  = `cu-sync-status ${missingCritical ? 'cu-sync-warn' : 'cu-sync-ok'}`;
        statusEl.style.display = 'block';
      }
    } catch (err) {
      this._setSyncStatus('error', '✗ ' + err.message);
      console.error(err);
    } finally {
      this._syncing = false;
      if (syncBtn)  { syncBtn.disabled  = false; syncBtn.textContent  = '↻ Sincronizar'; }
      if (forceBtn) { forceBtn.disabled = false; }
    }
  },

  _updateSyncInfo() {
    const last  = ClickUpIntegration.lastSync();
    const count = ClickUpIntegration.lastCount();
    if (last && count > 0) {
      const when = last.toLocaleString('es', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
      });
      this._setSyncStatus('ok', `✓ ${count} tareas · ${when}`);
      // Re-use cached data if we don't have it in memory yet
      if (!this._cuApiData && this._sourceMode === 'api') {
        // No in-memory data yet — user needs to sync again after page reload
        this._setSyncStatus('idle', `Última sincronización: ${when} (${count} tareas). Sincroniza de nuevo para cargar.`);
      }
    } else if (this._sourceMode === 'api') {
      this._setSyncStatus('idle', 'Ingresa el ID de tu lista y haz clic en Sincronizar.');
    }
  },

  _setSyncStatus(type, msg) {
    const el = document.getElementById('cu-sync-status');
    if (!el) return;
    el.innerHTML     = esc(msg);   // esc because msg is plain text here
    el.className     = `cu-sync-status cu-sync-${type}`;
    el.style.display = msg ? 'block' : 'none';
  },

  // ── Month / year defaults ─────────────────────────────────

  _detectMonthYear() {
    const now = new Date();
    this._month = now.getMonth() + 1;
    this._year  = now.getFullYear();

    const selMonth = document.getElementById('sel-month');
    const inpYear  = document.getElementById('inp-year');
    if (selMonth) selMonth.value = String(this._month);
    if (inpYear)  inpYear.value  = String(this._year);

    if (selMonth) selMonth.addEventListener('change', () => {
      this._month = parseInt(selMonth.value, 10);
    });
    if (inpYear) inpYear.addEventListener('input', () => {
      this._year = parseInt(inpYear.value, 10) || this._year;
    });
  },

  // ── File upload binding ───────────────────────────────────

  _bindUpload() {
    this._bindDropZone('dz-cu',  'file-cu',  'dfname-cu',  'dfsize-cu',  'rm-cu', (rows, name, size) => {
      this._cuRows = rows;
      this._cuFile = name;
      this._onFilesChanged();
    }, () => {
      this._cuRows = null;
      this._cuFile = '';
      this._onFilesChanged();
    });

    this._bindDropZone('dz-reg', 'file-reg', 'dfname-reg', 'dfsize-reg', 'rm-reg', (rows, name, size) => {
      this._regRows = rows;
      this._regFile = name;
      this._onFilesChanged();
    }, () => {
      this._regRows = null;
      this._regFile = '';
      this._onFilesChanged();
    });

    const btn = document.getElementById('btn-generate');
    if (btn) btn.addEventListener('click', () => this._generate());
  },

  _bindDropZone(zoneId, inputId, fnameId, fsizeId, rmId, onLoad, onRemove) {
    const zone  = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const rm    = document.getElementById(rmId);
    if (!zone || !input) return;

    input.addEventListener('change', () => {
      if (input.files[0]) this._readFile(input.files[0], fnameId, fsizeId, zoneId, onLoad);
    });

    // Drag and drop
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f) this._readFile(f, fnameId, fsizeId, zoneId, onLoad);
    });

    // Remove button
    if (rm) rm.addEventListener('click', e => {
      e.stopPropagation();
      zone.classList.remove('loaded');
      input.value = '';
      const fn = document.getElementById(fnameId);
      const fs = document.getElementById(fsizeId);
      if (fn) fn.textContent = '';
      if (fs) fs.textContent = '';
      onRemove();
    });
  },

  _readFile(file, fnameId, fsizeId, zoneId, cb) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const rows = parseCSV(e.target.result);
        const zone = document.getElementById(zoneId);
        const fn   = document.getElementById(fnameId);
        const fs   = document.getElementById(fsizeId);
        if (zone) zone.classList.add('loaded');
        if (fn)   fn.textContent = file.name;
        if (fs)   fs.textContent = fmtBytes(file.size);
        cb(rows, file.name, file.size);
      } catch (err) {
        this._showError('Error al leer el archivo: ' + err.message);
      }
    };
    reader.onerror = () => this._showError('No se pudo leer el archivo.');
    reader.readAsText(file, 'UTF-8');
  },

  _showError(msg) {
    const banner = document.getElementById('error-banner');
    if (!banner) { alert(msg); return; }
    banner.textContent = msg;
    banner.style.display = 'block';
    setTimeout(() => { banner.style.display = 'none'; }, 5000);
  },

  // ── Mode detection & generate button state ────────────────

  _onFilesChanged() {
    // In API mode, treat a successful sync as "hasCU"
    const hasCU  = this._sourceMode === 'api' ? !!this._cuApiData : !!this._cuRows;
    const hasReg = !!this._regRows;
    const mode   = hasCU && hasReg ? 'B' : hasCU ? 'A' : hasReg ? 'C' : null;

    // Update mode badge
    const badge = document.getElementById('mode-badge');
    const text  = document.getElementById('mode-text');
    if (badge && text) {
      if (mode) {
        badge.classList.remove('hidden');
        badge.className = badge.className.replace(/\bmode-[abc]\b/g, '');
        badge.classList.add(`mode-${mode.toLowerCase()}`);
        const src = this._sourceMode === 'api' ? 'ClickUp API' : 'Solo ClickUp';
        const labels = {
          A: `Modo A · ${src}`,
          B: `Modo B · ${this._sourceMode === 'api' ? 'ClickUp API' : 'ClickUp'} + Fábrica`,
          C: 'Modo C · Solo Fábrica',
        };
        text.textContent = labels[mode];
      } else {
        badge.classList.add('hidden');
      }
    }

    // Enable/disable generate button
    const btn = document.getElementById('btn-generate');
    if (btn) btn.disabled = !mode;

    // Refresh schedule tab live if it's currently visible
    if (this._screen === 'schedule') {
      if (this._sourceMode === 'api' && this._cuApiData) {
        Schedule.renderFromAPI(this._cuApiData.rawTasks, this._cuApiData.fieldIds);
      } else {
        Schedule.render(this._cuRows);
      }
    }
  },

  _detectMode() {
    const hasCU = this._sourceMode === 'api' ? !!this._cuApiData : !!this._cuRows;
    if (hasCU   && this._regRows) return 'B';
    if (hasCU)                    return 'A';
    if (this._regRows)            return 'C';
    return null;
  },

  // ── Generate report ───────────────────────────────────────

  async _generate() {
    const mode  = this._detectMode();
    const month = parseInt(document.getElementById('sel-month')?.value || this._month, 10);
    const year  = parseInt(document.getElementById('inp-year')?.value  || this._year,  10);

    if (!mode)  { this._showError(this._sourceMode === 'api' ? 'Sincroniza con ClickUp primero.' : 'Carga al menos un archivo CSV.'); return; }
    if (!month || !year) { this._showError('Selecciona mes y año.'); return; }

    try {
      let cuTasks = [];
      if (mode !== 'C') {
        if (this._sourceMode === 'api' && this._cuApiData) {
          cuTasks = this._cuApiData.parsedTasks;
        } else if (this._cuRows) {
          cuTasks = parseCUCSV(this._cuRows);
        }
      }
      const regEntries    = (mode !== 'A' && this._regRows) ? parseRegCSV(this._regRows) : [];
      // Load all saved snapshots so the scoring engine can determine which
      // phase each item previously reached (incremental scoring model).
      const allSavedMonths = await Storage.loadAll();
      const report         = buildReport(mode, cuTasks, regEntries, month, year, allSavedMonths);

      Report.render(report, mode, this._cuFile, this._regFile);

      // Enable and switch to report screen
      const navReport = document.getElementById('nav-btn-report');
      if (navReport) navReport.disabled = false;
      this._showScreen('report');
    } catch (err) {
      this._showError('Error al generar el reporte: ' + err.message);
      console.error(err);
    }
  },

  // ── Report screen action buttons ──────────────────────────

  _bindReportActions() {
    const backBtn = document.getElementById('btn-back-upload');
    if (backBtn) backBtn.addEventListener('click', () => this._showScreen('upload'));

    const dashBtn = document.getElementById('btn-go-dashboard');
    if (dashBtn) dashBtn.addEventListener('click', () => this._showScreen('dashboard'));
  },

  // ── Saved months chips ────────────────────────────────────

  async refreshSavedMonths() {
    await Promise.all([
      this._refreshNavChips(),
      this._refreshUploadList(),
    ]);
  },

  async _refreshNavChips() {
    const container = document.getElementById('nav-saved');
    if (!container) return;
    const all = await Storage.loadAll();
    container.innerHTML = all.map(s => {
      const key = `${s.year}_${String(s.month).padStart(2,'0')}`;
      return `<button class="nav-saved-chip" data-key="${key}" title="Modo ${s.mode || 'A'}">${esc(monthLabel(s.month, s.year))}</button>`;
    }).join('');
    container.querySelectorAll('.nav-saved-chip').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [sy, sm] = btn.dataset.key.split('_').map(Number);
        const stored = await Storage.load(sy, sm);
        if (!stored) return;
        Report.renderFromStored(stored);
        const navReport = document.getElementById('nav-btn-report');
        if (navReport) navReport.disabled = false;
        this._showScreen('report');
      });
    });
  },

  async _refreshUploadList() {
    const panel = document.getElementById('saved-months-panel');
    if (!panel) return;
    const all = await Storage.loadAll();
    if (!all.length) {
      panel.classList.remove('visible');
      panel.innerHTML = '';
      return;
    }
    panel.classList.add('visible');
    panel.innerHTML = [...all].reverse().map(s => {
      const key   = `${s.year}_${String(s.month).padStart(2,'0')}`;
      const label = monthLabel(s.month, s.year);
      const saved = s.savedAt
        ? new Date(s.savedAt).toLocaleDateString('es', { day:'2-digit', month:'short', year:'numeric' })
        : '';
      return `<div class="saved-item">
        <div class="saved-item-info">
          <span class="saved-item-label">${esc(label)}</span>
          <span class="mode-badge mode-${(s.mode||'a').toLowerCase()}">${s.mode || 'A'}</span>
          ${saved ? `<span class="saved-item-date">Guardado ${esc(saved)}</span>` : ''}
        </div>
        <div class="saved-item-actions">
          <button class="btn-secondary btn-sm btn-load" data-key="${key}">Ver</button>
          <button class="btn-secondary btn-sm btn-del"  data-key="${key}">Eliminar</button>
        </div>
      </div>`;
    }).join('');

    panel.querySelectorAll('.btn-load').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [sy, sm] = btn.dataset.key.split('_').map(Number);
        const stored = await Storage.load(sy, sm);
        if (!stored) return;
        Report.renderFromStored(stored);
        const navReport = document.getElementById('nav-btn-report');
        if (navReport) navReport.disabled = false;
        this._showScreen('report');
      });
    });

    panel.querySelectorAll('.btn-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [sy, sm] = btn.dataset.key.split('_').map(Number);
        if (!confirm(`¿Eliminar el reporte de ${monthLabel(sm, sy)}?`)) return;
        await Storage.delete(sy, sm);
        await this.refreshSavedMonths();
      });
    });
  },
};

// ── Entry point ───────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
