// ─────────────────────────────────────────────────────────────
// js/clickup.js — ClickUp API integration
//
// Accepts any ClickUp ID (List / Folder / Space).
// If the entered ID resolves to an empty list, automatically
// traverses up to its parent folder or space to find the
// actual task lists.
//
// Performance fixes applied:
//   1. Parallel pagination  — page 0 first, then pages 1–4 in parallel
//   2. fields= param        — request only fields the app uses
//   3. Smart cache (5 min)  — localStorage cache with force-refresh
//   4. onProgress callback  — live status updates during fetch
//
// Depends on: config.js (normStr)
//             parser.js  (parseClickUpAPI)
// ─────────────────────────────────────────────────────────────

const ClickUpIntegration = {

  _API_KEY_KEY:    'cu_api_key',
  _SYNC_TIME_KEY:  'cu_last_sync',
  _SYNC_COUNT_KEY: 'cu_last_count',
  _LIST_ID_KEY:    'cu_list_id',
  _CACHE_KEY:      'cu_tasks_cache',
  _CACHE_TTL:      30 * 60 * 1000,  // 30 minutes in ms

  getApiKey()   { return localStorage.getItem(this._API_KEY_KEY) || ''; },
  setApiKey(k)  { localStorage.setItem(this._API_KEY_KEY, String(k).trim()); },
  getListId()   { return localStorage.getItem(this._LIST_ID_KEY) || ''; },
  setListId(id) { localStorage.setItem(this._LIST_ID_KEY, String(id).trim()); },

  lastSync() {
    const t = localStorage.getItem(this._SYNC_TIME_KEY);
    return t ? new Date(t) : null;
  },
  lastCount() {
    return parseInt(localStorage.getItem(this._SYNC_COUNT_KEY) || '0', 10);
  },

  // ── Fix 3 — Cache helpers ──────────────────────────────────

  _getCache() {
    try {
      const raw = localStorage.getItem(this._CACHE_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || !c.timestamp || !Array.isArray(c.tasks)) return null;
      return c;
    } catch (_) { return null; }
  },

  _setCache(data) {
    // ── Slim the tasks before caching ─────────────────────────
    // A full rawTask contains ~41 custom fields per task (~4-5 MB for 1800+
    // tasks), which exceeds the localStorage 5 MB quota.
    // We strip every custom field EXCEPT the 6-7 fieldIds the app actually
    // uses, reducing the payload to ~300-500 KB regardless of list size.
    const relevantIds = new Set(Object.values(data.fieldIds || {}).filter(Boolean));
    const slimTasks   = (data.rawTasks || []).map(t => ({
      id:           t.id,
      name:         t.name,
      status:       t.status,
      parent:       t.parent,
      assignees:    (t.assignees || []).map(a => ({ username: a.username || a.name || '' })),
      list:         t.list   ? { id: t.list.id,   name: t.list.name }   : undefined,
      folder:       t.folder ? { id: t.folder.id, name: t.folder.name } : undefined,
      custom_fields: (t.custom_fields || []).filter(cf => relevantIds.has(cf.id)),
    }));

    try {
      localStorage.setItem(this._CACHE_KEY, JSON.stringify({
        timestamp:     Date.now(),
        tasks:         slimTasks,
        fieldIds:      data.fieldIds,
        fieldNames:    data.fieldNames,
        resolvedLabel: data.resolvedLabel,
      }));
      console.info(`[ClickUp] Cached ${slimTasks.length} tasks (slim).`);
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        console.warn(`[ClickUp] Cache still too large after slimming (${slimTasks.length} tasks). Syncing live every time.`);
      } else {
        console.warn('[ClickUp] Cache write failed:', e.message);
      }
      try { localStorage.removeItem(this._CACHE_KEY); } catch (_) {}
    }
  },

  clearCache() {
    localStorage.removeItem(this._CACHE_KEY);
  },

  isCacheFresh() {
    const c = this._getCache();
    return c ? (Date.now() - c.timestamp < this._CACHE_TTL) : false;
  },

  /** Returns the cache age in seconds, or null if no cache. */
  cacheAge() {
    const c = this._getCache();
    return c ? Math.round((Date.now() - c.timestamp) / 1000) : null;
  },

  // ── Main entry point ───────────────────────────────────────

  /**
   * Fetch and parse tasks for the given ClickUp ID.
   *
   * @param {string}   id
   * @param {object}   [opts]
   * @param {boolean}  [opts.force=false]   — bypass cache, always hit the API
   * @param {function} [opts.onProgress]    — called with a status string at each stage
   */
  async fetchParsedTasks(id, { force = false, onProgress } = {}) {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('Ingresa tu API token de ClickUp antes de sincronizar.');

    const prog = msg => { if (onProgress) onProgress(msg); };

    // ── Fix 3 — Cache hit ──────────────────────────────────────
    if (!force) {
      const cached = this._getCache();
      if (cached && (Date.now() - cached.timestamp < this._CACHE_TTL)) {
        const ageS   = Math.round((Date.now() - cached.timestamp) / 1000);
        const ageTxt = ageS < 60 ? `${ageS}s` : `${Math.round(ageS / 60)} min`;
        console.info('[ClickUp] Cache hit —', cached.tasks.length, 'tasks, age', ageTxt);
        prog(`⚡ Cargando desde caché (${cached.tasks.length} tareas, hace ${ageTxt})…`);
        const parsedTasks = parseClickUpAPI(cached.tasks, cached.fieldIds || {});
        return {
          rawTasks:      cached.tasks,
          fieldIds:      cached.fieldIds   || {},
          fieldNames:    cached.fieldNames || {},
          parsedTasks,
          resolvedLabel: cached.resolvedLabel || '',
          fromCache:     true,
          cacheAgeSec:   ageS,
        };
      }
    }

    // ── Step 1 — Resolve the entered ID ───────────────────────
    prog('Resolviendo ID de ClickUp…');
    let { listIds, label } = await this._resolveToListIds(id);

    // ── Step 2 — Fetch tasks (with progress) ──────────────────
    prog('Cargando tareas… (0)');
    let fetched = 0;
    const progressCb = n => {
      fetched += n;
      prog(`Cargando tareas… (${fetched} hasta ahora)`);
    };
    let rawTasks = await this._fetchFromLists(listIds, progressCb);

    // ── Step 3 — Traverse parent if the list was empty ────────
    if (rawTasks.length === 0 && listIds.length === 1) {
      const parent = await this._resolveParentOf(id);
      if (parent) {
        listIds  = parent.listIds;
        label    = parent.label;
        fetched  = 0;
        rawTasks = await this._fetchFromLists(listIds, progressCb);
      }
    }

    // ── Step 4 — Detect custom fields + parse ─────────────────
    prog(`Detectando campos… (${rawTasks.length} tareas)`);
    const detection   = await this._detectFields(listIds[0]);
    const parsedTasks = parseClickUpAPI(rawTasks, detection.ids);

    localStorage.setItem(this._SYNC_TIME_KEY,  new Date().toISOString());
    localStorage.setItem(this._SYNC_COUNT_KEY, String(rawTasks.length));

    const result = {
      rawTasks,
      fieldIds:      detection.ids,
      fieldNames:    detection.names,
      parsedTasks,
      resolvedLabel: label,
    };
    this._setCache(result);  // Fix 3 — persist for next load

    return result;
  },

  // ── ID resolution ──────────────────────────────────────────

  /**
   * Try the ID as List, Folder, and Space simultaneously.
   * Priority: Space > Folder > List  (most comprehensive wins).
   */
  async _resolveToListIds(id) {
    const [listRes, folderRes, spaceFolderRes, spaceListRes] = await Promise.allSettled([
      this._call(`list/${id}`),
      this._call(`folder/${id}/list`,  { archived: 'false' }),
      this._call(`space/${id}/folder`, { archived: 'false' }),
      this._call(`space/${id}/list`,   { archived: 'false' }),
    ]);

    // ── Space? ───────────────────────────────────────────────
    const spaceFolders = spaceFolderRes.status === 'fulfilled' ? (spaceFolderRes.value.folders || []) : [];
    const spaceRoots   = spaceListRes.status   === 'fulfilled' ? (spaceListRes.value.lists     || []) : [];

    if (spaceFolders.length || spaceRoots.length) {
      const nested = (await Promise.all(
        spaceFolders.map(f =>
          this._call(`folder/${f.id}/list`, { archived: 'false' })
            .then(d => (d.lists || []).map(l => l.id))
            .catch(() => [])
        )
      )).flat();
      const listIds = [...new Set([...nested, ...spaceRoots.map(l => l.id)])];
      return {
        listIds,
        label: `espacio · ${listIds.length} lista${listIds.length !== 1 ? 's' : ''}`,
      };
    }

    // ── Folder? ──────────────────────────────────────────────
    const folderLists = folderRes.status === 'fulfilled' ? (folderRes.value.lists || []) : [];
    if (folderLists.length) {
      return {
        listIds: folderLists.map(l => l.id),
        label:   `carpeta · ${folderLists.length} lista${folderLists.length !== 1 ? 's' : ''}`,
      };
    }

    // ── List ─────────────────────────────────────────────────
    if (listRes.status === 'fulfilled' && listRes.value.id) {
      return { listIds: [id], label: `lista "${listRes.value.name || id}"` };
    }

    // Fallback
    return { listIds: [id], label: `ID ${id}` };
  },

  /**
   * When the entered ID is a list that returned 0 tasks, look UP:
   * try its parent folder, then its parent space.
   * Returns { listIds, label } or null if nothing found.
   */
  async _resolveParentOf(listId) {
    let listInfo;
    try {
      listInfo = await this._call(`list/${listId}`);
      if (!listInfo?.id) return null;
    } catch (_) { return null; }

    // ── Try parent folder first (more specific) ───────────────
    const folderId    = listInfo.folder?.id;
    const folderHidden = listInfo.folder?.hidden;
    if (folderId && !folderHidden) {
      try {
        const data  = await this._call(`folder/${folderId}/list`, { archived: 'false' });
        const lists = data.lists || [];
        if (lists.length > 0) {
          return {
            listIds: lists.map(l => l.id),
            label:   `carpeta "${listInfo.folder.name}" · ${lists.length} lista${lists.length !== 1 ? 's' : ''}`,
          };
        }
      } catch (_) {}
    }

    // ── Try parent space ─────────────────────────────────────
    const spaceId   = listInfo.space?.id;
    const spaceName = listInfo.space?.name || spaceId;
    if (spaceId) {
      try {
        const [foldersRes, rootRes] = await Promise.allSettled([
          this._call(`space/${spaceId}/folder`, { archived: 'false' }),
          this._call(`space/${spaceId}/list`,   { archived: 'false' }),
        ]);
        const folders   = foldersRes.status === 'fulfilled' ? (foldersRes.value.folders || []) : [];
        const rootLists = rootRes.status    === 'fulfilled' ? (rootRes.value.lists      || []) : [];

        const nested = (await Promise.all(
          folders.map(f =>
            this._call(`folder/${f.id}/list`, { archived: 'false' })
              .then(d => (d.lists || []).map(l => l.id))
              .catch(() => [])
          )
        )).flat();

        const allIds = [...new Set([...nested, ...rootLists.map(l => l.id)])];
        if (allIds.length > 0) {
          return {
            listIds: allIds,
            label:   `espacio "${spaceName}" · ${allIds.length} lista${allIds.length !== 1 ? 's' : ''}`,
          };
        }
      } catch (_) {}
    }

    return null;
  },

  // ── Task fetching ──────────────────────────────────────────

  /** Fetch tasks from multiple lists, deduplicated by task ID. */
  async _fetchFromLists(listIds, onProgress) {
    const batches = await Promise.all(
      listIds.map(lid => this._fetchAllPagesFromList(lid, onProgress))
    );
    const seen = new Set();
    return batches.flat().filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  },

  /**
   * Full pagination — fetches every page until ClickUp signals last_page.
   *
   * Strategy: fetch page 0, then pages 1-N sequentially until
   * last_page === true or the batch is shorter than 100 items.
   * No hard page cap — all tasks are returned regardless of list size.
   *
   * NOTE: Do NOT add a `fields=` parameter here. ClickUp API v2 does not
   * support a generic system-field selector on the task list endpoint; passing
   * unknown query params can silently omit tasks in certain statuses.
   * Status filtering is handled downstream by the scoring engine (date-based),
   * NOT at the API level.
   */
  async _fetchAllPagesFromList(listId, onProgress) {
    const baseParams = {
      include_closed: 'true',
      subtasks:       'true',
    };

    const allTasks = [];
    let page = 0;

    while (true) {
      const data  = await this._call(`list/${listId}/task`, { ...baseParams, page });
      const batch = data.tasks || [];

      if (batch.length > 0) {
        allTasks.push(...batch);
        if (onProgress) onProgress(batch.length);
      }

      // ClickUp sets last_page:true on the final page; also stop if the
      // batch is under 100 (means there are no more full pages).
      if (data.last_page || batch.length < 100) break;

      page++;
    }

    return allTasks;
  },

  // ── Field detection ────────────────────────────────────────

  async _detectFields(listId) {
    let fields = [];
    try {
      const data = await this._call(`list/${listId}/field`);
      fields = data.fields || [];
    } catch (e) {
      console.warn('[ClickUp] Field detection failed:', e.message);
    }

    const find = (...keywords) => {
      for (const kw of keywords) {
        const n = normStr(kw);
        const f = fields.find(f => normStr(f.name) === n)
               || fields.find(f => normStr(f.name).includes(n));
        if (f) return { id: f.id, name: f.name };
      }
      return null;
    };

    // Detect OP in two passes: prefer the short_text "NO. OP" field; fall back
    // to the numeric "OP" field. Some tasks have one, some have the other.
    const findExact = name => {
      const n = normStr(name);
      const f = fields.find(f => normStr(f.name) === n);
      return f ? { id: f.id, name: f.name } : null;
    };
    const op    = findExact('no. op') || findExact('no.op') || find('numero de op', 'no op');
    const opAlt = findExact('op');   // numeric "OP" field — fallback if NO. OP is empty
    const nivel           = find('nivel');
    const finDibujo       = find('fin de dibujo de aprobacion', 'fin de dibujo', 'fin dibujo');
    const aprobado        = find('aprobado', 'fecha aprobado', 'fecha de aprobado', 'fecha aprobacion');
    const envioAprobacion = find('envio a aprobacion', 'envio aprobacion', 'fecha envio aprobacion');
    const envio           = find('envio a fabrica', 'envio fabrica', 'fecha envio', 'fecha de envio', 'envio', 'fabrica');
    const corrections     = find('no. de correcciones', 'numero de correcciones', 'correcciones');

    console.info('[ClickUp] %d fields available. Detected:', fields.length);
    console.table({
      op:              op?.name              || '— NOT FOUND',
      nivel:           nivel?.name           || '— NOT FOUND',
      finDibujo:       finDibujo?.name       || '— NOT FOUND',
      aprobado:        aprobado?.name        || '— NOT FOUND',
      envioAprobacion: envioAprobacion?.name || '— NOT FOUND',
      envio:           envio?.name           || '— NOT FOUND',
      corrections:     corrections?.name     || '— NOT FOUND',
    });
    if (fields.length) {
      console.info('[ClickUp] All fields:', fields.map(f => `"${f.name}" (${f.type})`).join(', '));
    }

    return {
      ids: {
        op:              op?.id              || null,
        opAlt:           opAlt?.id           || null,   // numeric "OP" fallback
        nivel:           nivel?.id           || null,
        finDibujo:       finDibujo?.id       || null,
        aprobado:        aprobado?.id        || null,
        envioAprobacion: envioAprobacion?.id || null,
        envio:           envio?.id           || null,
        corrections:     corrections?.id     || null,
      },
      names: {
        op:              op?.name              || null,
        opAlt:           opAlt?.name          || null,
        nivel:           nivel?.name           || null,
        finDibujo:       finDibujo?.name       || null,
        aprobado:        aprobado?.name        || null,
        envioAprobacion: envioAprobacion?.name || null,
        envio:           envio?.name           || null,
        corrections:     corrections?.name     || null,
      },
    };
  },

  // ── Low-level fetch ────────────────────────────────────────

  async _call(cuPath, qp = {}) {
    const apiKey = this.getApiKey();
    const qs     = Object.keys(qp).length ? '?' + new URLSearchParams(qp).toString() : '';
    const resp   = await fetch(`https://api.clickup.com/api/v2/${cuPath}${qs}`, {
      headers: { Authorization: apiKey },
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.err || data?.error || `HTTP ${resp.status}`);
    return data;
  },
};
