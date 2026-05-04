// ─────────────────────────────────────────────────────────────
// js/parser.js — CSV parsing, date parsing, data extraction
//
// Depends on: config.js (normStr, SP_MONTHS, fmtDate)
// ─────────────────────────────────────────────────────────────

// ════════════════════════════════════════════════════════════
// RAW CSV PARSER
// ════════════════════════════════════════════════════════════

/**
 * Parse a raw CSV string into a 2D array of strings.
 * Handles:
 *   - UTF-8 BOM (stripped)
 *   - Quoted fields (double-quote escaping "")
 *   - CRLF / CR / LF line endings
 *   - Trailing whitespace on each field is preserved (callers trim as needed)
 */
function parseCSV(raw) {
  // Strip BOM
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  // Normalise line endings
  raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows = [];
  let row   = [];
  let field = '';
  let inQ   = false;

  for (let i = 0; i <= raw.length; i++) {
    const c = i < raw.length ? raw[i] : '\n'; // sentinel final newline
    const n = raw[i + 1];

    if (inQ) {
      if (c === '"' && n === '"') { field += '"'; i++; } // escaped quote
      else if (c === '"')          inQ = false;
      else                         field += c;
    } else {
      if      (c === '"')  { inQ = true; }
      else if (c === ',')  { row.push(field); field = ''; }
      else if (c === '\n') {
        row.push(field); field = '';
        if (row.some(f => f.trim() !== '')) rows.push(row);
        row = [];
      } else { field += c; }
    }
  }
  return rows;
}

// ════════════════════════════════════════════════════════════
// DATE PARSERS
// ════════════════════════════════════════════════════════════

/**
 * Parse a ClickUp date string like "Wednesday, April 1st 2026".
 * Returns a Date object or null.
 */
function parseCUDate(str) {
  if (!str || !str.trim()) return null;
  str = str.trim();
  // Drop day-of-week prefix ("Wednesday, ")
  const ci = str.indexOf(',');
  if (ci !== -1) str = str.slice(ci + 1).trim();
  // Strip ordinal suffixes: 1st → 1, 2nd → 2, etc.
  str = str.replace(/(\d+)(st|nd|rd|th)/gi, '$1');
  // "April 1 2026"
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Parse a Registro de Entrada date like "2-abr" or "14-abr".
 * The year is supplied from the UI selection.
 * Returns a Date object or null.
 */
function parseRegDate(str, year) {
  if (!str || !str.trim()) return null;
  str = str.trim().toLowerCase();
  const parts = str.split('-');
  if (parts.length < 2) return null;
  const day = parseInt(parts[0], 10);
  const mon = SP_MONTHS[parts[1].trim()];
  if (!day || !mon) return null;
  return new Date(year, mon - 1, day);
}

// ════════════════════════════════════════════════════════════
// OP PARSER
// ════════════════════════════════════════════════════════════

/**
 * Parse a Registro OP cell that may be a combined entry.
 *
 * Examples:
 *   "25133-01"     → { rawOP: "25133-01",    ops: ["25133-01"],               combined: false }
 *   "25133-01/02"  → { rawOP: "25133-01/02", ops: ["25133-01","25133-02"],    combined: true  }
 *
 * Combined entries are treated as ONE production item — do not count twice.
 */
function parseRegOP(raw) {
  raw = String(raw || '').trim();
  if (!raw) return { rawOP: '', ops: [], combined: false };

  // Pattern: DDDDD-NN/MM  (base number, two-digit suffix slash two-digit suffix)
  const m = raw.match(/^(\d+)-(\d{2})\/(\d{2})$/);
  if (m) {
    return {
      rawOP: raw,
      ops: [`${m[1]}-${m[2]}`, `${m[1]}-${m[3]}`],
      combined: true
    };
  }
  return { rawOP: raw, ops: [raw], combined: false };
}

// ════════════════════════════════════════════════════════════
// COLUMN FINDER HELPER
// ════════════════════════════════════════════════════════════

/**
 * Find the first column index in a header row whose normalised text
 * matches `keyword` (exact) or contains `keyword` as a substring.
 * Returns -1 if not found.
 */
function findCol(header, keyword) {
  const kw = normStr(keyword);
  let idx = header.findIndex(h => normStr(h) === kw);
  if (idx !== -1) return idx;
  return header.findIndex(h => normStr(h).includes(kw));
}

// ════════════════════════════════════════════════════════════
// CLICKUP CSV EXTRACTOR
// ════════════════════════════════════════════════════════════

/**
 * Parse a ClickUp CSV rows array into an array of task objects.
 *
 * Each task object:
 * {
 *   name       : string   — Task Name
 *   parent     : string   — Parent Name (project/client)
 *   op         : string   — NO. OP value, trimmed
 *   nivel      : number|null  — Nivel field (float) or null if empty/invalid
 *   assignee   : string   — raw Assignee cell (e.g. "[Fabian Parra]")
 *   finDibujo  : string   — raw FIN DE DIBUJO DE APROBACIÓN cell
 *   envio      : string   — raw ENVÍO A FÁBRICA cell
 * }
 *
 * Rows where Task Type ≠ "Task" are silently skipped.
 */
function parseCUCSV(rows) {
  if (!rows.length) return [];
  const hdr = rows[0];

  // Locate columns by name (accent-insensitive, case-insensitive)
  const iType  = findCol(hdr, 'task type');
  const iName  = findCol(hdr, 'task name');
  const iPar   = findCol(hdr, 'parent name');
  // "NO. OP (short text)" — match on "no. op" prefix
  const iOP    = hdr.findIndex(h => {
    const n = normStr(h);
    return n.startsWith('no. op') || n.startsWith('no.op');
  });
  // "Nivel (number)" — match on "nivel" prefix
  const iNiv   = hdr.findIndex(h => normStr(h).startsWith('nivel'));
  const iAsgn  = findCol(hdr, 'assignee');
  // "FIN DE DIBUJO DE APROBACIÓN (date)" — match on prefix
  const iFin   = hdr.findIndex(h => normStr(h).startsWith('fin de dibujo'));
  // "APROBADO (date)" — approved date (tier 2)
  const iApv   = hdr.findIndex(h => {
    const n = normStr(h);
    return n === 'aprobado' || n.startsWith('aprobado') || n.startsWith('fecha aprobado');
  });
  // "ENVÍO A APROBACIÓN (date)" — also maps to the drawing/approval tier
  const iEnvA  = hdr.findIndex(h => normStr(h).includes('envio a aprobacion'));
  // "ENVÍO A FÁBRICA (date)" — match on normalised "envio a fabrica"
  const iEnvio = hdr.findIndex(h => normStr(h).includes('envio a fabrica'));
  // "NO. DE CORRECCIONES (number)"
  const iCorr  = hdr.findIndex(h => normStr(h).includes('correcciones'));

  const tasks = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Skip non-Task rows
    if (iType !== -1 && normStr(row[iType] || '') !== 'task') continue;

    const nivelRaw = iNiv !== -1 ? (row[iNiv] || '').trim() : '';
    const nivel    = nivelRaw !== '' ? parseFloat(nivelRaw) : null;

    tasks.push({
      name:            iName  !== -1 ? (row[iName]  || '').trim() : '',
      parent:          iPar   !== -1 ? (row[iPar]   || '').trim() : '',
      op:              iOP    !== -1 ? (row[iOP]    || '').trim() : '',
      nivel:           (nivel !== null && !isNaN(nivel)) ? nivel : null,
      assignee:        iAsgn  !== -1 ? (row[iAsgn]  || '').trim() : '',
      finDibujo:       iFin   !== -1 ? (row[iFin]   || '').trim() : '',
      aprobado:        iApv   !== -1 ? (row[iApv]   || '').trim() : '',
      envioAprobacion: iEnvA  !== -1 ? (row[iEnvA]  || '').trim() : '',
      envio:           iEnvio !== -1 ? (row[iEnvio] || '').trim() : '',
      corrections:     iCorr  !== -1 ? (parseInt(row[iCorr] || '0') || 0) : 0,
    });
  }
  return tasks;
}

// ════════════════════════════════════════════════════════════
// CLICKUP API PARSER
// ════════════════════════════════════════════════════════════

/**
 * Convert a Unix millisecond timestamp (number or numeric string) to a
 * ClickUp-style date string: "Wednesday, April 1st 2026".
 * Returns '' for falsy / zero / NaN input.
 */
function tsToDateStr(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime()) || d.getTime() === 0) return '';
  const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  // Use UTC methods — ClickUp stores dates as UTC midnight timestamps.
  // Local-time methods (getDate/getMonth) shift the day by the UTC offset,
  // which in UTC-5 turns April 1 00:00 UTC into March 31 — wrong month.
  const dd  = d.getUTCDate();
  const suf = (dd === 1 || dd === 21 || dd === 31) ? 'st'
            : (dd === 2 || dd === 22)              ? 'nd'
            : (dd === 3 || dd === 23)              ? 'rd' : 'th';
  return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${dd}${suf} ${d.getUTCFullYear()}`;
}

/**
 * Extract the value of a custom field from a raw ClickUp API task object.
 * Returns '' if the fieldId is null/undefined or the field is not found.
 */
function _cuFieldVal(task, fieldId) {
  if (!fieldId) return '';
  const f = (task.custom_fields || []).find(cf => cf.id === fieldId);
  if (!f || f.value == null) return '';
  // Date fields sometimes return { date: "timestamp", ... } instead of a plain string
  if (typeof f.value === 'object') return String(f.value.date ?? f.value.value ?? '');
  return String(f.value);
}

/**
 * Convert an array of raw ClickUp API task objects into the same shape
 * returned by parseCUCSV(), so the rest of the pipeline is unchanged.
 *
 * ClickUp task shape (relevant fields):
 *   id           — string
 *   name         — string
 *   parent       — string | null  (null = top-level / project task)
 *   status       — { status: string }
 *   assignees    — [{ username: string, ... }]
 *   custom_fields— [{ id, name, value }]
 *
 * `fieldIds` is the object returned by ClickUpIntegration.getFieldIds():
 *   { op, nivel, finDibujo, envio, corrections }
 *
 * Only subtasks (parent !== null) are returned — same as CSV "Task" rows.
 */
function parseClickUpAPI(rawTasks, fieldIds) {
  const fids = fieldIds || {};

  // Build id → name map for parent-name resolution
  const nameById = new Map(rawTasks.map(t => [t.id, t.name || '']));

  return rawTasks
    // Keep ALL tasks — no parent filter.
    // Reason: workspaces vary. Some use a subtask hierarchy (parent tasks =
    // projects, subtasks = items). Others use flat tasks inside folders where
    // the folder IS the project name. Filtering on t.parent would silently
    // drop every item in a flat workspace.
    // Tasks with no dates (e.g. project-container tasks) are naturally
    // ignored later by the scoring engine's month filter.
    .map(t => {
      // Assignees: format as "[Name1, Name2]" so mapDesignersCU can handle it
      const names    = (t.assignees || []).map(a => (a.username || a.name || '').trim()).filter(Boolean);
      const assignee = names.length ? `[${names.join(', ')}]` : '';

      // Resolve parent display name:
      //   subtask  → name of the parent task (the project)
      //   flat task → folder name, then list name, then ''
      const parent = t.parent
        ? (nameById.get(t.parent) || '')
        : (t.folder?.name || t.list?.name || '');

      // Custom field values
      const opVal   = _cuFieldVal(t, fids.op);
      const nivRaw  = _cuFieldVal(t, fids.nivel);
      const nivel   = nivRaw !== '' ? parseFloat(nivRaw) : null;
      const finRaw  = _cuFieldVal(t, fids.finDibujo);
      const apvRaw  = _cuFieldVal(t, fids.aprobado);
      const envARaw = _cuFieldVal(t, fids.envioAprobacion);
      const envRaw  = _cuFieldVal(t, fids.envio);
      const corrRaw = _cuFieldVal(t, fids.corrections);

      return {
        name:            t.name || '',
        parent,
        op:              opVal,
        nivel:           (nivel !== null && !isNaN(nivel)) ? nivel : null,
        assignee,
        finDibujo:       tsToDateStr(finRaw),
        aprobado:        tsToDateStr(apvRaw),
        envioAprobacion: tsToDateStr(envARaw),
        envio:           tsToDateStr(envRaw),
        corrections:     parseInt(corrRaw || '0') || 0,
      };
    });
}

// ════════════════════════════════════════════════════════════
// REGISTRO DE ENTRADA CSV EXTRACTOR
// ════════════════════════════════════════════════════════════

/**
 * Parse a Registro de Entrada CSV rows array into an array of entry objects.
 *
 * Header row detection: find the first row that contains BOTH "op" and
 * "nivel" (normalised). Falls back to a row containing "op" if needed.
 *
 * Each entry object:
 * {
 *   rawOP      : string        — original OP cell value
 *   ops        : string[]      — expanded individual OP codes
 *   combined   : boolean       — true if rawOP was a combined "XX/YY" entry
 *   nivel      : number|null
 *   entradaRaw : string        — raw ENTRADA cell (e.g. "2-abr")
 *   designer   : string        — raw DISEÑADOR cell
 *   descripcion: string        — raw DESCRIPCIÓN cell
 *   cliente    : string        — raw CLIENTE cell
 * }
 */
function parseRegCSV(rows) {
  // ── Find header row ──────────────────────────────────────
  let hdrIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const joined = normStr(rows[i].join(','));
    if (joined.includes('nivel') && joined.includes('op')) { hdrIdx = i; break; }
  }
  // Fallback: row containing "op" (no "nivel")
  if (hdrIdx === -1) {
    for (let i = 0; i < rows.length; i++) {
      if (normStr(rows[i].join(',')).includes(' op') ||
          rows[i].some(c => normStr(c) === 'op')) { hdrIdx = i; break; }
    }
  }
  if (hdrIdx === -1) return [];

  const hdr = rows[hdrIdx];

  // ── Locate columns ───────────────────────────────────────
  const iOP    = findCol(hdr, 'op');
  const iNiv   = findCol(hdr, 'nivel');
  const iEnt   = findCol(hdr, 'entrada');
  // DISEÑADOR — normalises to "disenador"
  const iDis   = hdr.findIndex(h => {
    const n = normStr(h);
    return n === 'disenador' || n.includes('disenador') || n.includes('diseno');
  });
  // DESCRIPCIÓN
  const iDesc  = hdr.findIndex(h => {
    const n = normStr(h);
    return n === 'descripcion' || n.startsWith('descripci');
  });
  const iCli   = findCol(hdr, 'cliente');

  const entries = [];
  for (let r = hdrIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => !c || !c.trim())) continue; // blank row

    const rawOP = iOP !== -1 ? (row[iOP] || '').trim() : '';
    if (!rawOP) continue; // no OP value — skip

    const nivelRaw = iNiv !== -1 ? (row[iNiv] || '').trim() : '';
    const nivel    = nivelRaw !== '' ? parseFloat(nivelRaw) : null;

    const { rawOP: rOP, ops, combined } = parseRegOP(rawOP);

    entries.push({
      rawOP:       rOP,
      ops,
      combined,
      nivel:       (nivel !== null && !isNaN(nivel)) ? nivel : null,
      entradaRaw:  iEnt  !== -1 ? (row[iEnt]  || '').trim() : '',
      designer:    iDis  !== -1 ? (row[iDis]  || '').trim() : '',
      descripcion: iDesc !== -1 ? (row[iDesc] || '').trim() : '',
      cliente:     iCli  !== -1 ? (row[iCli]  || '').trim() : '',
    });
  }
  return entries;
}
