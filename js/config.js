// ─────────────────────────────────────────────────────────────
// js/config.js — Designer config, color palette, name mapping,
//                shared utility functions used across all modules
// ─────────────────────────────────────────────────────────────

// ── Month labels ──────────────────────────────────────────────
const MONTH_NAMES = [
  '', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

const MONTH_SHORT = [
  '', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];

const SP_MONTHS = {
  ene: 1, feb: 2, mar: 3, abr: 4,  may: 5,  jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12
};

// ── Designer definitions (display order) ─────────────────────
const DESIGNERS = [
  { display: 'Fabián P',    color: '#185FA5' },
  { display: 'Luis V',      color: '#3B6D11' },
  { display: 'Sebastian R', color: '#1D9E75' },
  { display: 'Ana G',       color: '#533AB7' },
  { display: 'Johana Ruiz', color: '#c4366b' },
  { display: 'Daniel B',    color: '#8B3A1C' },
  { display: 'Karla Díaz',  color: '#9B5C0A' },
];

// name → hex color lookup
const DESIGNER_COLORS = Object.fromEntries(DESIGNERS.map(d => [d.display, d.color]));

// ordered list of display names
const DESIGNER_NAMES = DESIGNERS.map(d => d.display);

// ── ClickUp assignee → display name ──────────────────────────
// Raw value comes as "[Full Name]" (brackets included)
const CU_MAP = {
  'Fabian Parra':        'Fabián P',
  'Fabián Parra':        'Fabián P',
  'Luis Villamil':       'Luis V',
  'Sebastián Rubio':     'Sebastian R',
  'Sebastian Rubio':     'Sebastian R',
  'Ana Gonzalez':        'Ana G',
  'Ana González':        'Ana G',
  'JOHANA RUIZ':         'Johana Ruiz',
  'Johana Ruiz':         'Johana Ruiz',
  'Daniel Bermudez':     'Daniel B',
  'Daniel Bermúdez':     'Daniel B',
  'KARLA LISNETH DIAZ':  'Karla Díaz',
  'KARLA LISNETH DÍAZ':  'Karla Díaz',
  'Karla Diaz':          'Karla Díaz',
  'Karla Díaz':          'Karla Díaz',
};

// ── Registro de Entrada DISEÑADOR → display name ─────────────
// Entries are matched against normalized (accent-stripped, lowercase) strings.
// Each entry lists all known variants for that designer.
const REG_PATTERNS = [
  {
    patterns: ['fabian p', 'fabian parra', 'fabian'],
    name: 'Fabián P'
  },
  {
    patterns: ['luis v', 'luis villamil', 'luis'],
    name: 'Luis V'
  },
  {
    patterns: ['sebas.r', 'sebas r', 'sebas', 'juan r', 'sebastian r', 'sebastian rubio', 'sebastián r', 'sebastián rubio'],
    name: 'Sebastian R'
  },
  {
    patterns: ['johana ruiz', 'johana r', 'johana'],
    name: 'Johana Ruiz'
  },
  {
    patterns: ['ana g', 'ana gonzalez', 'ana gonzalez', 'ana'],
    name: 'Ana G'
  },
  {
    patterns: ['daniel b', 'daniel bermudez', 'daniel bermudez', 'daniel'],
    name: 'Daniel B'
  },
  {
    patterns: ['karla diaz', 'karla diaz', 'karla lisneth diaz', 'karla lisneth diaz', 'karla'],
    name: 'Karla Díaz'
  },
];

// ── Name mapping functions ────────────────────────────────────

/**
 * First names (normalized) to exclude from all reports and workload.
 * Add a name here to prevent it appearing anywhere in the system.
 */
const CU_EXCLUDE = new Set([
  'andersson', 'stefania',
  'florentino', 'rocio', 'fanny', 'edwin',
]);

/**
 * Map a raw ClickUp assignee string (e.g. "[Fabian Parra]") to a
 * canonical display name. Returns null if unrecognised, empty, or excluded.
 * For single-assignee cells only — use mapDesignersCU for multi-assignee.
 */
function mapDesignerCU(raw) {
  if (!raw || !raw.trim()) return null;
  const m = raw.match(/\[([^\]]+)\]/);
  if (!m) return null;
  const name  = m[1].trim();
  const first = normStr(name.split(' ')[0]);
  if (CU_EXCLUDE.has(first)) return null;
  return CU_MAP[name] || name;
}

/**
 * Map a raw ClickUp assignee cell that may contain multiple names,
 * e.g. "[Andersson Beltran, KARLA LISNETH DIAZ]", to an array of
 * canonical display names. Excluded names are silently dropped.
 * Returns an empty array if the cell is empty or all names are excluded.
 */
function mapDesignersCU(raw) {
  if (!raw || !raw.trim()) return [];
  const m = raw.match(/\[([^\]]+)\]/);
  // Cell starts with '[' but has no valid content inside (e.g. "[]") → empty
  if (!m && raw.trim().startsWith('[')) return [];
  const inner = m ? m[1] : raw;
  return inner.split(',')
    .map(s => s.trim()).filter(Boolean)
    .map(n => {
      const first = normStr(n.split(' ')[0]);
      if (CU_EXCLUDE.has(first)) return null;
      return CU_MAP[n] || n;
    })
    .filter(Boolean);
}

/**
 * Map a Registro de Entrada DISEÑADOR cell to a canonical display name.
 * Uses fuzzy (prefix / exact) matching on the normalised string.
 * Returns null if empty, excluded, or unrecognised.
 */
function mapDesignerReg(raw) {
  if (!raw || !raw.trim()) return null;
  const n = normStr(raw);
  // Exclude non-designers (Andersson, Stefania, etc.) by first word
  const first = n.split(' ')[0];
  if (CU_EXCLUDE.has(first)) return null;
  for (const { patterns, name } of REG_PATTERNS) {
    if (patterns.some(p => n === p || n.startsWith(p + ' '))) return name;
  }
  return raw.trim() || null;
}

// ── Shared utility functions used across all modules ─────────

/** Strip accents, lowercase, trim — used for fuzzy matching. */
function normStr(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** HTML-escape a value for safe innerHTML insertion. */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a number, stripping trailing ".0".
 * e.g. 3 → "3", 4.5 → "4.5", 6.0 → "6"
 */
function fmtNum(n) {
  if (n == null || isNaN(n)) return '0';
  const v = Math.round(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Format bytes as a human-readable string. */
function fmtBytes(b) {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

/**
 * Format a JS Date as "DD/MM/YYYY".
 * Returns null if the date is invalid.
 */
function fmtDate(d) {
  if (!d || isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * From a stored "DD/MM/YYYY" string return "DD/MM" for display.
 * Returns '' if the input is falsy.
 */
function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  return dateStr.slice(0, 5);
}

/**
 * Build the localStorage key for a given year/month.
 * e.g. (2026, 4) → "wc_report_2026_04"
 */
function storageKey(year, month) {
  return `wc_report_${year}_${String(month).padStart(2, '0')}`;
}

/**
 * Return a label like "Abr 2026" for a {month, year} pair.
 */
function monthLabel(month, year) {
  return `${MONTH_SHORT[month]} ${year}`;
}

// ════════════════════════════════════════════════════════════
// WORKLOAD (Carga de Trabajo PC) configuration
// Update roles here when designers change seniority.
// All status keys use normStr format (accents stripped, lowercase).
// ════════════════════════════════════════════════════════════

/** Canonical display names (as returned by mapDesignerCU) per role. */
const PC_ROLES = {
  senior: new Set(['Ana G', 'Johana Ruiz', 'Daniel B', 'Karla Díaz']),
  junior: new Set(['Fabián P', 'Luis V', 'Sebastian R']),
};

