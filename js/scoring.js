// ─────────────────────────────────────────────────────────────
// js/scoring.js — Scoring logic, cross-validation, report build
//
// Scoring model: cumulative phase percentages.
//   Each item has a base value = nivel.
//   Only the incremental % gained THIS month is scored.
//   Previous phase history is looked up from Firestore snapshots.
//
// Phase percentages (cumulative):
//   dibujo     → 50%  (fin de dibujo de aprobación date in month)
//   aprobado   → 60%  (aprobado date in month)
//   produccion → 100% (envío a fábrica date in month)
//
// Incremental pts = nivel × (thisPhasePct − prevHighestPct)
//
// Depends on: config.js, parser.js
// ─────────────────────────────────────────────────────────────

const PHASE_PCT = {
  dibujo:     0.50,
  aprobado:   0.60,
  produccion: 1.00,
};
const PHASE_RANK = { dibujo: 1, aprobado: 2, produccion: 3 };

/**
 * Build a complete in-memory report object from parsed CSV/API data.
 *
 * @param {string}   mode           'A' | 'B' | 'C'
 * @param {object[]} cuTasks        Output of parseCUCSV() / parseClickUpAPI()
 * @param {object[]} regEntries     Output of parseRegCSV()
 * @param {number}   month          1–12
 * @param {number}   year           e.g. 2026
 * @param {object[]} allSavedMonths All Firestore snapshots (from Storage.loadAll()).
 *                                  Used to detect which phase an item previously reached.
 *                                  Defaults to [] (first-ever month → no history).
 * @returns {object} Report object consumed by report.js / storage.js
 */
function buildReport(mode, cuTasks, regEntries, month, year, allSavedMonths = []) {

  // ── 1. OP → Registro entry lookup ───────────────────────
  const regMap = new Map();
  for (const e of regEntries) {
    const d         = parseRegDate(e.entradaRaw, year);
    const isInMonth = d && d.getMonth() + 1 === month && d.getFullYear() === year;
    for (const op of e.ops) {
      if (!regMap.has(op) || isInMonth) regMap.set(op, e);
    }
  }

  // ── 2. Cross-validation sets (Mode B only) ──────────────
  let coinciden      = [];
  let soloFabrica    = [];
  let soloClickUp    = [];
  let unconfirmedOPs = new Set();

  if (mode === 'B') {
    const regInMonth = regEntries.filter(e => {
      const d = parseRegDate(e.entradaRaw, year);
      return d && d.getMonth() + 1 === month && d.getFullYear() === year;
    });
    const cuProdInMonth = cuTasks.filter(t => {
      const d = parseCUDate(t.envio);
      return d && d.getMonth() + 1 === month && d.getFullYear() === year;
    });
    const cuProdOPSet = new Set(cuProdInMonth.map(t => t.op).filter(Boolean));
    const regOPSet    = new Set();
    for (const e of regInMonth) for (const op of e.ops) regOPSet.add(op);

    for (const e of regInMonth) {
      if (e.ops.some(op => cuProdOPSet.has(op))) coinciden.push(e);
      else                                         soloFabrica.push(e);
    }
    for (const t of cuProdInMonth) {
      if (!t.op || !regOPSet.has(t.op)) {
        unconfirmedOPs.add(t.op || '__noOP_' + t.name);
        soloClickUp.push(t);
      }
    }
  }

  // ── Helper: is a Date in the selected month? ────────────
  const inMonth = d => d && d.getMonth() + 1 === month && d.getFullYear() === year;

  // ── Helper: look up the highest phase this OP previously reached ──
  // Searches all saved snapshots for months BEFORE the current one.
  // Returns { phase: 'dibujo'|'aprobado'|'produccion'|null, monthLabel: string|null }
  function getHighestPhaseInPrev(op) {
    if (!op) return { phase: null, monthLabel: null };

    let highest = null, highestLabel = null;

    for (const snap of allSavedMonths) {
      // Skip current month and future months
      if (snap.year > year || (snap.year === year && snap.month >= month)) continue;

      for (const designer of Object.values(snap.designers || {})) {
        // array → implied phase (for snapshots saved before this new schema)
        const checkArr = (arr, impliedPhase) => {
          for (const item of (arr || [])) {
            if (!item.op || item.op !== op) continue;
            const ph = item.phase || impliedPhase;
            if (!highest || PHASE_RANK[ph] > PHASE_RANK[highest]) {
              highest      = ph;
              highestLabel = MONTH_NAMES[snap.month] + ' ' + snap.year;
            }
          }
        };
        checkArr(designer.drawing,  'dibujo');
        checkArr(designer.approved, 'aprobado');
        checkArr(designer.prod,     'produccion');
      }
    }

    return { phase: highest, monthLabel: highestLabel };
  }

  // ── Helper: score one item for this month ────────────────
  // Returns { pts, pct, prevPhase, prevMonthLabel } or null if no new progress.
  function scoreForMonth(nivel, thisMonthPhase, op) {
    const { phase: prevPhase, monthLabel: prevMonthLabel } = getHighestPhaseInPrev(op);
    const prevPct = PHASE_PCT[prevPhase] || 0;
    const thisPct = PHASE_PCT[thisMonthPhase];
    if (thisPct <= prevPct) return null;                         // already reached or surpassed
    const pct = parseFloat((thisPct - prevPct).toFixed(4));
    const pts = nivel !== null ? parseFloat((nivel * pct).toFixed(2)) : 0;
    return { pts, pct, prevPhase, prevMonthLabel };
  }

  // ── 3. Designer buckets ──────────────────────────────────
  const dMap   = new Map();
  const unasgn = { drawings: [], approved: [], productions: [], usedOPs: new Set() };

  function getBucket(name) {
    if (!dMap.has(name))
      dMap.set(name, { drawings: [], approved: [], productions: [], usedOPs: new Set() });
    return dMap.get(name);
  }

  // ── Build a canonical item object ────────────────────────
  function makeItem(fields) {
    const { name, parent, op, level, fromReg, hasLevel,
            pts, phase, pct, prevPhase, prevMonthLabel,
            date, unconfirmed, fromRegOnly, corrections } = fields;
    return {
      name, parent, op, level, fromReg, hasLevel,
      score:         pts,
      date:          date || null,
      phase,                            // 'dibujo' | 'aprobado' | 'produccion'
      pct,                              // incremental fraction scored this month
      prevPhase,                        // null | 'dibujo' | 'aprobado' | 'produccion'
      prevMonthLabel,                   // e.g. "Abril 2026" or null
      tier:          phase,             // backward-compat alias
      unconfirmed:   unconfirmed || false,
      fromRegOnly:   fromRegOnly || false,
      corrections:   corrections  || 0,
    };
  }

  // ── 4a. ClickUp tasks (Mode A + B) ──────────────────────
  if (mode !== 'C') {
    for (const t of cuTasks) {
      const reg = t.op ? regMap.get(t.op) : null;

      // Level: ClickUp first, Registro fallback in Mode B
      let level   = t.nivel;
      let fromReg = false;
      if (level === null && mode === 'B' && reg && reg.nivel !== null) {
        level   = reg.nivel;
        fromReg = true;
      }

      // Assignee → primary designer
      const designersList  = mapDesignersCU(t.assignee);
      if (!designersList.length && t.assignee && t.assignee.trim()) continue;
      const primaryDesigner = designersList[0] || null;

      // Date fields
      const dEnv = parseCUDate(t.envio);
      const dApv = parseCUDate(t.aprobado);
      const dFin = parseCUDate(t.finDibujo);

      const hasProd = inMonth(dEnv);
      const hasApv  = inMonth(dApv);
      const hasDraw = inMonth(dFin);

      if (!hasProd && !hasApv && !hasDraw) continue;  // no activity this month

      // Highest phase reached this month
      let thisMonthPhase, date;
      if (hasProd)      { thisMonthPhase = 'produccion'; date = fmtDate(dEnv); }
      else if (hasApv)  { thisMonthPhase = 'aprobado';   date = fmtDate(dApv); }
      else              { thisMonthPhase = 'dibujo';      date = fmtDate(dFin); }

      const bkt = primaryDesigner ? getBucket(primaryDesigner) : unasgn;

      // Dedup by OP (combined-OP handling)
      const dedupKey = (thisMonthPhase === 'produccion' && reg?.combined) ? reg.rawOP : (t.op || null);
      if (dedupKey && bkt.usedOPs.has(dedupKey)) continue;
      if (dedupKey) bkt.usedOPs.add(dedupKey);

      // Score — if nivel is present but no new progress, skip entirely.
      // If nivel is absent, include item with 0 pts (shown as "— sin nivel").
      const scored = level !== null ? scoreForMonth(level, thisMonthPhase, t.op) : null;
      if (scored === null && level !== null) continue;  // already at this phase or higher

      const pts           = scored?.pts           ?? 0;
      const pct           = scored?.pct           ?? PHASE_PCT[thisMonthPhase];
      const prevPhase     = scored?.prevPhase     ?? null;
      const prevMonthLabel= scored?.prevMonthLabel?? null;

      const item = makeItem({
        name:          t.name,
        parent:        t.parent,
        op:            t.op,
        level,
        fromReg,
        hasLevel:      level !== null,
        pts,
        phase:         thisMonthPhase,
        pct,
        prevPhase,
        prevMonthLabel,
        date,
        unconfirmed:   thisMonthPhase === 'produccion' && mode === 'B' && !!t.op && unconfirmedOPs.has(t.op),
        fromRegOnly:   false,
        corrections:   t.corrections || 0,
      });

      if      (thisMonthPhase === 'produccion') bkt.productions.push(item);
      else if (thisMonthPhase === 'aprobado')   bkt.approved.push(item);
      else                                       bkt.drawings.push(item);
    }

    // ── 4b. SoloFabrica items (Mode B) — always Producción ─
    if (mode === 'B') {
      for (const e of soloFabrica) {
        const designer = mapDesignerReg(e.designer);
        const bkt      = designer ? getBucket(designer) : unasgn;
        if (bkt.usedOPs.has(e.rawOP)) continue;
        bkt.usedOPs.add(e.rawOP);

        const thisMonthPhase = 'produccion';
        const scored = e.nivel !== null ? scoreForMonth(e.nivel, thisMonthPhase, e.rawOP) : null;
        if (scored === null && e.nivel !== null) continue;  // already at produccion

        const entryDate = parseRegDate(e.entradaRaw, year);

        bkt.productions.push(makeItem({
          name:          e.descripcion || ('OP: ' + e.rawOP),
          parent:        e.cliente || '',
          op:            e.rawOP,
          level:         e.nivel,
          fromReg:       true,
          hasLevel:      e.nivel !== null,
          pts:           scored?.pts           ?? 0,
          phase:         thisMonthPhase,
          pct:           scored?.pct           ?? 1.0,
          prevPhase:     scored?.prevPhase     ?? null,
          prevMonthLabel:scored?.prevMonthLabel?? null,
          date:          fmtDate(entryDate),
          unconfirmed:   false,
          fromRegOnly:   true,
          corrections:   0,
        }));
      }
    }

  // ── 4c. Mode C: Registro-only production ────────────────
  } else {
    for (const e of regEntries) {
      const d = parseRegDate(e.entradaRaw, year);
      if (!d || d.getMonth() + 1 !== month || d.getFullYear() !== year) continue;

      const designer = mapDesignerReg(e.designer);
      const bkt      = designer ? getBucket(designer) : unasgn;
      if (bkt.usedOPs.has(e.rawOP)) continue;
      bkt.usedOPs.add(e.rawOP);

      const thisMonthPhase = 'produccion';
      const scored = e.nivel !== null ? scoreForMonth(e.nivel, thisMonthPhase, e.rawOP) : null;
      if (scored === null && e.nivel !== null) continue;

      bkt.productions.push(makeItem({
        name:          e.descripcion || ('OP: ' + e.rawOP),
        parent:        e.cliente || '',
        op:            e.rawOP,
        level:         e.nivel,
        fromReg:       true,
        hasLevel:      e.nivel !== null,
        pts:           scored?.pts           ?? 0,
        phase:         thisMonthPhase,
        pct:           scored?.pct           ?? 1.0,
        prevPhase:     scored?.prevPhase     ?? null,
        prevMonthLabel:scored?.prevMonthLabel?? null,
        date:          fmtDate(d),
        unconfirmed:   false,
        fromRegOnly:   false,
        corrections:   0,
      }));
    }
  }

  // ── 5. Aggregate per-designer totals ─────────────────────
  const designers = [];
  for (const [name, d] of dMap) {
    const dTotal   = d.drawings.reduce(   (s, i) => s + i.score, 0);
    const apvTotal = d.approved.reduce(   (s, i) => s + i.score, 0);
    const pTotal   = d.productions.reduce((s, i) => s + i.score, 0);
    const aTotal   = parseFloat((dTotal + apvTotal).toFixed(2));    // alias

    const allItems  = [...d.drawings, ...d.approved, ...d.productions];
    const projects  = [...new Set(allItems.map(i => i.parent).filter(Boolean))];
    const uniqueSet = new Set(allItems.map(i => i.name));

    designers.push({
      name,
      color:       DESIGNER_COLORS[name] || '#888888',
      drawings:    d.drawings,
      approved:    d.approved,
      productions: d.productions,
      dTotal:      parseFloat(dTotal.toFixed(2)),
      apvTotal:    parseFloat(apvTotal.toFixed(2)),
      pTotal:      parseFloat(pTotal.toFixed(2)),
      // Aliases for dashboard backward compatibility
      approvals:   d.drawings,
      aTotal,
      total:       parseFloat((dTotal + apvTotal + pTotal).toFixed(2)),
      projects,
      itemCount:   uniqueSet.size,
    });
  }
  designers.sort((a, b) => b.total - a.total);

  // ── 6. Team metrics ──────────────────────────────────────
  const n     = designers.length || 1;
  const tPts  = parseFloat(designers.reduce((s, d) => s + d.total,    0).toFixed(2));
  const tDraw = parseFloat(designers.reduce((s, d) => s + d.dTotal,   0).toFixed(2));
  const tApv  = parseFloat(designers.reduce((s, d) => s + d.apvTotal, 0).toFixed(2));
  const tPrd  = parseFloat(designers.reduce((s, d) => s + d.pTotal,   0).toFixed(2));
  const tApr  = parseFloat((tDraw + tApv).toFixed(2));     // alias (draw + apv)

  // Role-group means
  const srDes = designers.filter(d => PC_ROLES.senior.has(d.name));
  const jrDes = designers.filter(d => PC_ROLES.junior.has(d.name));
  const srN   = srDes.length || 1;
  const jrN   = jrDes.length || 1;

  const meanSrTotal = srDes.length ? parseFloat((srDes.reduce((s,d)=>s+d.total,    0)/srN).toFixed(2)) : 0;
  const meanSrDraw  = srDes.length ? parseFloat((srDes.reduce((s,d)=>s+d.dTotal,   0)/srN).toFixed(2)) : 0;
  const meanSrApv   = srDes.length ? parseFloat((srDes.reduce((s,d)=>s+d.apvTotal, 0)/srN).toFixed(2)) : 0;
  const meanSrProd  = srDes.length ? parseFloat((srDes.reduce((s,d)=>s+d.pTotal,   0)/srN).toFixed(2)) : 0;
  const meanSrAprob = parseFloat((meanSrDraw + meanSrApv).toFixed(2));

  const meanJrTotal = jrDes.length ? parseFloat((jrDes.reduce((s,d)=>s+d.total,    0)/jrN).toFixed(2)) : 0;
  const meanJrDraw  = jrDes.length ? parseFloat((jrDes.reduce((s,d)=>s+d.dTotal,   0)/jrN).toFixed(2)) : 0;
  const meanJrApv   = jrDes.length ? parseFloat((jrDes.reduce((s,d)=>s+d.apvTotal, 0)/jrN).toFixed(2)) : 0;
  const meanJrProd  = jrDes.length ? parseFloat((jrDes.reduce((s,d)=>s+d.pTotal,   0)/jrN).toFixed(2)) : 0;
  const meanJrAprob = parseFloat((meanJrDraw + meanJrApv).toFixed(2));

  // ── 7. Extra team-level metrics ──────────────────────────
  const allItems = designers.flatMap(d => [...d.drawings, ...d.approved, ...d.productions]);

  const seenKeys = new Set();
  for (const item of allItems) seenKeys.add(item.op || item.name);
  const uniqueItems = seenKeys.size;

  const projPts = new Map();
  for (const item of allItems) {
    if (item.parent) projPts.set(item.parent, (projPts.get(item.parent) || 0) + item.score);
  }
  let starProject = '', starPts = 0;
  for (const [p, pts] of projPts) if (pts > starPts) { starPts = pts; starProject = p; }
  starPts = parseFloat(starPts.toFixed(1));

  const rawDraw   = designers.reduce((s, d) => s + d.drawings.length,    0);
  const rawApv    = designers.reduce((s, d) => s + d.approved.length,    0);
  const rawProd   = designers.reduce((s, d) => s + d.productions.length, 0);
  const rawApprob = rawDraw + rawApv;

  const totalCorr      = allItems.reduce((s, i) => s + (i.corrections || 0), 0);
  const avgCorrections = allItems.length ? parseFloat((totalCorr / allItems.length).toFixed(3)) : 0;

  return {
    mode,
    month,
    year,
    designers,
    unassigned: {
      drawings:    unasgn.drawings,
      approved:    unasgn.approved,
      productions: unasgn.productions,
      approvals:   unasgn.drawings,   // alias
    },
    validation: mode === 'B' ? { coinciden, soloFabrica, soloClickUp } : null,
    metrics: {
      tPts, tDraw, tApv, tPrd,
      tApr,
      mean:    tPts / n,
      meanApr: tApr / n,
      meanPrd: tPrd / n,
      meanSrTotal, meanSrDraw, meanSrApv, meanSrProd, meanSrAprob,
      meanJrTotal, meanJrDraw, meanJrApv, meanJrProd, meanJrAprob,
      uniqueItems,
      starProject,
      starPts,
      topDesigner: designers.length ? { name: designers[0].name, total: designers[0].total } : null,
      rawDraw, rawApv, rawProd,
      rawApprob,
      avgCorrections,
    },
    maxTotal:    designers.length ? designers[0].total : 1,
    activeCount: designers.length,
  };
}
