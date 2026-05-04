// ─────────────────────────────────────────────────────────────
// js/dashboard.js — Historical dashboard (5 analytics panels)
//
// Depends on: config.js, storage.js, charts.js
// ─────────────────────────────────────────────────────────────

const Dashboard = {
  _reports:      [],
  _activePanel:  'trend',
  _hiddenNames:  new Set(),
  _scatterMonth: null,

  // ── Public API ────────────────────────────────────────────

  async render() {
    const all     = await Storage.loadAll();
    this._reports = all.map(s => storedToRender(s));
    const noData  = document.getElementById('dash-no-data');
    const content = document.getElementById('dash-content');

    if (!this._reports.length) {
      if (noData)  noData.style.display  = '';
      if (content) content.style.display = 'none';
      return;
    }
    if (noData)  noData.style.display  = 'none';
    if (content) content.style.display = '';

    this._hiddenNames  = new Set();
    this._scatterMonth = null;
    this._bindTabs();
    this._activatePanel(this._activePanel);
  },

  // ── Tab switching ─────────────────────────────────────────

  _bindTabs() {
    document.querySelectorAll('#dash-tabs .dash-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#dash-tabs .dash-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._activePanel = btn.dataset.panel;
        this._activatePanel(btn.dataset.panel);
      });
    });
  },

  _activatePanel(panel) {
    const allPanels = ['trend','composition','scatter','ranking','heatmap','velocidad','calidad'];
    allPanels.forEach(p => {
      const el = document.getElementById(`panel-${p}`);
      if (el) el.style.display = p === panel ? '' : 'none';
    });
    Charts.destroyAll();
    switch (panel) {
      case 'trend':       this._renderTrend();       break;
      case 'composition': this._renderComp();        break;
      case 'scatter':     this._renderScatter();     break;
      case 'ranking':     this._renderRanking();     break;
      case 'heatmap':     this._renderHeatmap();     break;
      case 'velocidad':   this._renderVelocidad();   break;
      case 'calidad':     this._renderCalidad();     break;
    }
  },

  // ─────────────────────────────────────────────────────────
  // PANEL 1 — Trend
  // ─────────────────────────────────────────────────────────

  _renderTrend() {
    const reports = this._reports;
    const labels  = reports.map(r => monthLabel(r.month, r.year));
    const names   = this._allDesignerNames();

    const series = names.map(name => ({
      name,
      color:   DESIGNER_COLORS[name] || '#888',
      visible: !this._hiddenNames.has(name),
      values:  reports.map(r => { const d = r.designers.find(d => d.name === name); return d ? d.total : null; }),
    }));

    // Build toggle controls
    const ctrl = document.getElementById('trend-controls');
    if (ctrl) {
      ctrl.innerHTML = names.map(name => {
        const color = DESIGNER_COLORS[name] || '#888';
        const active = !this._hiddenNames.has(name);
        return `<button class="ctrl-btn${active ? ' active' : ''}" data-name="${esc(name)}"
          style="border-color:${color};color:${color}">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:4px"></span>${esc(name.split(' ')[0])}
        </button>`;
      }).join('');
      ctrl.querySelectorAll('.ctrl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const n = btn.dataset.name;
          if (this._hiddenNames.has(n)) { this._hiddenNames.delete(n); btn.classList.add('active'); }
          else { this._hiddenNames.add(n); btn.classList.remove('active'); }
          this._renderTrend();
        });
      });
    }

    // Update series visibility after toggle rebuild
    series.forEach(s => { s.visible = !this._hiddenNames.has(s.name); });

    requestAnimationFrame(() => {
      const wrap = document.querySelector('#panel-trend .chart-wrap');
      Charts.line('chart-trend', { labels, series }, {
        width:  wrap ? wrap.clientWidth : 700,
        height: 300,
      });
    });
  },

  // ─────────────────────────────────────────────────────────
  // PANEL 2 — Composition
  // ─────────────────────────────────────────────────────────

  _renderComp() {
    const reports = this._reports;
    const labels  = reports.map(r => monthLabel(r.month, r.year));
    const names   = this._allDesignerNames().filter(n => !this._hiddenNames.has(n));

    const aprobVals = reports.map(r =>
      r.designers.filter(d => names.includes(d.name)).reduce((s, d) => s + d.aTotal, 0));
    const prodVals  = reports.map(r =>
      r.designers.filter(d => names.includes(d.name)).reduce((s, d) => s + d.pTotal, 0));

    // Resolve CSS vars
    const tmp = document.createElement('span');
    document.body.appendChild(tmp);
    tmp.style.color = 'var(--aprob-text)'; const ac = getComputedStyle(tmp).color;
    tmp.style.color = 'var(--prod-text)';  const pc = getComputedStyle(tmp).color;
    document.body.removeChild(tmp);

    const ctrl = document.getElementById('comp-controls');
    if (ctrl) {
      ctrl.innerHTML = names.map(name => {
        const color = DESIGNER_COLORS[name] || '#888';
        return `<button class="ctrl-btn active" data-name="${esc(name)}"
          style="border-color:${color};color:${color}">
          <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:4px"></span>${esc(name.split(' ')[0])}
        </button>`;
      }).join('');
      ctrl.querySelectorAll('.ctrl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const n = btn.dataset.name;
          if (this._hiddenNames.has(n)) { this._hiddenNames.delete(n); btn.classList.add('active'); }
          else { this._hiddenNames.add(n); btn.classList.remove('active'); }
          this._renderComp();
        });
      });
    }

    requestAnimationFrame(() => {
      const wrap = document.querySelector('#panel-composition .chart-wrap');
      Charts.bar('chart-composition', {
        labels, mode: 'stacked',
        groups: [
          { label: 'Aprobación', color: ac || '#1a4fa0', values: aprobVals },
          { label: 'Producción', color: pc || '#15683a', values: prodVals  },
        ],
      }, { width: wrap ? wrap.clientWidth : 700, height: 300 });
    });
  },

  // ─────────────────────────────────────────────────────────
  // PANEL 3 — Scatter
  // ─────────────────────────────────────────────────────────

  _renderScatter() {
    const reports = this._reports;
    const names   = this._allDesignerNames().filter(n => !this._hiddenNames.has(n));

    const ctrl = document.getElementById('scatter-controls');
    if (ctrl) {
      const monthBtns = reports.map(r => {
        const key = `${r.year}_${String(r.month).padStart(2,'0')}`;
        const sel = this._scatterMonth === key;
        return `<button class="ctrl-btn${sel ? ' active' : ''}" data-mkey="${key}">${monthLabel(r.month, r.year)}</button>`;
      }).join('');
      ctrl.innerHTML =
        `<button class="ctrl-btn${!this._scatterMonth ? ' active' : ''}" data-mkey="">Promedio</button>${monthBtns}`;
      ctrl.querySelectorAll('.ctrl-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          this._scatterMonth = btn.dataset.mkey || null;
          this._renderScatter();
        });
      });
    }

    const points = [];
    for (const name of names) {
      let sub = reports;
      if (this._scatterMonth) {
        const [sy, sm] = this._scatterMonth.split('_').map(Number);
        sub = reports.filter(r => r.year === sy && r.month === sm);
      }
      const rel = sub.map(r => r.designers.find(d => d.name === name)).filter(Boolean);
      if (!rel.length) continue;
      const avgItems  = rel.reduce((s, d) => s + d.itemCount, 0) / rel.length;
      const avgPts    = rel.reduce((s, d) => s + d.total,     0) / rel.length;
      const avgCmplx  = avgItems > 0 ? avgPts / avgItems : 0;
      points.push({
        name, color: DESIGNER_COLORS[name] || '#888',
        x: parseFloat(avgItems.toFixed(1)),
        y: parseFloat(avgCmplx.toFixed(2)),
        r: parseFloat(avgPts.toFixed(1)),
        label: this._scatterMonth
          ? monthLabel(...this._scatterMonth.split('_').map(Number).reverse())
          : 'Promedio',
      });
    }

    requestAnimationFrame(() => {
      const wrap = document.querySelector('#panel-scatter .chart-wrap');
      Charts.scatter('chart-scatter', { points }, {
        width: wrap ? wrap.clientWidth : 700, height: 320,
        xLabel: 'Ítems promedio', yLabel: 'Pts / ítem',
      });
    });
  },

  // ─────────────────────────────────────────────────────────
  // PANEL 4 — Ranking table
  // ─────────────────────────────────────────────────────────

  _renderRanking() {
    const wrap = document.getElementById('ranking-wrap');
    if (!wrap) return;
    const reports = this._reports;
    const names   = this._allDesignerNames();

    const rows = names.map(name => {
      const monthly = reports.map(r => r.designers.find(d => d.name === name));
      const active  = monthly.filter(Boolean);
      if (!active.length) return null;
      const totalPts   = active.reduce((s, d) => s + d.total,  0);
      const totalAprob = active.reduce((s, d) => s + d.aTotal, 0);
      const totalProd  = active.reduce((s, d) => s + d.pTotal, 0);
      const avgPts     = totalPts / reports.length;
      const bestD      = active.reduce((m, d) => d.total > m.total ? d : m, active[0]);
      const bestIdx    = monthly.indexOf(bestD);
      const bestLbl    = bestIdx !== -1 ? monthLabel(reports[bestIdx].month, reports[bestIdx].year) : '—';
      return { name, totalPts, totalAprob, totalProd, avgPts, activeMonths: active.length, bestLbl };
    }).filter(Boolean).sort((a, b) => b.totalPts - a.totalPts);

    wrap.innerHTML = `
      <table class="ranking-table">
        <thead><tr>
          <th>#</th><th>Diseñador</th><th>Total pts</th>
          <th>Aprob</th><th>Prod</th><th>Prom/mes</th>
          <th>Meses activos</th><th>Mejor mes</th>
        </tr></thead>
        <tbody>${rows.map((r, i) => {
          const color = DESIGNER_COLORS[r.name] || '#888';
          return `<tr>
            <td style="color:var(--muted)">${i + 1}</td>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${esc(r.name)}</td>
            <td><strong>${fmtNum(r.totalPts)}</strong></td>
            <td>${fmtNum(r.totalAprob)}</td><td>${fmtNum(r.totalProd)}</td>
            <td>${fmtNum(r.avgPts)}</td>
            <td style="text-align:center">${r.activeMonths}</td>
            <td style="color:var(--muted)">${esc(r.bestLbl)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  },

  // ─────────────────────────────────────────────────────────
  // PANEL 5 — Heatmap
  // ─────────────────────────────────────────────────────────

  _renderHeatmap() {
    const wrap   = document.getElementById('heatmap-wrap');
    const detail = document.getElementById('heatmap-detail');
    if (!wrap) return;
    const reports = this._reports;
    const names   = this._allDesignerNames().filter(n => !this._hiddenNames.has(n));
    const labels  = reports.map(r => monthLabel(r.month, r.year));

    let globalMax = 0;
    for (const r of reports) for (const d of r.designers) globalMax = Math.max(globalMax, d.total);

    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table class="heatmap-table">
          <thead><tr>
            <th></th>${labels.map(l => `<th>${esc(l)}</th>`).join('')}<th>Total</th>
          </tr></thead>
          <tbody>${names.map(name => {
            const color = DESIGNER_COLORS[name] || '#888';
            let rowTotal = 0;
            const cells = reports.map(r => {
              const d  = r.designers.find(d => d.name === name);
              const v  = d ? d.total : null;
              if (v != null) rowTotal += v;
              const intensity = (v != null && globalMax > 0) ? v / globalMax : 0;
              const bg  = v != null ? `rgba(${hexToRgb(color)},${(0.08 + intensity * 0.72).toFixed(2)})` : 'transparent';
              const key = `${r.year}_${String(r.month).padStart(2,'0')}`;
              return `<td class="hm-cell" style="background:${bg}" data-name="${esc(name)}" data-key="${key}" data-val="${v ?? ''}">${v != null ? fmtNum(v) : '—'}</td>`;
            }).join('');
            return `<tr>
              <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${esc(name.split(' ')[0])}</td>
              ${cells}<td style="font-weight:600">${fmtNum(rowTotal)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;

    wrap.querySelectorAll('.hm-cell').forEach(cell => {
      if (!cell.dataset.val) return;
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => {
        const name = cell.dataset.name;
        const [sy, sm] = cell.dataset.key.split('_').map(Number);
        const r = reports.find(r => r.year === sy && r.month === sm);
        if (!r || !detail) return;
        const d = r.designers.find(d => d.name === name);
        if (!d) return;
        const color = DESIGNER_COLORS[name] || '#888';
        detail.style.display = 'block';
        detail.innerHTML = `
          <div class="heatmap-detail-header">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>
            <strong>${esc(name)}</strong> — ${monthLabel(sm, sy)}
            <button class="hm-close" onclick="this.closest('#heatmap-detail').style.display='none'">✕</button>
          </div>
          <div class="heatmap-detail-stats">
            <span>Total: <strong>${fmtNum(d.total)}</strong></span>
            <span>Aprob: <strong>${fmtNum(d.aTotal)}</strong></span>
            <span>Prod: <strong>${fmtNum(d.pTotal)}</strong></span>
            <span>Ítems: <strong>${d.itemCount}</strong></span>
          </div>`;
      });
    });
  },

  // ─────────────────────────────────────────────────────────
  // PANEL 6 — Velocidad del equipo (unique items over time)
  // ─────────────────────────────────────────────────────────

  _renderVelocidad() {
    const reports = this._reports;
    const labels  = reports.map(r => monthLabel(r.month, r.year));
    const values  = reports.map(r => r.metrics.uniqueItems || 0);

    requestAnimationFrame(() => {
      const wrap = document.querySelector('#panel-velocidad .chart-wrap');
      Charts.line('chart-velocidad', {
        labels,
        series: [{ name: 'Equipo', color: '#185FA5', visible: true, values }],
      }, {
        width:  wrap ? wrap.clientWidth : 700,
        height: 300,
        yLabel: 'Ítems únicos',
      });
    });
  },

  // ─────────────────────────────────────────────────────────
  // PANEL 7 — Calidad de entrega (avg corrections / item)
  // ─────────────────────────────────────────────────────────

  _renderCalidad() {
    const reports = this._reports;
    const labels  = reports.map(r => monthLabel(r.month, r.year));
    const values  = reports.map(r => r.metrics.avgCorrections || 0);

    // All-time average as reference line
    const validVals = values.filter(v => v > 0);
    const allTimeAvg = validVals.length
      ? parseFloat((validVals.reduce((s, v) => s + v, 0) / validVals.length).toFixed(3))
      : null;

    requestAnimationFrame(() => {
      const wrap = document.querySelector('#panel-calidad .chart-wrap');
      Charts.line('chart-calidad', {
        labels,
        series: [{ name: 'Correcciones / ítem', color: '#e67e22', visible: true, values }],
      }, {
        width:        wrap ? wrap.clientWidth : 700,
        height:       300,
        refLine:      allTimeAvg,
        refLineColor: '#6b6660',
        refLineLabel: allTimeAvg != null ? `Promedio ${fmtNum(allTimeAvg)}` : null,
        yLabel:       'Correcciones por ítem',
      });
    });
  },

  // ── Helpers ───────────────────────────────────────────────

  _allDesignerNames() {
    const set = new Set();
    for (const r of this._reports) for (const d of r.designers) set.add(d.name);
    return [...set].sort();
  },
};

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
