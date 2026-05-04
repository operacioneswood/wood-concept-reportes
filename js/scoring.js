// ─────────────────────────────────────────────────────────────
// js/scoring.js — Scoring logic, cross-validation, report build
//
// Depends on: config.js, parser.js
// ─────────────────────────────────────────────────────────────

/**
 * Build a complete in-memory report object from parsed CSV data.
 *
 * @param {string}   mode        'A' | 'B' | 'C'
 * @param {object[]} cuTasks     Output of parseCUCSV()
 * @param {object[]} regEntries  Output of parseRegCSV()
 * @param {number}   month       1–12
 * @param {number}   year        e.g. 2026
 * @returns {object} Report object consumed by report.js / storage.js
 *
 * Returned shape:
 * {
 *   mode, month, year,
 *   designers: [{
 *     name, color,
 *     approvals:   [ item, … ],
 *     productions: [ item, … ],
 *     aTotal, pTotal, total, projects, itemCount
 *   }],                                 ← sorted by total desc
 *   unassigned: { approvals, productions },
 *   validation: { coinciden, soloFabrica, soloClickUp } | null,
 *   metrics:   { tPts, tApr, tPrd, mean, meanApr, meanPrd },
 *   maxTotal, activeCount
 * }
 *
 * Item shape:
 * { name, parent, op, level, fromReg, hasLevel, score,
 *   date, unconfirmed, fromRegOnly }
 */
function buildReport(mode, cuTasks, regEntries, month, year) {

  // ── 1. Build OP → Registro entry lookup ─────────────────
  const regMap = new Map(); // individual OP string → entry
  for (const e of regEntries) {
    for (const op of e.ops) regMap.set(op, e);
  }

  // ── 2. Pre-compute cross-validation sets (Mode B only) ──
  let coinciden      = [];
  let soloFabrica    = [];
  let soloClickUp    = [];
  let unconfirmedOPs = new Set(); // ClickUp prod OPs with no Registro match

  if (mode === 'B') {
    // Registro entries whose ENTRADA falls in the selected month
    const regInMonth = regEntries.filter(e => {
      const d = parseRegDate(e.entradaRaw, year);
      return d && d.getMonth() + 1 === month && d.getFullYear() === year;
    });

    // ClickUp tasks with ENVÍO A FÁBRICA in the selected month
    const cuProdInMonth = cuTasks.filter(t => {
      const d = parseCUDate(t.envio);
      return d && d.getMonth() + 1 === month && d.getFullYear() === year;
    });
    const cuProdOPSet = new Set(cuProdInMonth.map(t => t.op).filter(Boolean));

    // All expanded individual OPs present in Registro this month
    const regOPSet = new Set();
    for (const e of regInMonth) for (const op of e.ops) regOPSet.add(op);

    // Classify each Registro entry
    for (const e of regInMonth) {
      if (e.ops.some(op => cuProdOPSet.has(op))) coinciden.push(e);
      else                                         soloFabrica.push(e);
    }

    // Classify each ClickUp production task
    for (const t of cuProdInMonth) {
      if (!t.op || !regOPSet.has(t.op)) {
        unconfirmedOPs.add(t.op || '__noOP_' + t.name);
        soloClickUp.push(t);
      }
    }
  }

  // ── 3. Designer buckets ──────────────────────────────────
  // Each bucket holds three item arrays (one per tier) + a usedOPs set for dedup.
  const dMap   = new Map(); // displayName → bucket
  const unasgn = { drawings: [], approved: [], productions: [], usedOPs: new Set() };

  function getBucket(name) {
    if (!dMap.has(name))
      dMap.set(name, { drawings: [], approved: [], productions: [], usedOPs: new Set() });
    return dMap.get(name);
  }

  // ── Helper: is a Date in the selected month? ─────────────
  const inMonth = d => d && d.getMonth() + 1 === month && d.getFullYear() === year;

  // ── 4a. Process ClickUp tasks (Mode A + B) ───────────────
  // Each task appears ONLY ONCE at its HIGHEST tier reached this month:
  //   Producción (×1.5)  — envio date in month
  //   Aprobado   (×1.25) — aprobado date in month (but no envio this month)
  //   Dibujo     (×1.0)  — finDibujo or envioAprobacion in month (no higher tier)
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

      // Multi-assignee: filter out excluded names; take FIRST valid designer.
      // If cell has content but all names excluded → skip task entirely.
      const rawAssignee    = t.assignee;
      const designersList  = mapDesignersCU(rawAssignee);
      if (!designersList.length && rawAssignee && rawAssignee.trim()) continue;
      const primaryDesigner = designersList[0] || null;

      // Determine which tiers this task reaches this month
      const dEnv  = parseCUDate(t.envio);
      const dApv  = parseCUDate(t.aprobado);
      const dFin  = parseCUDate(t.finDibujo);

      const hasProd  = inMonth(dEnv);
      const hasApv   = inMonth(dApv);
      const hasDraw  = inMonth(dFin);

      if (!hasProd && !hasApv && !hasDraw) continue; // no activity this month

      // Pick highest tier
      let tier, score, date;
      if (hasProd) {
        tier  = 'prod';
        score = level !== null ? parseFloat((level * 1.5).toFixed(2))  : 0;
        date  = fmtDate(dEnv);
      } else if (hasApv) {
        tier  = 'approved';
        score = level !== null ? parseFloat((level * 1.25).toFixed(2)) : 0;
        date  = fmtDate(dApv);
      } else {
        tier  = 'drawing';
        score = level !== null ? parseFloat((level * 1.0).toFixed(2))  : 0;
        date  = fmtDate(dFin);
      }

      // getBucket only when the task actually contributes to this month
      const bkt = primaryDesigner ? getBucket(primaryDesigner) : unasgn;

      // Dedup by OP (combined-OP handling: if Registro entry is combined, use rawOP)
      const dedupKey = (tier === 'prod' && reg && reg.combined) ? reg.rawOP : (t.op || null);
      if (dedupKey && bkt.usedOPs.has(dedupKey)) continue;
      if (dedupKey) bkt.usedOPs.add(dedupKey);

      const item = {
        name:        t.name,
        parent:      t.parent,
        op:          t.op,
        level,
        fromReg,
        hasLevel:    level !== null,
        score,
        date,
        tier,
        unconfirmed: tier === 'prod' && mode === 'B' && !!t.op && unconfirmedOPs.has(t.op),
        fromRegOnly: false,
        corrections: t.corrections || 0,
      };

      if      (tier === 'prod')     bkt.productions.push(item);
      else if (tier === 'approved') bkt.approved.push(item);
      else                          bkt.drawings.push(item);
    }

    // ── 4b. Add soloFabrica items (Mode B) — always Producción ──
    if (mode === 'B') {
      for (const e of soloFabrica) {
        const designer = mapDesignerReg(e.designer);
        const bkt      = designer ? getBucket(designer) : unasgn;

        if (bkt.usedOPs.has(e.rawOP)) continue;
        bkt.usedOPs.add(e.rawOP);

        const entryDate = parseRegDate(e.entradaRaw, year);
        bkt.productions.push({
          name:        e.descripcion || ('OP: ' + e.rawOP),
          parent:      e.cliente || '',
          op:          e.rawOP,
          level:       e.nivel,
          fromReg:     true,
          hasLevel:    e.nivel !== null,
          score:       e.nivel !== null ? parseFloat((e.nivel * 1.5).toFixed(2)) : 0,
          date:        fmtDate(entryDate),
          tier:        'prod',
          unconfirmed: false,
          fromRegOnly: true,
        });
      }
    }

  // ── 4c. Mode C: Registro-only production ─────────────────
  } else {
    for (const e of regEntries) {
      const d = parseRegDate(e.entradaRaw, year);
      if (!d || d.getMonth() + 1 !== month || d.getFullYear() !== year) continue;

      const designer = mapDesignerReg(e.designer);
      const bkt      = designer ? getBucket(designer) : unasgn;

      if (bkt.usedOPs.has(e.rawOP)) continue;
      bkt.usedOPs.add(e.rawOP);

      bkt.productions.push({
        name:        e.descripcion || ('OP: ' + e.rawOP),
        parent:      e.cliente || '',
        op:          e.rawOP,
        level:       e.nivel,
        fromReg:     true,
        hasLevel:    e.nivel !== null,
        score:       e.nivel !== null ? parseFloat((e.nivel * 1.5).toFixed(2)) : 0,
        date:        fmtDate(d),
        tier:        'prod',
        unconfirmed: false,
        fromRegOnly: false,
      });
    }
  }

  // ── 5. Aggregate per-designer totals ─────────────────────
  const designers = [];
  for (const [name, d] of dMap) {
    const dTotal   = d.drawings.reduce((s, i)    => s + i.score, 0);
    const apvTotal = d.approved.reduce((s, i)    => s + i.score, 0);
    const pTotal   = d.productions.reduce((s, i) => s + i.score, 0);
    // aTotal kept as alias (dTotal+apvTotal) for dashboard backward compatibility
    const aTotal   = parseFloat((dTotal + apvTotal).toFixed(2));

    const allItems = [...d.drawings, ...d.approved, ...d.productions];
    const projects  = [...new Set(allItems.map(i => i.parent).filter(Boolean))];
    const uniqueSet = new Set(allItems.map(i => i.name));

    designers.push({
      name,
      color:       DESIGNER_COLORS[name] || '#888888',
      // ── New 3-tier arrays ──
      drawings:    d.drawings,
      approved:    d.approved,
      productions: d.productions,
      dTotal:      parseFloat(dTotal.toFixed(2)),
      apvTotal:    parseFloat(apvTotal.toFixed(2)),
      pTotal:      parseFloat(pTotal.toFixed(2)),
      // ── Aliases for dashboard backward compatibility ──
      approvals:   d.drawings,          // old "approvals" → drawings
      aTotal,                           // dTotal + apvTotal
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
  const tApr  = parseFloat((tDraw + tApv).toFixed(2)); // alias for dashboard

  // ── 6b. Role-group means (Sr / Jr) ───────────────────────
  const srDes = designers.filter(d => PC_ROLES.senior.has(d.name));
  const jrDes = designers.filter(d => PC_ROLES.junior.has(d.name));
  const srN   = srDes.length || 1;
  const jrN   = jrDes.length || 1;

  const meanSrTotal = srDes.length ? parseFloat((srDes.reduce((s,d)=>s+d.total,    0)/srN).toFixed(2)) : 0;
  const meanSrDraw  = srDes.length ? parseFloat((srDes.reduce((s,d)=>s+d.dTotal,   0)/srN).toFixed(2)) : 0;
  const meanSrApv   = srDes.length ? parseFloat((srDes.reduce((s,d)=>s+d.apvTotal, 0)/srN).toFixed(2)) : 0;
  const meanSrProd  = srDes.length ? parseFloat((srDes.reduce((s,d)=>s+d.pTotal,   0)/srN).toFixed(2)) : 0;
  const meanSrAprob = parseFloat((meanSrDraw + meanSrApv).toFixed(2)); // alias for dashboard

  const meanJrTotal = jrDes.length ? parseFloat((jrDes.reduce((s,d)=>s+d.total,    0)/jrN).toFixed(2)) : 0;
  const meanJrDraw  = jrDes.length ? parseFloat((jrDes.reduce((s,d)=>s+d.dTotal,   0)/jrN).toFixed(2)) : 0;
  const meanJrApv   = jrDes.length ? parseFloat((jrDes.reduce((s,d)=>s+d.apvTotal, 0)/jrN).toFixed(2)) : 0;
  const meanJrProd  = jrDes.length ? parseFloat((jrDes.reduce((s,d)=>s+d.pTotal,   0)/jrN).toFixed(2)) : 0;
  const meanJrAprob = parseFloat((meanJrDraw + meanJrApv).toFixed(2)); // alias for dashboard

  // ── 7. Extra team-level metrics ───────────────────────────
  const allItems = designers.flatMap(d => [...d.drawings, ...d.approved, ...d.productions]);

  // Unique items by OP (fallback to name)
  const seenKeys = new Set();
  for (const item of allItems) seenKeys.add(item.op || item.name);
  const uniqueItems = seenKeys.size;

  // Star project — parent with highest combined pts
  const projPts = new Map();
  for (const item of allItems) {
    if (item.parent) projPts.set(item.parent, (projPts.get(item.parent) || 0) + item.score);
  }
  let starProject = '', starPts = 0;
  for (const [p, pts] of projPts) if (pts > starPts) { starPts = pts; starProject = p; }
  starPts = parseFloat(starPts.toFixed(1));

  // Raw item counts
  const rawDraw  = designers.reduce((s, d) => s + d.drawings.length,    0);
  const rawApv   = designers.reduce((s, d) => s + d.approved.length,    0);
  const rawProd  = designers.reduce((s, d) => s + d.productions.length, 0);
  const rawApprob = rawDraw + rawApv; // alias for dashboard

  // Average corrections per item across team
  const totalCorr = allItems.reduce((s, i) => s + (i.corrections || 0), 0);
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
      // aliases
      approvals:   unasgn.drawings,
    },
    validation: mode === 'B'
      ? { coinciden, soloFabrica, soloClickUp }
      : null,
    metrics: {
      tPts, tDraw, tApv, tPrd,
      tApr,           // alias (tDraw + tApv) for dashboard
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
      rawApprob, // alias
      avgCorrections,
    },
    maxTotal:    designers.length ? designers[0].total : 1,
    activeCount: designers.length,
  };
}
