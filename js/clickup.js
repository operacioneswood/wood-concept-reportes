// ─────────────────────────────────────────────────────────────
// js/clickup.js — ClickUp API integration
//
// Accepts any ClickUp ID (List / Folder / Space).
// If the entered ID resolves to an empty list, automatically
// traverses up to its parent folder or space to find the
// actual task lists.
//
// Depends on: config.js (normStr)
//             parser.js  (parseClickUpAPI)
// ─────────────────────────────────────────────────────────────

const ClickUpIntegration = {

  _API_KEY_KEY:   'cu_api_key',
  _SYNC_TIME_KEY: 'cu_last_sync',
  _SYNC_COUNT_KEY:'cu_last_count',
  _LIST_ID_KEY:   'cu_list_id',

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

  // ── Main entry point ───────────────────────────────────────

  async fetchParsedTasks(id) {
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error('Ingresa tu API token de ClickUp antes de sincronizar.');

    // Step 1 — resolve the entered ID to concrete list IDs
    let { listIds, label } = await this._resolveToListIds(id);

    // Step 2 — fetch tasks from those lists
    let rawTasks = await this._fetchFromLists(listIds);

    // Step 3 — if the list was empty, traverse up to the parent folder/space
    //          (e.g. "DISEÑO" is an empty list inside the Diseño space)
    if (rawTasks.length === 0 && listIds.length === 1) {
      const parent = await this._resolveParentOf(id);
      if (parent) {
        listIds  = parent.listIds;
        label    = parent.label;
        rawTasks = await this._fetchFromLists(listIds);
      }
    }

    // Step 4 — detect custom fields + parse
    const detection   = await this._detectFields(listIds[0]);
    const parsedTasks = parseClickUpAPI(rawTasks, detection.ids);

    localStorage.setItem(this._SYNC_TIME_KEY,  new Date().toISOString());
    localStorage.setItem(this._SYNC_COUNT_KEY, String(rawTasks.length));

    return {
      rawTasks,
      fieldIds:      detection.ids,
      fieldNames:    detection.names,
      parsedTasks,
      resolvedLabel: label,
    };
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
    const folderId = listInfo.folder?.id;
    const folderHidden = listInfo.folder?.hidden;   // hidden = "no folder" pseudo-container
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
  async _fetchFromLists(listIds) {
    const batches = await Promise.all(listIds.map(lid => this._fetchAllPagesFromList(lid)));
    const seen    = new Set();
    return batches.flat().filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  },

  /** Fetch all pages of tasks from a single List ID. */
  async _fetchAllPagesFromList(listId) {
    const tasks = [];
    let   page  = 0;
    while (true) {
      const data  = await this._call(`list/${listId}/task`, {
        page,
        include_closed: 'true',
        subtasks:       'true',
      });
      const batch = data.tasks || [];
      tasks.push(...batch);
      if (data.last_page || batch.length < 100) break;
      page++;
    }
    return tasks;
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

    const op              = find('no. op', 'no.op', 'numero de op', 'no op', 'op');
    const nivel           = find('nivel');
    // finDibujo: keep specific — 'aprobacion' alone removed to avoid clashing with the new aprobado field
    const finDibujo       = find('fin de dibujo de aprobacion', 'fin de dibujo', 'fin dibujo');
    // aprobado: the separate "approved" date field (tier 2)
    const aprobado        = find('aprobado', 'fecha aprobado', 'fecha de aprobado', 'fecha aprobacion');
    // envioAprobacion: "sent for approval" date — also maps to the drawing/dibujo tier
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
        nivel:           nivel?.id           || null,
        finDibujo:       finDibujo?.id       || null,
        aprobado:        aprobado?.id        || null,
        envioAprobacion: envioAprobacion?.id || null,
        envio:           envio?.id           || null,
        corrections:     corrections?.id     || null,
      },
      names: {
        op:              op?.name              || null,
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
