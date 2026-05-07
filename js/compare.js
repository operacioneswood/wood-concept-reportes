// ─────────────────────────────────────────────────────────────
// js/compare.js — Comparar meses tab — full reconstruction
//
// 4 views: Por diseñador · Equipo general · Velocidad · Proyección
// Reads from Firestore snapshots (Storage.loadAll) +
//   current ClickUp session (Schedule._items / _apiTasks)
//
// Depends on: config.js, storage.js, charts.js (niceMax/niceStep),
//             schedule.js (for views 3 & 4)
// ─────────────────────────────────────────────────────────────

const Compare = {
  _stored:    [],
  _selected:  [],
  _view:      'diseñador',   // 'diseñador' | 'equipo' | 'velocidad' | 'proyeccion'
  _listening: false,

  // ── Public API ──────────────────────────────────────────────

  async render() {
    this._stored = await Storage.loadAll();

    const noData = document.getElementById('cmp-no-data');
    const body   = document.getElementById('cmp-body');
    if (!body) return;

    // Bind view-tab buttons once
    if (!this._listening) {
      document.querySelectorAll('.cmp-tab[data-cview]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.cmp-tab[data-cview]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this._view = btn.dataset.cview;
          this._renderContent();
        });
      });
      this._listening = true;
    }

    // Reset active tab highlight to match current _view
    document.querySelectorAll('.cmp-tab[data-cview]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cview === this._view);
    });

    if (this._stored.length === 0) {
      if (noData) {
        noData.innerHTML = `<div class="cmp-empty">
          <div class="cmp-empty-icon">📅</div>
          <p>Necesitas al menos 1 reporte guardado para usar esta sección.</p>
          <p class="cmp-empty-sub">Genera y guarda el reporte de un mes primero.</p>
        </div>`;
        noData.style.display = '';
      }
      body.innerHTML = '';
      this._renderPicker();
      return;
    }
    if (noData) noData.style.display = 'none';

    // Default selection: last 2 stored months (or 1 if only 1 exists)
    const validKeys = this._stored.map(s => this._key(s));
    this._selected  = this._selected.filter(k => validKeys.includes(k));
    if (!this._selected.length) {
      this._selected = this._stored.slice(-2).map(s => this._key(s));
    }

    this._renderPicker();
    this._renderContent();
  },

  // ── Month picker ─────────────────────────────────────────────

  _renderPicker() {
    const picker = document.getElementById('cmp-picker-row');
    if (!picker) return;

    if (!this._stored.length) { picker.innerHTML = ''; return; }

    picker.innerHTML = `
      <span class="cmp-picker-label">Meses:</span>
      ${this._stored.map(s => {
        const key = this._key(s);
        const sel = this._selected.includes(key);
        return `<button class="cmp-chip${sel ? ' active' : ''}" data-key="${esc(key)}">${esc(this._monthLabel(s.month, s.year))}</button>`;
      }).join('')}
      <span class="cmp-picker-hint">Selecciona 1–3 meses</span>`;

    picker.querySelectorAll('.cmp-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const idx = this._selected.indexOf(key);
        if (idx !== -1) {
          if (this._selected.length <= 1) return;
          this._selected.splice(idx, 1);
          btn.classList.remove('active');
        } else {
          if (this._selected.length >= 3) return;
          this._selected.push(key);
          btn.classList.add('active');
        }
        this._renderContent();
      });
    });
  },

  // ── Content dispatcher ────────────────────────────────────────

  _renderContent() {
    const body = document.getElementById('cmp-body');
    if (!body) return;

    const snapshots = this._selected
      .map(key => this._stored.find(s => this._key(s) === key))
      .filter(Boolean)
      .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month)
      .map(s => ({ stored: s, label: this._monthLabel(s.month, s.year) }));

    if (!snapshots.length) {
      body.innerHTML = '<p class="cmp-empty-msg">Selecciona al menos un mes.</p>';
      return;
    }

    // Views 1 & 2 require at least 2 months selected
    if (['diseñador', 'equipo'].includes(this._view) && snapshots.length < 2) {
      body.innerHTML = `<div class="cmp-empty">
        <div class="cmp-empty-icon">📊</div>
        <p>Selecciona al menos 2 meses para comparar esta vista.</p>
        <p class="cmp-empty-sub">La Proyección y Velocidad funcionan con 1 mes.</p>
      </div>`;
      return;
    }

    switch (this._view) {
      case 'diseñador':  this._renderDiseñador(snapshots, body);  break;
      case 'equipo':     this._renderEquipo(snapshots, body);     break;
      case 'velocidad':  this._renderVelocidad(snapshots, body);  break;
      case 'proyeccion': this._renderProyeccion(snapshots, body); break;
    }
  },

  // ══════════════════════════════════════════════════════════════
  // VIEW 1 — Por diseñador
  // ══════════════════════════════════════════════════════════════

  _renderDiseñador(snapshots, body) {
    const allNames = this._allDesignerNames(snapshots.map(s => s.stored));
    const labels   = snapshots.map(s => s.label);
    const n        = labels.length;

    const COLORS = ['#3b82f6', '#7c3aed', '#10b981'];
    const KEYS   = ['draw', 'apv', 'prod'];
    const LBLS   = ['Dibujo', 'Aprobado', 'Producción'];

    const deltaCell = (v, integer = false) => {
      if (v === null) return `<td class="cmp-delta cmp-delta-na">—</td>`;
      const cls  = v > 0 ? 'cmp-delta-up' : v < 0 ? 'cmp-delta-dn' : 'cmp-delta-z';
      const sign = v > 0 ? '+' : '';
      const arr  = v > 0 ? '↑' : v < 0 ? '↓' : '→';
      const disp = integer ? `${sign}${Math.round(v)}` : `${sign}${fmtNum(v)}`;
      return `<td class="cmp-delta ${cls}">${disp} ${arr}</td>`;
    };

    body.innerHTML = allNames.map(name => {
      const color = DESIGNER_COLORS[name] || '#888';
      const rows  = snapshots.map(s => {
        const d = s.stored.designers[name];
        return d
          ? { draw: d.totalDraw||0, apv: d.totalApv||0, prod: d.totalProd||0, tot: d.total||0, cnt: d.itemCount||0 }
          : { draw: null, apv: null, prod: null, tot: null, cnt: null };
      });

      const first = rows[0], last = rows[n - 1];
      const delta = key => (first[key]===null||last[key]===null) ? null
        : parseFloat((last[key] - first[key]).toFixed(2));

      // SVG grouped bar chart
      const maxVal = Math.max(1, ...rows.flatMap(r => [r.draw||0, r.apv||0, r.prod||0]));
      const svgH   = 130, svgW = Math.max(240, n * 110);
      const pad    = { t: 14, r: 10, b: 32, l: 38 };
      const cW     = svgW - pad.l - pad.r;
      const cH     = svgH - pad.t - pad.b;
      const groupW = cW / n;
      const barW   = Math.min(20, (groupW - 12) / 3);
      const gap    = Math.max(2, barW * 0.15);
      const totalBarSetW = 3 * barW + 2 * gap;
      const niceM  = niceMax(maxVal);
      const niceS  = niceStep(niceM, 4);

      let svgContent = '';
      // Grid lines
      for (let v = 0; v <= niceM + 0.001; v += niceS) {
        const gy = pad.t + cH - (v / niceM) * cH;
        svgContent += `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${svgW-pad.r}" y2="${gy.toFixed(1)}" stroke="#ece8e2" stroke-width="1"/>`;
        svgContent += `<text x="${pad.l-4}" y="${(gy+3.5).toFixed(1)}" font-size="8.5" text-anchor="end" fill="#b5b0aa">${fmtNum(v)}</text>`;
      }
      // Bars
      rows.forEach((r, gi) => {
        const gx = pad.l + gi * groupW + (groupW - totalBarSetW) / 2;
        KEYS.forEach((k, ki) => {
          const val = r[k] || 0;
          const bh  = Math.max(val > 0 ? 1 : 0, (val / niceM) * cH);
          const bx  = gx + ki * (barW + gap);
          const by  = pad.t + cH - bh;
          svgContent += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}"
            fill="${COLORS[ki]}" rx="2" opacity="0.88">
            <title>${LBLS[ki]}: ${fmtNum(val)} pts</title></rect>`;
          if (val > 0 && bh > 14) {
            svgContent += `<text x="${(bx+barW/2).toFixed(1)}" y="${(by+bh/2+3.5).toFixed(1)}" font-size="7.5" text-anchor="middle" fill="rgba(255,255,255,0.9)">${fmtNum(val)}</text>`;
          }
        });
        svgContent += `<text x="${(pad.l+gi*groupW+groupW/2).toFixed(1)}" y="${svgH-4}" font-size="9.5" text-anchor="middle" fill="#9b9490">${esc(labels[gi])}</text>`;
      });
      // Axes
      svgContent += `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t+cH}" stroke="#d4cfc9" stroke-width="1"/>`;
      svgContent += `<line x1="${pad.l}" y1="${pad.t+cH}" x2="${svgW-pad.r}" y2="${pad.t+cH}" stroke="#d4cfc9" stroke-width="1"/>`;

      const svg = `<svg width="${svgW}" height="${svgH}" style="display:block;overflow:visible">${svgContent}</svg>`;

      // Delta table
      const deltaHdr = n >= 2 ? `<th class="cmp-delta-hdr">Δ</th>` : '';
      const valRow = (label, key, integer=false) => {
        const cells = rows.map(r => `<td>${r[key]!==null ? (integer ? Math.round(r[key]) : fmtNum(r[key])) : '<span class="cmp-na">—</span>'}</td>`).join('');
        return `<tr><td class="cmp-row-label">${label}</td>${cells}${n>=2 ? deltaCell(delta(key), integer) : ''}</tr>`;
      };

      const legend = KEYS.map((k,i)=>`<span class="cmp-leg-dot" style="background:${COLORS[i]}"></span>${LBLS[i]}`).join(' &nbsp;');

      return `
        <div class="cmp-designer-block">
          <div class="cmp-designer-hdr">
            <span class="cmp-dot" style="background:${color}"></span>
            <span class="cmp-designer-name">${esc(name)}</span>
            <span class="cmp-legend-inline">${legend}</span>
          </div>
          <div class="cmp-designer-body">
            <div class="cmp-chart-box">${svg}</div>
            <div class="cmp-table-box">
              <table class="cmp-delta-tbl">
                <thead><tr>
                  <th></th>
                  ${labels.map(l=>`<th>${esc(l)}</th>`).join('')}
                  ${deltaHdr}
                </tr></thead>
                <tbody>
                  ${valRow('Dibujo','draw')}
                  ${valRow('Aprobado','apv')}
                  ${valRow('Producción','prod')}
                  ${valRow('Total','tot')}
                  ${valRow('Ítems','cnt',true)}
                </tbody>
              </table>
            </div>
          </div>
        </div>`;
    }).join('');
  },

  // ══════════════════════════════════════════════════════════════
  // VIEW 2 — Equipo general
  // ══════════════════════════════════════════════════════════════

  _renderEquipo(snapshots, body) {
    const labels = snapshots.map(s => s.label);
    const teams  = snapshots.map(s => {
      const st   = s.stored;
      let draw=0, apv=0, prod=0, total=0, items=0;
      for (const d of Object.values(st.designers||{})) {
        draw  += d.totalDraw  ||0; apv  += d.totalApv  ||0;
        prod  += d.totalProd  ||0; total+= d.total      ||0; items+= d.itemCount||0;
      }
      return { draw: parseFloat(draw.toFixed(2)), apv: parseFloat(apv.toFixed(2)),
               prod: parseFloat(prod.toFixed(2)), total: parseFloat(total.toFixed(2)),
               items, meanTotal: st.teamMeanTotal||0, meanSr: st.meanSrTotal||0, meanJr: st.meanJrTotal||0 };
    });

    // ── Stacked bar ──
    const SEG  = ['#3b82f6','#7c3aed','#10b981'];
    const SKEYS= ['draw','apv','prod'];
    const svgH = 200, svgW = Math.max(340, labels.length * 130);
    const pad  = { t:20, r:20, b:36, l:52 };
    const cW   = svgW - pad.l - pad.r;
    const cH   = svgH - pad.t - pad.b;
    const maxV = niceMax(Math.max(1,...teams.map(t=>t.total)));
    const niceS= niceStep(maxV,5);
    const barW = Math.min(64, cW/labels.length * 0.52);

    let svgC = '';
    for (let v=0; v<=maxV+0.001; v+=niceS) {
      const gy = pad.t + cH - (v/maxV)*cH;
      svgC += `<line x1="${pad.l}" y1="${gy.toFixed(1)}" x2="${svgW-pad.r}" y2="${gy.toFixed(1)}" stroke="#ece8e2" stroke-width="1"/>`;
      svgC += `<text x="${pad.l-6}" y="${(gy+4).toFixed(1)}" font-size="9" text-anchor="end" fill="#b5b0aa">${fmtNum(v)}</text>`;
    }
    teams.forEach((t,i) => {
      const bx = pad.l + (i+0.5)*(cW/labels.length) - barW/2;
      let cumY = 0;
      SKEYS.forEach((k,si)=>{
        const bh = Math.max(t[k]>0?1:0, (t[k]/maxV)*cH);
        const by = pad.t + cH - cumY - bh;
        if (t[k]>0) svgC += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}"
          fill="${SEG[si]}" rx="2" opacity="0.88"><title>${['Dibujo','Aprobado','Producción'][si]}: ${fmtNum(t[k])}</title></rect>`;
        cumY += Math.max(t[k]>0?1:0, (t[k]/maxV)*cH);
      });
      const topY = pad.t + cH - (t.total/maxV)*cH;
      svgC += `<text x="${(bx+barW/2).toFixed(1)}" y="${(topY-5).toFixed(1)}" font-size="11" font-weight="600" text-anchor="middle" fill="var(--text)">${fmtNum(t.total)}</text>`;
      svgC += `<text x="${(bx+barW/2).toFixed(1)}" y="${svgH-6}" font-size="10" text-anchor="middle" fill="var(--muted)">${esc(labels[i])}</text>`;
    });
    svgC += `<line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t+cH}" stroke="#d4cfc9" stroke-width="1"/>`;
    svgC += `<line x1="${pad.l}" y1="${pad.t+cH}" x2="${svgW-pad.r}" y2="${pad.t+cH}" stroke="#d4cfc9" stroke-width="1"/>`;
    const stackedSvg = `<svg width="${svgW}" height="${svgH}" style="display:block;overflow:visible">${svgC}</svg>`;

    // ── Metric cards ──
    const METRIC_PAIRS = [
      ['Total pts',    t => fmtNum(t.total)],
      ['Dibujo',       t => fmtNum(t.draw)],
      ['Aprobado',     t => fmtNum(t.apv)],
      ['Producción',   t => fmtNum(t.prod)],
      ['Ítems',        t => Math.round(t.items)],
      ['Media total',  t => fmtNum(t.meanTotal)],
      ['Media Sr',     t => fmtNum(t.meanSr)],
      ['Media Jr',     t => fmtNum(t.meanJr)],
    ];
    const metricsHtml = snapshots.map((s,i) => `
      <div class="cmp-metric-col">
        <div class="cmp-metric-month-lbl">${esc(s.label)}</div>
        ${METRIC_PAIRS.map(([lbl, fn]) => `
          <div class="cmp-metric-card">
            <div class="cmp-mc-lbl">${lbl}</div>
            <div class="cmp-mc-val">${fn(teams[i])}</div>
          </div>`).join('')}
      </div>`).join('');

    // ── Sr vs Jr line ──
    const srVals = teams.map(t => t.meanSr);
    const jrVals = teams.map(t => t.meanJr);
    const lsvgH  = 150, lsvgW = Math.max(340, labels.length*120);
    const lpad   = {t:18,r:20,b:34,l:52};
    const lcW    = lsvgW - lpad.l - lpad.r;
    const lcH    = lsvgH - lpad.t - lpad.b;
    const lMax   = niceMax(Math.max(1,...srVals,...jrVals));
    const lStep  = niceStep(lMax,4);
    let lSvgC = '';
    for (let v=0; v<=lMax+0.001; v+=lStep) {
      const gy = lpad.t + lcH - (v/lMax)*lcH;
      lSvgC += `<line x1="${lpad.l}" y1="${gy.toFixed(1)}" x2="${lsvgW-lpad.r}" y2="${gy.toFixed(1)}" stroke="#ece8e2" stroke-width="1"/>`;
      lSvgC += `<text x="${lpad.l-6}" y="${(gy+4).toFixed(1)}" font-size="8.5" text-anchor="end" fill="#b5b0aa">${fmtNum(v)}</text>`;
    }
    const px = (i) => lpad.l + (labels.length===1 ? lcW/2 : i*lcW/(labels.length-1));
    const py = (v) => lpad.t + lcH - (v/lMax)*lcH;
    const lineOf = (vals, color) => {
      const pts = vals.map((v,i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');
      let d = vals.length>1 ? `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>` : '';
      d += vals.map((v,i) => `
        <circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="4" fill="${color}"/>
        <text x="${px(i).toFixed(1)}" y="${(py(v)-8).toFixed(1)}" font-size="9" text-anchor="middle" fill="${color}" font-weight="600">${fmtNum(v)}</text>`).join('');
      return d;
    };
    lSvgC += lineOf(srVals,'#1d4ed8') + lineOf(jrVals,'#059669');
    lSvgC += labels.map((l,i)=>`<text x="${px(i).toFixed(1)}" y="${lsvgH-5}" font-size="9.5" text-anchor="middle" fill="#9b9490">${esc(l)}</text>`).join('');
    lSvgC += `<line x1="${lpad.l}" y1="${lpad.t}" x2="${lpad.l}" y2="${lpad.t+lcH}" stroke="#d4cfc9" stroke-width="1"/>`;
    lSvgC += `<line x1="${lpad.l}" y1="${lpad.t+lcH}" x2="${lsvgW-lpad.r}" y2="${lpad.t+lcH}" stroke="#d4cfc9" stroke-width="1"/>`;
    const lineSvg = `<svg width="${lsvgW}" height="${lsvgH}" style="display:block;overflow:visible">${lSvgC}</svg>`;

    body.innerHTML = `
      <div class="cmp-section">
        <div class="cmp-section-title">Puntos totales del equipo por mes</div>
        <div class="cmp-legend-row">
          <span class="cmp-leg-dot" style="background:#3b82f6"></span>Dibujo &nbsp;
          <span class="cmp-leg-dot" style="background:#7c3aed"></span>Aprobado &nbsp;
          <span class="cmp-leg-dot" style="background:#10b981"></span>Producción
        </div>
        <div style="overflow-x:auto;padding-bottom:4px">${stackedSvg}</div>
      </div>
      <div class="cmp-section">
        <div class="cmp-section-title">Métricas por mes</div>
        <div class="cmp-metrics-row">${metricsHtml}</div>
      </div>
      <div class="cmp-section">
        <div class="cmp-section-title">Media Sr vs media Jr</div>
        <div class="cmp-legend-row">
          <span class="cmp-leg-dot" style="background:#1d4ed8"></span>Media Sr &nbsp;
          <span class="cmp-leg-dot" style="background:#059669"></span>Media Jr
        </div>
        <div style="overflow-x:auto;padding-bottom:4px">${lineSvg}</div>
      </div>`;
  },

  // ══════════════════════════════════════════════════════════════
  // VIEW 3 — Velocidad de proceso
  // ══════════════════════════════════════════════════════════════

  _renderVelocidad(snapshots, body) {
    const items    = Schedule._items || [];
    const hasItems = items.length > 0 && Schedule._rawTasks;

    if (!hasItems) {
      body.innerHTML = `<div class="cmp-empty">
        <div class="cmp-empty-icon">⏱</div>
        <p>La vista de velocidad requiere datos cargados vía API.</p>
        <p class="cmp-empty-sub">Sincroniza con ClickUp en el tab de Inicio y regresa aquí.</p>
      </div>`;
      return;
    }

    const MS    = 86400000;
    const today = new Date(); today.setHours(0,0,0,0);

    // Deduplicate by taskId
    const seen = new Set(), unique = [];
    for (const item of items) {
      const k = item.taskId || item.id;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!item.pending) unique.push(item);
    }

    const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
    const daysBetween = (a,b) => (a&&b&&b>a) ? (b.getTime()-a.getTime())/MS : null;

    const trans   = { f2e:[], e2a:[], a2f:[], tot:[] };
    const dTrans  = {}; // designer → same
    const funnel  = { draw:0, envio:0, apv:0, fab:0 };

    for (const item of unique) {
      const { finDibujo: fD, envioAprobacion: eA, aprobado: aP, envioFabrica: eF } = item;
      if (fD && fD < today) funnel.draw++;
      if (eA && eA < today) funnel.envio++;
      if (aP && aP < today) funnel.apv++;
      if (eF && eF < today) funnel.fab++;

      const t1 = daysBetween(fD,eA), t2 = daysBetween(eA,aP), t3 = daysBetween(aP,eF), tT = daysBetween(fD,eF);
      const push = (arr, v, lim) => { if (v!==null && v>=0 && v<lim) arr.push(v); };

      push(trans.f2e, t1, 90);  push(trans.e2a, t2, 90);
      push(trans.a2f, t3, 60);  push(trans.tot, tT, 180);

      const d = item.designer || '?';
      if (!dTrans[d]) dTrans[d] = {f2e:[],e2a:[],a2f:[]};
      push(dTrans[d].f2e, t1, 90); push(dTrans[d].e2a, t2, 90); push(dTrans[d].a2f, t3, 60);
    }

    const avgs = { f2e:avg(trans.f2e), e2a:avg(trans.e2a), a2f:avg(trans.a2f), tot:avg(trans.tot) };
    const fd   = v => v!==null ? `${v.toFixed(1)} días` : '—';

    // Funnel
    const fTotal = Math.max(1, funnel.draw);
    const FC     = ['#3b82f6','#7c3aed','#10b981','#f59e0b'];
    const fRows  = [
      ['Con fecha de fin de dibujo',    funnel.draw,  100],
      ['Llegaron a envío aprobación',   funnel.envio, funnel.envio/fTotal*100],
      ['Llegaron a aprobado',           funnel.apv,   funnel.apv/fTotal*100],
      ['Llegaron a fábrica',            funnel.fab,   funnel.fab/fTotal*100],
    ];
    const funnelHtml = fRows.map(([lbl,n,pct],i)=>`
      <div class="cmp-funnel-row">
        <div class="cmp-funnel-lbl">${lbl}</div>
        <div class="cmp-funnel-track">
          <div class="cmp-funnel-bar" style="width:${Math.max(0,pct).toFixed(1)}%;background:${FC[i]}"></div>
        </div>
        <div class="cmp-funnel-num">${n} <span class="cmp-funnel-pct">(${pct.toFixed(0)}%)</span></div>
      </div>`).join('');

    // Per-designer velocity table
    const allDes = [...new Set(unique.map(i=>i.designer))].filter(Boolean).sort();
    const desRowsHtml = allDes.map(d => {
      const dt = dTrans[d]||{};
      const da = { f2e:avg(dt.f2e||[]), e2a:avg(dt.e2a||[]), a2f:avg(dt.a2f||[]) };
      const col= DESIGNER_COLORS[d]||'#888';
      const na = (v) => v===null ? 'cmp-vel-na' : '';
      return `<tr>
        <td><span class="cmp-dot" style="background:${col}"></span>${esc(d)}</td>
        <td class="${na(da.f2e)}">${fd(da.f2e)}</td>
        <td class="${na(da.e2a)}">${fd(da.e2a)}</td>
        <td class="${na(da.a2f)}">${fd(da.a2f)}</td>
        <td>${dTrans[d]?.f2e?.length||0}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="cmp-vel-note">
        ⚠ Velocidad calculada a partir de las fechas ClickUp de los <strong>${unique.length}</strong> ítems activos cargados.
        Los snapshots históricos no almacenan fechas individuales por ítem.
      </div>
      <div class="cmp-section">
        <div class="cmp-section-title">Embudo de proceso</div>
        <div class="cmp-funnel">${funnelHtml}</div>
      </div>
      <div class="cmp-section">
        <div class="cmp-section-title">Tiempos promedio de transición — equipo</div>
        <table class="cmp-vel-tbl">
          <thead><tr><th>Transición</th><th>Promedio</th><th>Muestras</th></tr></thead>
          <tbody>
            <tr><td>Fin dibujo → Envío aprobación</td><td class="${avgs.f2e===null?'cmp-vel-na':''}">${fd(avgs.f2e)}</td><td>${trans.f2e.length}</td></tr>
            <tr><td>Envío → Aprobado por cliente</td><td class="${avgs.e2a===null?'cmp-vel-na':''}">${fd(avgs.e2a)}</td><td>${trans.e2a.length}</td></tr>
            <tr><td>Aprobado → Enviado a fábrica</td><td class="${avgs.a2f===null?'cmp-vel-na':''}">${fd(avgs.a2f)}</td><td>${trans.a2f.length}</td></tr>
            <tr class="cmp-vel-total"><td>Proceso completo (fin dibujo → fábrica)</td><td>${fd(avgs.tot)}</td><td>${trans.tot.length}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="cmp-section">
        <div class="cmp-section-title">Velocidad por diseñador</div>
        <table class="cmp-vel-tbl">
          <thead><tr><th>Diseñador</th><th>Fin→Envío</th><th>Envío→Aprobado</th><th>Aprobado→Fábrica</th><th>Muestras</th></tr></thead>
          <tbody>${desRowsHtml}</tbody>
        </table>
      </div>`;
  },

  // ══════════════════════════════════════════════════════════════
  // VIEW 4 — Proyección del mes en curso
  // ══════════════════════════════════════════════════════════════

  _renderProyeccion(snapshots, body) {
    // Requires ClickUp data loaded
    if (!Schedule._rawTasks || !Schedule._apiTasks?.length) {
      body.innerHTML = `<div class="cmp-empty">
        <div class="cmp-empty-icon">📈</div>
        <p>La proyección requiere datos de ClickUp cargados vía API.</p>
        <p class="cmp-empty-sub">Sincroniza con ClickUp en el tab de Inicio y regresa aquí.</p>
      </div>`;
      return;
    }

    const times = Schedule._cfg?.times;
    if (!times) {
      body.innerHTML = `<div class="cmp-empty"><p>Configuración de tiempos no disponible. Abrí el tab de Cronograma primero.</p></div>`;
      return;
    }

    const today    = new Date(); today.setHours(0,0,0,0);
    const curMonth = today.getMonth() + 1;
    const curYear  = today.getFullYear();
    const monthEnd = new Date(curYear, curMonth, 0); monthEnd.setHours(23,59,59,999);
    const curKey   = `${curYear}_${String(curMonth).padStart(2,'0')}`;
    const curSnap  = this._stored.find(s => this._key(s) === curKey);
    const curLabel = this._monthLabel(curMonth, curYear);

    const ACTIVE_ST = new Set(['en dibujo','enviado a aprobacion','revision de constructivo','aprobado']);

    // Actual pts earned this month (from saved snapshot)
    const actualPts = {}, actualItems = {};
    if (curSnap) {
      for (const [name,d] of Object.entries(curSnap.designers||{})) {
        actualPts[name]   = d.total   || 0;
        actualItems[name] = d.itemCount || 0;
      }
    }

    // Historical mean per designer (excluding current month)
    const histSum = {}, histN = {};
    for (const stored of this._stored) {
      if (this._key(stored) === curKey) continue;
      for (const [name,d] of Object.entries(stored.designers||{})) {
        histSum[name] = (histSum[name]||0) + (d.total||0);
        histN[name]   = (histN[name]||0)   + 1;
      }
    }
    const histMean = {};
    for (const name of Object.keys(histSum)) histMean[name] = histSum[name] / histN[name];

    // Deduplicate _items by taskId, keep only active statuses
    const seen = new Set(), activeItems = [];
    for (const item of (Schedule._items||[])) {
      const k = item.taskId || item.id;
      if (seen.has(k)) continue;
      if (!item.pending && ACTIVE_ST.has(item.status||'')) {
        seen.add(k);
        activeItems.push(item);
      }
    }

    // Project each item
    const projByDes = {}; // designer → { projPts, count }
    const riskItems = [];

    for (const item of activeItems) {
      let tl;
      try { tl = Schedule._calcItemDates(item, times, false); } catch(e) { continue; }
      if (!tl || !tl.fabricaDate) continue;

      const nivel = item.nivel || 0;
      let projPts = 0;

      if (tl.fabricaDate <= monthEnd) {
        projPts = parseFloat((nivel * 1.5).toFixed(2));
      } else {
        const hasApvBefore = tl.phases.some(p => (p.label==='En aprobación'||p.label.includes('correc')) && p.endDate <= monthEnd);
        const hasDrawBefore = tl.phases.some(p => (p.label.includes('dibujando')||p.label.includes('revisa+')) && p.endDate <= monthEnd);
        if (hasApvBefore)  projPts = parseFloat((nivel * 1.25).toFixed(2));
        else if (hasDrawBefore) projPts = parseFloat((nivel * 1.0).toFixed(2));
      }

      const designer = item.designer || 'Sin asignar';
      if (!projByDes[designer]) projByDes[designer] = { projPts:0, count:0 };
      if (projPts > 0) { projByDes[designer].projPts += projPts; projByDes[designer].count++; }

      // Risk: has a ClickUp date this month but might miss
      const cuPhaseThisMonth = tl.phases.find(p => p.source==='clickup' && p.endDate>=today && p.endDate<=monthEnd);
      if (cuPhaseThisMonth && tl.fabricaDate > monthEnd) {
        const daysOver = Math.ceil((tl.fabricaDate.getTime()-monthEnd.getTime())/86400000);
        riskItems.push({ item, tl, cuPhase: cuPhaseThisMonth, daysOver });
      }
    }

    // All designers to show
    const allNames = [...new Set([...Object.keys(actualPts), ...Object.keys(projByDes)])].sort();

    const designerHtml = allNames.map(name => {
      const color  = DESIGNER_COLORS[name] || '#888';
      const actual = actualPts[name]  || 0;
      const proj   = projByDes[name]?.projPts || 0;
      const total  = parseFloat((actual + proj).toFixed(2));
      const hist   = histMean[name] ?? null;
      const delta  = hist !== null ? parseFloat((total - hist).toFixed(2)) : null;
      const barMax = Math.max(actual+proj, hist||0, 1) * 1.1;
      const pctA   = Math.min(100, (actual/barMax)*100);
      const pctP   = Math.min(100-pctA, (proj/barMax)*100);
      const pctT   = Math.min(100, (total/barMax)*100);
      const pctH   = hist!==null ? Math.min(100,(hist/barMax)*100) : null;

      const deltaEl = delta===null ? '' : (() => {
        const cls  = delta>0?'cmp-delta-up':delta<0?'cmp-delta-dn':'cmp-delta-z';
        const sign = delta>0?'+':''; const arr = delta>0?'↑':delta<0?'↓':'→';
        return `<span class="${cls}">${sign}${fmtNum(Math.abs(delta))} pts ${arr}</span>`;
      })();

      return `
        <div class="cmp-proj-card">
          <div class="cmp-proj-hdr">
            <span class="cmp-dot" style="background:${color}"></span>
            <span class="cmp-designer-name">${esc(name)}</span>
            ${curSnap ? `<span class="cmp-proj-badge">Actual: ${fmtNum(actual)} pts · ${actualItems[name]||0} ítem${(actualItems[name]||0)!==1?'s':''}</span>` : ''}
          </div>
          <div class="cmp-proj-rows">
            ${actual>0 ? `
            <div class="cmp-prow">
              <span class="cmp-prow-lbl">Actual (${curLabel})</span>
              <div class="cmp-prow-track"><div class="cmp-prow-fill cmp-prow-actual" style="width:${pctA.toFixed(1)}%"></div></div>
              <span class="cmp-prow-val">${fmtNum(actual)}</span>
            </div>` : ''}
            ${proj>0 ? `
            <div class="cmp-prow">
              <span class="cmp-prow-lbl">Proyectado restante</span>
              <div class="cmp-prow-track"><div class="cmp-prow-fill cmp-prow-proj" style="width:${pctP.toFixed(1)}%"></div></div>
              <span class="cmp-prow-val">+${fmtNum(proj)}</span>
            </div>` : ''}
            <div class="cmp-prow cmp-prow-total-row">
              <span class="cmp-prow-lbl"><strong>Total proyectado</strong></span>
              <div class="cmp-prow-track">
                <div class="cmp-prow-fill cmp-prow-total" style="width:${pctT.toFixed(1)}%"></div>
                ${pctH!==null ? `<div class="cmp-hist-tick" style="left:${pctH.toFixed(1)}%" title="Media histórica: ${fmtNum(hist)} pts"></div>` : ''}
              </div>
              <span class="cmp-prow-val"><strong>${fmtNum(total)}</strong></span>
            </div>
          </div>
          <div class="cmp-proj-vs">
            ${hist!==null
              ? `Media histórica: ${fmtNum(hist)} pts &nbsp;·&nbsp; vs proyección: ${deltaEl}`
              : `<span class="cmp-na">Sin historial guardado</span>`}
          </div>
        </div>`;
    }).join('');

    // Risk list
    const riskHtml = riskItems.length ? `
      <div class="cmp-section">
        <div class="cmp-section-title">⚠ Ítems en riesgo — ${curLabel}</div>
        <div class="cmp-risk-list">
          ${riskItems.sort((a,b)=>a.daysOver-b.daysOver).map(({item,tl,cuPhase,daysOver})=>{
            const col  = DESIGNER_COLORS[item.designer]||'#888';
            const limFmt = cuPhase.endDate.toLocaleDateString('es',{day:'2-digit',month:'short'});
            const fabFmt = tl.fabricaDate.toLocaleDateString('es',{day:'2-digit',month:'short'});
            const cls  = daysOver > 3 ? 'cmp-risk-red' : 'cmp-risk-amber';
            const icon = daysOver > 3 ? '🔴' : '🟡';
            return `<div class="cmp-risk-item ${cls}">
              <span class="cmp-risk-icon">${icon}</span>
              <div class="cmp-risk-body">
                <div class="cmp-risk-name">${esc(item.name)} <span style="font-weight:400;color:var(--muted)">· ${esc(item.project||'')}</span></div>
                <div class="cmp-risk-meta">
                  <span style="color:${col};font-weight:600">${esc(item.designer||'—')}</span> &nbsp;·&nbsp;
                  Estado: ${esc(item.status)} &nbsp;·&nbsp;
                  Fecha ClickUp fase actual: ${limFmt} &nbsp;·&nbsp;
                  Est. fábrica: ${fabFmt} <span class="cmp-delta-dn">(${daysOver} día${daysOver!==1?'s':''} tarde)</span>
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>` : '';

    // Team summary
    const totActual = Object.values(actualPts).reduce((s,v)=>s+v,0);
    const totProj   = Object.values(projByDes).reduce((s,v)=>s+v.projPts,0);
    const grandTot  = parseFloat((totActual+totProj).toFixed(2));

    const pastTotals = this._stored.filter(s=>this._key(s)!==curKey).map(s=>
      Object.values(s.designers||{}).reduce((sum,d)=>sum+(d.total||0),0));
    const teamHistMean = pastTotals.length ? pastTotals.reduce((a,b)=>a+b,0)/pastTotals.length : null;
    const bestSnap = [...this._stored].filter(s=>this._key(s)!==curKey)
      .sort((a,b)=>Object.values(b.designers||{}).reduce((s,d)=>s+(d.total||0),0)-
                   Object.values(a.designers||{}).reduce((s,d)=>s+(d.total||0),0))[0];
    const bestTot  = bestSnap ? Object.values(bestSnap.designers||{}).reduce((s,d)=>s+(d.total||0),0) : null;
    const bestLbl  = bestSnap ? this._monthLabel(bestSnap.month,bestSnap.year) : '';
    const overMean = allNames.filter(n=>{
      const proj=(actualPts[n]||0)+(projByDes[n]?.projPts||0);
      return histMean[n]!=null && proj>histMean[n];
    }).length;

    const dRow = (lbl,val,ref,sfx='pts')=> {
      if (ref==null) return '';
      const d = parseFloat((val-ref).toFixed(2));
      const cls = d>0?'cmp-delta-up':d<0?'cmp-delta-dn':'';
      const sign= d>0?'+':''; const arr=d>0?'↑':d<0?'↓':'→';
      return `<div class="cmp-ts-row"><span>vs ${lbl}</span><strong class="${cls}">${sign}${fmtNum(Math.abs(d))} ${sfx} ${arr}</strong></div>`;
    };

    body.innerHTML = `
      <div class="cmp-section">
        <div class="cmp-section-title">Proyección por diseñador — ${curLabel}</div>
        ${!curSnap ? `<div class="cmp-vel-note">El reporte de ${curLabel} aún no ha sido guardado. Solo se muestra la proyección de ítems activos sin los puntos ya acumulados.</div>` : ''}
        <div class="cmp-legend-row" style="margin-bottom:16px">
          <span class="cmp-leg-dot" style="background:#3b82f6"></span>Actual &nbsp;
          <span class="cmp-leg-dot" style="background:#10b981"></span>Proyectado &nbsp;
          <span class="cmp-leg-dot" style="background:#1a1714;opacity:0.4"></span>Total &nbsp;
          <span style="font-size:11px;color:var(--muted)">| La línea vertical = media histórica del diseñador</span>
        </div>
        <div class="cmp-proj-grid">${designerHtml}</div>
      </div>
      ${riskHtml}
      <div class="cmp-section">
        <div class="cmp-section-title">Resumen del equipo — ${curLabel}</div>
        <div class="cmp-team-summary">
          <div class="cmp-ts-row"><span>Puntos actuales acumulados</span><strong>${fmtNum(totActual)} pts</strong></div>
          <div class="cmp-ts-row"><span>Puntos proyectados restantes</span><strong>+${fmtNum(totProj)} pts</strong></div>
          <div class="cmp-ts-row cmp-ts-total"><span>Total estimado</span><strong>${fmtNum(grandTot)} pts</strong></div>
          ${dRow(bestLbl ? `${bestLbl} (mejor mes)` : null, grandTot, bestTot)}
          ${dRow('media histórica del equipo', grandTot, teamHistMean)}
          <div class="cmp-ts-row"><span>Diseñadores sobre su media histórica</span><strong>${overMean} de ${allNames.length}</strong></div>
          <div class="cmp-ts-row"><span>Ítems en riesgo de no completarse</span><strong>${riskItems.length}</strong></div>
        </div>
      </div>`;
  },

  // ── Helpers ─────────────────────────────────────────────────

  _key(s)  { return `${s.year}_${String(s.month).padStart(2,'0')}`; },

  _monthLabel(month, year) {
    const M = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
               'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${M[month-1]} ${year}`;
  },

  _allDesignerNames(storedList) {
    const set = new Set();
    for (const s of storedList) for (const n of Object.keys(s.designers||{})) set.add(n);
    return [...set].sort();
  },
};
