// ─────────────────────────────────────────────────────────────
// js/storage.js — Firestore save / load / delete
//
// Depends on: config.js (storageKey, DESIGNER_COLORS)
//             firebase-config.js (db — Firestore instance)
// All methods return Promises.
// ─────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════
// PUBLIC API — all async
// ════════════════════════════════════════════════════════════

const Storage = {

  /**
   * Save a freshly-built in-memory report to Firestore.
   * Overwrites any existing snapshot for that month.
   * Returns the stored object.
   */
  async save(report, mode) {
    const stored = reportToStorage(report, mode);
    const key    = storageKey(stored.year, stored.month);
    try {
      await db.collection('reports').doc(key).set(stored);
    } catch (e) {
      throw new Error('No se pudo guardar el reporte: ' + e.message);
    }
    return stored;
  },

  /**
   * Load a single stored report by year + month.
   * Returns the object or null if not found.
   */
  async load(year, month) {
    try {
      const doc = await db.collection('reports').doc(storageKey(year, month)).get();
      return doc.exists ? doc.data() : null;
    } catch (e) {
      console.error('Storage.load error:', e);
      return null;
    }
  },

  /**
   * Return all saved reports sorted chronologically (oldest first).
   */
  async loadAll() {
    try {
      const snapshot = await db.collection('reports').get();
      return snapshot.docs
        .map(d => d.data())
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
    } catch (e) {
      console.error('Storage.loadAll error:', e);
      return [];
    }
  },

  /** Remove a stored report. No-op if it does not exist. */
  async delete(year, month) {
    try {
      await db.collection('reports').doc(storageKey(year, month)).delete();
    } catch (e) {
      console.error('Storage.delete error:', e);
    }
  },

  /** True if a snapshot exists for the given month/year. */
  async exists(year, month) {
    try {
      const doc = await db.collection('reports').doc(storageKey(year, month)).get();
      return doc.exists;
    } catch (e) {
      return false;
    }
  },
};

// ════════════════════════════════════════════════════════════
// CONVERSION: in-memory report → stored snapshot
// ════════════════════════════════════════════════════════════

/**
 * Convert the object returned by buildReport() into the flat
 * structure that gets persisted to localStorage.
 *
 * Stored shape:
 * {
 *   month, year, savedAt, mode,
 *   designers: {
 *     "Fabián P": {
 *       color, aprob[], prod[],
 *       totalAprob, totalProd, total,
 *       itemCount, projectCount, projects[]
 *     }, …
 *   },
 *   unassigned:   { aprob[], prod[] },
 *   teamMeanTotal, teamMeanAprob, teamMeanProd, maxTotal,
 *   validation:   { matched[], onlyFactory[], onlyClickup[] } | null
 * }
 */
function reportToStorage(report, mode) {
  const stored = {
    month:         report.month,
    year:          report.year,
    savedAt:       new Date().toISOString(),
    mode:          mode || report.mode || 'A',
    designers:     {},
    unassigned:    { drawing: [], approved: [], prod: [] },
    teamMeanTotal: report.metrics.mean,
    // new keys
    teamMeanDraw:  report.metrics.meanSrDraw !== undefined ? report.metrics.tDraw / (report.activeCount || 1) : 0,
    teamMeanApv:   report.metrics.tApv  !== undefined ? report.metrics.tApv  / (report.activeCount || 1) : 0,
    teamMeanProd:  report.metrics.meanPrd || 0,
    // aliases kept for historical dashboard backward compatibility
    teamMeanAprob: report.metrics.meanApr || 0,
    meanSrTotal:   report.metrics.meanSrTotal || 0,
    meanSrDraw:    report.metrics.meanSrDraw  || 0,
    meanSrApv:     report.metrics.meanSrApv   || 0,
    meanSrProd:    report.metrics.meanSrProd  || 0,
    meanSrAprob:   report.metrics.meanSrAprob || 0, // alias
    meanJrTotal:   report.metrics.meanJrTotal || 0,
    meanJrDraw:    report.metrics.meanJrDraw  || 0,
    meanJrApv:     report.metrics.meanJrApv   || 0,
    meanJrProd:    report.metrics.meanJrProd  || 0,
    meanJrAprob:   report.metrics.meanJrAprob || 0, // alias
    maxTotal:      report.maxTotal,
    validation:    null,
    uniqueItems:    report.metrics.uniqueItems    || 0,
    rawDraw:        report.metrics.rawDraw        || 0,
    rawApv:         report.metrics.rawApv         || 0,
    rawProd:        report.metrics.rawProd        || 0,
    rawApprob:      report.metrics.rawApprob      || 0, // alias
    avgCorrections: report.metrics.avgCorrections || 0,
    starProject:    report.metrics.starProject    || '',
    starPts:        report.metrics.starPts        || 0,
    topDesigner:    report.metrics.topDesigner    || null,
  };

  // Per-designer data
  for (const d of report.designers) {
    stored.designers[d.name] = {
      color:        d.color,
      // new 3-tier arrays
      drawing:      d.drawings.map(itemToStorage),
      approved:     d.approved.map(itemToStorage),
      prod:         d.productions.map(itemToStorage),
      // totals
      totalDraw:    d.dTotal,
      totalApv:     d.apvTotal,
      totalProd:    d.pTotal,
      total:        d.total,
      // alias for dashboard (Aprob column = drawing + approved)
      aprob:        [...d.drawings, ...d.approved].map(itemToStorage),
      totalAprob:   d.aTotal,
      itemCount:    d.itemCount,
      projectCount: d.projects.length,
      projects:     d.projects,
    };
  }

  // Unassigned items
  const ua = report.unassigned || {};
  stored.unassigned = {
    drawing:  (ua.drawings   || []).map(itemToStorage),
    approved: (ua.approved   || []).map(itemToStorage),
    prod:     (ua.productions || []).map(itemToStorage),
    // alias
    aprob:    [...(ua.drawings || []), ...(ua.approved || [])].map(itemToStorage),
  };

  // Validation summary (Mode B)
  if (report.validation) {
    const v = report.validation;
    stored.validation = {
      matched: v.coinciden.map(e => e.rawOP),
      onlyFactory: v.soloFabrica.map(e => ({
        rawOP:       e.rawOP,
        descripcion: e.descripcion || '',
        designer:    e.designer    || '',
      })),
      onlyClickup: v.soloClickUp.map(t => ({
        op:   t.op   || '',
        name: t.name || '',
      })),
    };
  }

  return stored;
}

/**
 * Flatten a single item from the in-memory format to the stored format.
 *
 * Stored item shape:
 * { op, name, project, nivel, pts, date, src, fromReg, fromRegOnly, unconfirmed }
 */
function itemToStorage(item) {
  return {
    op:          item.op          || '',
    name:        item.name        || '',
    project:     item.parent      || '',
    nivel:       item.level       != null ? item.level : null,
    pts:         item.score       || 0,
    date:        item.date        || null,
    src:         item.fromRegOnly ? 'excel' : 'clickup',
    fromReg:     item.fromReg     || false,
    fromRegOnly: item.fromRegOnly || false,
    unconfirmed: item.unconfirmed || false,
    corrections: item.corrections || 0,
  };
}

// ════════════════════════════════════════════════════════════
// CONVERSION: stored snapshot → render-ready report
// ════════════════════════════════════════════════════════════

/**
 * Convert a stored snapshot (loaded from localStorage) back into
 * the same shape that buildReport() produces, so report.js can
 * render it without any special-case code.
 */
function storedToRender(stored) {
  const designers = [];

  for (const [name, d] of Object.entries(stored.designers || {})) {
    // Support both new format (drawing/approved keys) and old format (aprob only)
    const drawings    = (d.drawing  || []).map(storedItemToRender);
    const approved    = (d.approved || []).map(storedItemToRender);
    const productions = (d.prod     || []).map(storedItemToRender);

    // Old snapshots only have aprob[] — fall back to it as drawings
    const drawingsFinal = drawings.length ? drawings : (d.aprob || []).map(storedItemToRender);

    const dTotal   = d.totalDraw  || 0;
    const apvTotal = d.totalApv   || 0;
    const pTotal   = d.totalProd  || 0;
    const aTotal   = d.totalAprob != null ? d.totalAprob : parseFloat((dTotal + apvTotal).toFixed(2));

    designers.push({
      name,
      color:       d.color || DESIGNER_COLORS[name] || '#888888',
      drawings:    drawingsFinal,
      approved,
      productions,
      dTotal,
      apvTotal,
      pTotal,
      aTotal,
      total:       d.total || 0,
      // aliases for dashboard
      approvals:   drawingsFinal,
      projects:    d.projects   || [],
      itemCount:   d.itemCount  || 0,
    });
  }
  designers.sort((a, b) => b.total - a.total);

  const n     = designers.length || 1;
  const tPts  = parseFloat((designers.reduce((s, d) => s + d.total,    0)).toFixed(2));
  const tDraw = parseFloat((designers.reduce((s, d) => s + d.dTotal,   0)).toFixed(2));
  const tApv  = parseFloat((designers.reduce((s, d) => s + d.apvTotal, 0)).toFixed(2));
  const tPrd  = parseFloat((designers.reduce((s, d) => s + d.pTotal,   0)).toFixed(2));
  const tApr  = parseFloat((tDraw + tApv).toFixed(2));

  const ua = stored.unassigned || {};

  return {
    mode:   stored.mode  || 'A',
    month:  stored.month,
    year:   stored.year,
    designers,
    unassigned: {
      drawings:    (ua.drawing  || ua.aprob || []).map(storedItemToRender),
      approved:    (ua.approved || []).map(storedItemToRender),
      productions: (ua.prod     || []).map(storedItemToRender),
      approvals:   (ua.drawing  || ua.aprob || []).map(storedItemToRender), // alias
    },
    validation:  storedValidationToDisplay(stored.validation),
    metrics: {
      tPts, tDraw, tApv, tPrd, tApr,
      mean:           stored.teamMeanTotal  || (tPts / n),
      meanApr:        stored.teamMeanAprob  || (tApr / n),
      meanPrd:        stored.teamMeanProd   || (tPrd / n),
      meanSrTotal:    stored.meanSrTotal    || 0,
      meanSrDraw:     stored.meanSrDraw     || stored.meanSrAprob || 0,
      meanSrApv:      stored.meanSrApv      || 0,
      meanSrProd:     stored.meanSrProd     || 0,
      meanSrAprob:    stored.meanSrAprob    || 0,
      meanJrTotal:    stored.meanJrTotal    || 0,
      meanJrDraw:     stored.meanJrDraw     || stored.meanJrAprob || 0,
      meanJrApv:      stored.meanJrApv      || 0,
      meanJrProd:     stored.meanJrProd     || 0,
      meanJrAprob:    stored.meanJrAprob    || 0,
      uniqueItems:    stored.uniqueItems    || 0,
      rawDraw:        stored.rawDraw        || stored.rawApprob || 0,
      rawApv:         stored.rawApv         || 0,
      rawProd:        stored.rawProd        || 0,
      rawApprob:      stored.rawApprob      || 0,
      avgCorrections: stored.avgCorrections || 0,
      starProject:    stored.starProject    || '',
      starPts:        stored.starPts        || 0,
      topDesigner:    stored.topDesigner    || null,
    },
    maxTotal:    stored.maxTotal || (designers.length ? designers[0].total : 1),
    activeCount: designers.length,
  };
}

/** Convert a stored item back to the shape report.js expects. */
function storedItemToRender(item) {
  return {
    name:        item.name        || '',
    parent:      item.project     || '',
    op:          item.op          || '',
    level:       item.nivel       != null ? item.nivel : null,
    score:       item.pts         || 0,
    date:        item.date        || null,
    hasLevel:    item.nivel       != null,
    fromReg:     item.fromReg     || false,
    fromRegOnly: item.fromRegOnly || false,
    unconfirmed: item.unconfirmed || false,
    corrections: item.corrections || 0,
  };
}

/**
 * Turn the stored validation summary into a display-ready structure
 * for the validation panel in report.js.
 * Returns null if there is no validation data.
 */
function storedValidationToDisplay(v) {
  if (!v) return null;
  return {
    // These are display-only — report.js treats them as string lists
    coinciden:   (v.matched      || []).map(rawOP => ({ rawOP, descripcion: '', designer: '' })),
    soloFabrica: (v.onlyFactory  || []).map(e     => ({ rawOP: e.rawOP, descripcion: e.descripcion || '', designer: e.designer || '' })),
    soloClickUp: (v.onlyClickup  || []).map(t     => ({ op: t.op, name: t.name, assignee: '' })),
  };
}
