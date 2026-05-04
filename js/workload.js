// ─────────────────────────────────────────────────────────────
// js/workload.js — Carga de Trabajo (PC) tab
//
// Depends on: config.js (PC_ROLES, PC_WEIGHTS, PC_LEVEL_MULT,
//             PC_ZONES, PC_STATUSES, mapDesignerCU, normStr,
//             esc, fmtNum, DESIGNER_COLORS)
// ─────────────────────────────────────────────────────────────

const Workload = {
  _rows: null,  // raw CSV rows shared from App._cuRows

  // ── Public API ────────────────────────────────────────────

  /**
   * Called by App._showScreen('workload') and on file change.
   * cuRows: raw CSV rows array, or null if no file loaded.
   */
  render(cuRows) {
    if (cuRows !== undefined) this._rows = cuRows;
    const body = document.getElementById('wl-body');
    if (!body) return;

    if (!this._rows) {
      this._renderPrompt(body);
      return;
    }
    try {
      const items     = this._parse(this._rows);
      const designers = this._compute(items);
      this._renderContent(body, designers);
    } catch (e) {
      body.innerHTML = `<div class="error-banner visible">${esc(e.message)}</div>`;
      console.error(e);
    }
  },

  /**
   * Render workload from raw ClickUp API tasks (API mode).
   * Called by App when _sourceMode === 'api'.
   */
  renderFromAPI(rawTasks, fieldIds) {
    const body = document.getElementById('wl-body');
    if (!body) return;
    try {
      const items     = this._parseAPITasks(rawTasks, fieldIds);
      const designers = this._compute(items);
      this._renderContent(body, designers);
    } catch (e) {
      body.innerHTML = `<div class="error-banner visible">${esc(e.message)}</div>`;
      console.error(e);
    }
  },

  // ── No-data prompt with dedicated upload ─────────────────

  _renderPrompt(body) {
    body.innerHTML = `
      <input type="file" accept=".csv,.txt" id="wl-file-input" style="display:none">
      <div class="wl-prompt">
        <div class="wl-prompt-icon">⚖️</div>
        <p>Sube el CSV exportado desde ClickUp<br>(lista <strong>DISEÑO — Proyectos Activos</strong>)</p>
        <button class="btn-primary" id="wl-upload-btn" style="margin-top:16px">Subir CSV</button>
        <p style="font-size:12px;color:var(--faint);margin-top:10px">
          También puedes cargar el mismo archivo en <strong>Inicio</strong>.
        </p>
      </div>`;
    const input = document.getElementById('wl-file-input');
    const btn   = document.getElementById('wl-upload-btn');
    if (btn)   btn.addEventListener('click', () => input?.click());
    if (input) input.addEventListener('change', () => {
      if (input.files[0]) this._loadFile(input.files[0]);
    });
  },

  // ── Dedicated file loader ─────────────────────────────────

  _loadFile(file) {
    const body = document.getElementById('wl-body');
    const reader = new FileReader();
    reader.onload = e => {
      try {
        this._rows = parseCSV(e.target.result);
        this.render();
      } catch (err) {
        if (body) body.innerHTML = `<div class="error-banner visible">${esc(err.message)}</div>`;
        console.error(err);
      }
    };
    reader.onerror = () => {
      if (body) body.innerHTML = '<div class="error-banner visible">No se pudo leer el archivo.</div>';
    };
    reader.readAsText(file, 'UTF-8');
  },

  // ── CSV parsing ───────────────────────────────────────────

  _parse(rows) {
    if (!rows || rows.length < 2) return [];
    const hdr = rows[0].map(h => normStr(h));

    const iStatus   = hdr.findIndex(h => h === 'status');
    const iNivel    = hdr.findIndex(h => h.includes('nivel'));
    const iAssignee = hdr.findIndex(h => h === 'assignee');
    const iParentId = hdr.findIndex(h => h === 'parent id');
    const iParentNm = hdr.findIndex(h => h === 'parent name');
    const iName     = hdr.findIndex(h => h === 'task name' || h === 'name');

    const items = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(c => !c.trim())) continue;

      const rawStatus = normStr(row[iStatus] || '');
      if (!PC_STATUSES.has(rawStatus)) continue;

      // Distinguish parent project rows from item rows by presence of Parent ID
      const hasParentId = iParentId !== -1 && (row[iParentId] || '').trim() !== '';
      const isParent    = !hasParentId;

      // Project-level statuses only apply to parent rows, and vice-versa
      const isProjectStatus = rawStatus === 'diseno' || rawStatus === 'asignado';
      if (isParent && !isProjectStatus) continue;
      if (!isParent && isProjectStatus)  continue;

      // Multi-assignee cells like "[Andersson Beltran, KARLA LISNETH DIAZ]":
      // filter excluded names and take the FIRST valid designer only
      // to avoid double-counting PC for tasks shared between real designers.
      const rawCell        = row[iAssignee] || '';
      const bracketContent = rawCell.match(/\[([^\]]+)\]/);
      // Empty brackets "[]" → no assignee, skip
      if (!bracketContent && rawCell.trim().startsWith('[')) continue;
      const inner          = bracketContent ? bracketContent[1] : rawCell;
      const validDesigners = inner.split(',')
        .map(s => s.trim()).filter(Boolean)
        .map(n => {
          const first = normStr(n.split(' ')[0]);
          if (CU_EXCLUDE.has(first)) return null;
          return CU_MAP[n] || n;
        })
        .filter(Boolean);
      if (!validDesigners.length) continue;

      const rawNivel = iNivel !== -1 ? (row[iNivel] || '') : '';
      const nivel    = rawNivel.trim() ? (parseFloat(rawNivel) || null) : null;
      const project  = iParentNm !== -1 ? (row[iParentNm] || '') : '';
      const name     = iName     !== -1 ? (row[iName]     || '') : '';

      // Each valid designer gets the full PC value — workload is additive per person.
      // Excluded names (Andersson, Stefania) are already filtered out above.
      for (const designer of validDesigners) {
        items.push({ designer, status: rawStatus, nivel, project, name, isParent });
      }
    }
    return items;
  },

  // ── API task parsing (for renderFromAPI) ─────────────────

  /**
   * Parse raw ClickUp API task objects into the same item shape used by _compute().
   * Mirrors _parse() but reads status/nivel/assignees from API fields.
   */
  _parseAPITasks(rawTasks, fieldIds) {
    const fids = fieldIds || {};

    // Build parent name lookup: id → task name
    const nameById = new Map((rawTasks || []).map(t => [t.id, t.name || '']));

    const items = [];
    for (const t of (rawTasks || [])) {
      const rawStatus = normStr(t.status?.status || '');
      if (!PC_STATUSES.has(rawStatus)) continue;

      // isParent: top-level task (no parent) — handles null, undefined, and ""
      const isParent = !t.parent;

      const isProjectStatus = rawStatus === 'diseno' || rawStatus === 'asignado';
      if (isParent  && !isProjectStatus) continue;
      if (!isParent && isProjectStatus)  continue;

      // Resolve assignees from API user objects
      const names         = (t.assignees || []).map(a => (a.username || a.name || '').trim()).filter(Boolean);
      const validDesigners = names
        .map(n => {
          const first = normStr(n.split(' ')[0]);
          if (CU_EXCLUDE.has(first)) return null;
          return CU_MAP[n] || n;
        })
        .filter(Boolean);

      if (!validDesigners.length) continue;

      // Nivel from custom field
      const nivRaw = _cuFieldVal(t, fids.nivel);
      const nivel  = nivRaw !== '' ? (parseFloat(nivRaw) || null) : null;

      // Project name: parent's name for subtasks, own name for parent tasks
      const project = isParent ? (t.name || '') : (nameById.get(t.parent) || '');
      const name    = t.name || '';

      // Each valid designer gets full PC (additive, same as CSV workload)
      for (const designer of validDesigners) {
        items.push({ designer, status: rawStatus, nivel, project, name, isParent });
      }
    }
    return items;
  },

  // ── PC computation ────────────────────────────────────────

  _compute(items) {
    const map = new Map();

    for (const item of items) {
      const name = item.designer;
      const role = PC_ROLES.senior.has(name) ? 'senior' : 'junior';

      if (!map.has(name)) map.set(name, { name, role, totalPC: 0, byStatus: {} });
      const bucket = map.get(name);
      const wConf  = PC_WEIGHTS[role][item.status];

      if (!bucket.byStatus[item.status]) {
        bucket.byStatus[item.status] = { count: 0, pc: 0 };
      }
      bucket.byStatus[item.status].count++;

      if (!wConf || wConf.base === 0) continue;  // count item, add 0 PC

      const mult = wConf.useLevel ? pcLevelMult(item.nivel) : 1.0;
      const pc   = parseFloat((wConf.base * mult).toFixed(2));
      bucket.byStatus[item.status].pc = parseFloat((bucket.byStatus[item.status].pc + pc).toFixed(2));
      bucket.totalPC = parseFloat((bucket.totalPC + pc).toFixed(2));
    }

    return [...map.values()].sort((a, b) => b.totalPC - a.totalPC);
  },

  // ── Render (summary + cards) ──────────────────────────────

  _renderContent(body, designers) {
    // Summary metrics
    const totalPC = parseFloat(designers.reduce((s, d) => s + d.totalPC, 0).toFixed(2));
    const zones   = { green: 0, yellow: 0, red: 0 };
    let   mostAvail = null, mostAvailPC = Infinity;

    for (const d of designers) {
      const z = pcZone(d.role, d.totalPC);
      zones[z]++;
      if (d.totalPC < mostAvailPC) { mostAvailPC = d.totalPC; mostAvail = d; }
    }

    const ZONE_LABEL = { green: 'Disponible', yellow: 'Carga media', red: 'Saturado' };
    const ZONE_ICON  = { green: '🟢', yellow: '🟡', red: '🔴' };

    const maZone  = mostAvail ? pcZone(mostAvail.role, mostAvail.totalPC) : 'green';
    const maLabel = mostAvail ? `${fmtNum(mostAvail.totalPC)} PC · ${ZONE_LABEL[maZone]}` : '—';

    const zoneText = ['green','yellow','red']
      .filter(z => zones[z] > 0)
      .map(z => `${ZONE_ICON[z]} ${zones[z]}`)
      .join('  ');

    body.innerHTML = `
      <div class="metrics-grid" style="margin-bottom:20px">
        <div class="metric-card">
          <div class="metric-label">PC total equipo</div>
          <div class="metric-value">${fmtNum(totalPC)}</div>
          <div class="metric-sub">${designers.length} diseñador${designers.length !== 1 ? 'es' : ''}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Recomendación de asignación</div>
          <div class="metric-value metric-value-text">${mostAvail ? esc(mostAvail.name.split(' ')[0]) : '—'}</div>
          <div class="metric-sub">${esc(maLabel)}</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Estado del equipo</div>
          <div class="metric-value metric-value-text" style="font-size:22px;line-height:1.4;letter-spacing:.04em">${zoneText || '—'}</div>
          <div class="metric-sub">Disponible · Media · Saturado</div>
        </div>
      </div>
      <div class="wl-actions">
        <input type="file" accept=".csv,.txt" id="wl-file-input2" style="display:none">
        <button class="btn-secondary" id="wl-new-btn">↑ Cargar otro CSV</button>
        <button class="btn-secondary" id="wl-pdf-btn">⬇ Descargar PDF</button>
      </div>
      <div id="wl-cards" style="margin-top:20px"></div>`;

    // Bind action buttons
    const input2  = document.getElementById('wl-file-input2');
    const newBtn  = document.getElementById('wl-new-btn');
    const pdfBtn  = document.getElementById('wl-pdf-btn');
    if (newBtn)  newBtn.addEventListener('click', () => input2?.click());
    if (input2)  input2.addEventListener('change', () => {
      if (input2.files[0]) this._loadFile(input2.files[0]);
    });
    if (pdfBtn)  pdfBtn.addEventListener('click', () => this._downloadPDF(designers));

    this._renderCards(designers);
  },

  _renderCards(designers) {
    const wrap = document.getElementById('wl-cards');
    if (!wrap) return;

    if (!designers.length) {
      wrap.innerHTML = '<p style="font-size:14px;color:var(--muted)">No se encontraron diseñadores con ítems activos.</p>';
      return;
    }

    const STATUS_ORDER = [
      'diseno', 'asignado', 'en dibujo',
      'revision de constructivo', 'enviado a aprobacion', 'proximos a entrar',
    ];
    const STATUS_LABEL = {
      'diseno':                   'Diseño',
      'asignado':                 'Asignado',
      'en dibujo':                'En dibujo',
      'revision de constructivo': 'Rev. constructivo',
      'enviado a aprobacion':     'Enviado a aprob.',
      'proximos a entrar':        'Próximos a entrar',
    };
    const ZONE_COLOR_FG = { green: 'var(--above-text)', yellow: '#92400e', red: 'var(--below-text)' };
    const ZONE_COLOR_BG = { green: 'var(--above-bg)',   yellow: '#fef3c7', red: 'var(--below-bg)'   };
    const ZONE_LABEL    = { green: 'Disponible',        yellow: 'Carga media',  red: 'Saturado'     };
    const ZONE_ICON     = { green: '🟢', yellow: '🟡', red: '🔴' };

    wrap.innerHTML = designers.map(d => {
      const zone     = pcZone(d.role, d.totalPC);
      const fg       = ZONE_COLOR_FG[zone];
      const bg       = ZONE_COLOR_BG[zone];
      const color    = DESIGNER_COLORS[d.name] || '#888';
      const roleLbl  = d.role === 'senior' ? 'Sr' : 'Jr';
      // Bar fills up to 140% of the yellow threshold so even saturated designers fit
      const barMax   = PC_ZONES[d.role].yellow * 1.4;
      const barPct   = Math.min((d.totalPC / barMax) * 100, 100).toFixed(1);

      const rows = STATUS_ORDER
        .filter(s => d.byStatus[s] && d.byStatus[s].count > 0)
        .map(s => {
          const b = d.byStatus[s];
          return `<div class="wl-breakdown-row">
            <span class="wl-status-label">${STATUS_LABEL[s]}</span>
            <span class="wl-breakdown-count">${b.count} ítem${b.count !== 1 ? 's' : ''}</span>
            <span class="wl-breakdown-pc">${fmtNum(b.pc)} PC</span>
          </div>`;
        }).join('');

      return `
      <div class="designer-card">
        <div class="card-header">
          <div class="card-top">
            <div class="designer-dot" style="background:${color}"></div>
            <div class="designer-name">${esc(d.name)}</div>
            <div class="pills">
              <span class="pill" style="background:${bg};color:${fg}">${ZONE_ICON[zone]} ${ZONE_LABEL[zone]}</span>
              <span class="pill pill-neutral">${fmtNum(d.totalPC)} PC</span>
              <span class="pill pill-neutral">${roleLbl}</span>
            </div>
          </div>
          <div class="bar-wrap" style="margin-bottom:0">
            <div class="bar-track">
              <div class="bar-fill" style="width:${barPct}%;background:${fg}"></div>
            </div>
          </div>
        </div>
        <div class="card-body single-col">
          <div class="item-col">
            <div class="col-heading">
              <div class="col-dot" style="background:${color}"></div>
              <span style="color:var(--muted)">Desglose por estado</span>
            </div>
            ${rows || '<div class="col-empty">Sin ítems activos</div>'}
            <div class="col-subtotal"><span>Total</span><span>${fmtNum(d.totalPC)} PC</span></div>
          </div>
        </div>
      </div>`;
    }).join('');
  },

  // ── PDF export ────────────────────────────────────────────

  _downloadPDF(designers) {
    if (!window.jspdf) {
      alert('La librería PDF no está disponible. Recarga la página e intenta de nuevo.');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW  = doc.internal.pageSize.getWidth();
    const margin = 14;
    const colW   = pageW - margin * 2;
    let   y      = 18;

    const STATUS_ORDER = [
      'diseno','asignado','en dibujo',
      'revision de constructivo','enviado a aprobacion','proximos a entrar',
    ];
    const STATUS_LABEL = {
      'diseno':                   'Diseño',
      'asignado':                 'Asignado',
      'en dibujo':                'En dibujo',
      'revision de constructivo': 'Rev. constructivo',
      'enviado a aprobacion':     'Enviado a aprob.',
      'proximos a entrar':        'Próximos a entrar',
    };
    const ZONE_LABEL = { green: 'Disponible', yellow: 'Carga media', red: 'Saturado' };

    // ── Header ────────────────────────────────────────────
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Carga de Trabajo PC — Wood Concept', margin, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const dateStr = new Date().toLocaleString('es', {
      day: '2-digit', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
    doc.text(`Generado el ${dateStr}`, margin, y);
    y += 10;

    // ── Team summary ──────────────────────────────────────
    const totalPC = parseFloat(designers.reduce((s, d) => s + d.totalPC, 0).toFixed(2));
    const zones   = { green: 0, yellow: 0, red: 0 };
    let   mostAvail = null, mostAvailPC = Infinity;
    for (const d of designers) {
      const z = pcZone(d.role, d.totalPC);
      zones[z]++;
      if (d.totalPC < mostAvailPC) { mostAvailPC = d.totalPC; mostAvail = d; }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Resumen del equipo', margin, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`PC total del equipo: ${fmtNum(totalPC)}  ·  ${designers.length} diseñador${designers.length !== 1 ? 'es' : ''} activo${designers.length !== 1 ? 's' : ''}`, margin, y);
    y += 5;
    doc.text(`Disponibles: ${zones.green}  ·  Carga media: ${zones.yellow}  ·  Saturados: ${zones.red}`, margin, y);
    if (mostAvail) {
      y += 5;
      const mz = pcZone(mostAvail.role, mostAvail.totalPC);
      doc.text(`Recomendación: ${mostAvail.name} tiene mayor disponibilidad (${fmtNum(mostAvail.totalPC)} PC · ${ZONE_LABEL[mz]})`, margin, y, { maxWidth: colW });
    }
    y += 12;

    // ── Divider ───────────────────────────────────────────
    doc.setDrawColor(220, 218, 213);
    doc.line(margin, y - 4, pageW - margin, y - 4);

    // ── Designer cards ────────────────────────────────────
    for (const d of designers) {
      // Page break if needed (card header + at least one table row)
      if (y > 245) { doc.addPage(); y = 18; }

      const zone    = pcZone(d.role, d.totalPC);
      const roleLbl = d.role === 'senior' ? 'Sr' : 'Jr';

      // Card header bar
      doc.setFillColor(245, 244, 241);
      doc.roundedRect(margin, y - 2, colW, 10, 2, 2, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.text(d.name, margin + 3, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(
        `${roleLbl}  ·  ${fmtNum(d.totalPC)} PC  ·  ${ZONE_LABEL[zone]}`,
        pageW - margin - 3, y + 5, { align: 'right' }
      );
      y += 14;

      // Breakdown table
      const tableBody = STATUS_ORDER
        .filter(s => d.byStatus[s]?.count > 0)
        .map(s => [
          STATUS_LABEL[s],
          `${d.byStatus[s].count} ítem${d.byStatus[s].count !== 1 ? 's' : ''}`,
          `${fmtNum(d.byStatus[s].pc)} PC`,
        ]);
      tableBody.push(['Total', '', `${fmtNum(d.totalPC)} PC`]);

      doc.autoTable({
        startY:      y,
        margin:      { left: margin, right: margin },
        head:        [['Estado', 'Ítems', 'PC']],
        body:        tableBody,
        theme:       'plain',
        styles:      { fontSize: 8.5, cellPadding: [2, 3], textColor: [50, 47, 43] },
        headStyles:  { fontStyle: 'bold', textColor: [100, 96, 90], fillColor: [237, 233, 226] },
        columnStyles: {
          0: { cellWidth: 80 },
          1: { cellWidth: 40, halign: 'right' },
          2: { cellWidth: 40, halign: 'right' },
        },
        didParseCell(data) {
          // Bold the Total row
          if (data.section === 'body' && data.row.index === tableBody.length - 1) {
            data.cell.styles.fontStyle = 'bold';
          }
        },
      });

      y = doc.lastAutoTable.finalY + 10;
    }

    doc.save('carga-trabajo-pc.pdf');
  },
};

// ── Helpers ───────────────────────────────────────────────────

/** Return the level multiplier for a given nivel value. */
function pcLevelMult(nivel) {
  if (nivel == null) return 1.0;
  for (const { max, mult } of PC_LEVEL_MULT) {
    if (nivel <= max) return mult;
  }
  return 2.0;
}

/** Return 'green' | 'yellow' | 'red' load zone for a role + PC total. */
function pcZone(role, pc) {
  const t = PC_ZONES[role] || PC_ZONES.junior;
  if (pc <= t.green)  return 'green';
  if (pc <= t.yellow) return 'yellow';
  return 'red';
}
