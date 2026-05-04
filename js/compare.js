// ─────────────────────────────────────────────────────────────
// js/compare.js — Month comparison screen
//
// Depends on: config.js, storage.js, charts.js
// ─────────────────────────────────────────────────────────────

const Compare = {
  _stored:    [],
  _selected:  [],
  _activeTab: 'radar',

  // ── Public API ────────────────────────────────────────────

  async render() {
    this._stored = await Storage.loadAll();
    Charts.destroyAll();

    const noData  = document.getElementById('compare-no-data');
    const content = document.getElementById('compare-content');
    const picker  = document.getElementById('compare-picker');

    if (this._stored.length < 2) {
      if (noData)  noData.style.display  = '';
      if (content) content.style.display = 'none';
      if (picker)  picker.innerHTML = '';
      return;
    }
    if (noData) noData.style.display = 'none';

    // Default selection: last 2 months
    if (!this._selected.length || !this._selected.every(k => this._stored.some(s => this._key(s) === k))) {
      this._selected = this._stored.slice(-2).map(s => this._key(s));
    }

    this._renderPicker();
    this._renderContent();

    // Bind tab buttons
    document.querySelectorAll('[data-ctab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ctab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._activeTab = btn.dataset.ctab;
        this._switchTab(btn.dataset.ctab);
      });
    });
  },

  // ── Month picker chips ────────────────────────────────────

  _renderPicker() {
    const picker = document.getElementById('compare-picker');
    if (!picker) return;
    picker.innerHTML =
      `<span style="font-size:12px;color:var(--muted);margin-right:8px;align-self:center">Seleccionar meses (2–4):</span>` +
      this._stored.map(s => {
        const key = this._key(s);
        const sel = this._selected.includes(key);
        return `<button class="pick-chip${sel ? ' selected' : ''}" data-key="${key}">
          ${esc(monthLabel(s.month, s.year))}
          <span class="mode-badge mode-${(s.mode || 'a').toLowerCase()}">${s.mode || 'A'}</span>
        </button>`;
      }).join('');

    picker.querySelectorAll('.pick-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const idx = this._selected.indexOf(key);
        if (idx !== -1) {
          if (this._selected.length <= 2) return;
          this._selected.splice(idx, 1);
          btn.classList.remove('selected');
        } else {
          if (this._selected.length >= 4) return;
          this._selected.push(key);
          btn.classList.add('selected');
        }
        this._renderContent();
      });
    });
  },

  // ── Main content ──────────────────────────────────────────

  _renderContent() {
    const content = document.getElementById('compare-content');
    if (!content) return;
    Charts.destroyAll();

    if (this._selected.length < 2) {
      content.style.display = 'none';
      return;
    }
    content.style.display = '';

    const snapshots = this._selected
      .map(key => this._stored.find(s => this._key(s) === key))
      .filter(Boolean)
      .map(s => ({ stored: s, report: storedToRender(s), label: monthLabel(s.month, s.year) }));

    // Activate current tab
    this._switchTab(this._activeTab, snapshots);
  },

  _switchTab(tab, snapshots) {
    ['radar','bars','delta'].forEach(t => {
      const el = document.getElementById(`ctab-${t}`);
      if (el) el.style.display = t === tab ? '' : 'none';
    });

    if (!snapshots) {
      snapshots = this._selected
        .map(key => this._stored.find(s => this._key(s) === key))
        .filter(Boolean)
        .map(s => ({ stored: s, report: storedToRender(s), label: monthLabel(s.month, s.year) }));
    }
    if (snapshots.length < 2) return;
    const allNames = this._allDesignerNames(snapshots.map(s => s.report));

    switch (tab) {
      case 'radar': this._renderRadarGrid(snapshots, allNames); break;
      case 'bars':  requestAnimationFrame(() => this._renderCompareBar(snapshots, allNames)); break;
      case 'delta': this._renderDeltaTable(snapshots, allNames); break;
    }
  },

  // ── Radar grid ────────────────────────────────────────────

  _renderRadarGrid(snapshots, allNames) {
    const grid = document.getElementById('radar-grid');
    if (!grid) return;
    const axes = snapshots.map(s => s.label);

    grid.innerHTML = allNames.map(name =>
      `<div class="radar-cell">
        <div class="radar-name" style="color:${DESIGNER_COLORS[name] || '#888'}">${esc(name.split(' ')[0])}</div>
        <canvas class="radar-canvas" data-name="${esc(name)}"></canvas>
       </div>`
    ).join('');

    grid.querySelectorAll('.radar-canvas').forEach(canvas => {
      const name   = canvas.dataset.name;
      const values = snapshots.map(s => { const d = s.report.designers.find(d => d.name === name); return d ? d.total : 0; });
      Charts.radar(canvas, {
        axes,
        series: [{ label: name, color: DESIGNER_COLORS[name] || '#888', values }],
      }, { size: 200 });
    });
  },

  // ── Grouped bar chart ─────────────────────────────────────

  _renderCompareBar(snapshots, allNames) {
    const wrap = document.querySelector('#ctab-bars .chart-wrap');
    const W    = wrap ? wrap.clientWidth : 700;
    const palette = ['#1a4fa0','#15683a','#e67e22','#9b59b6'];

    Charts.bar('chart-compare-bars', {
      labels: allNames.map(n => n.split(' ')[0]),
      mode:   'grouped',
      groups: snapshots.map((s, i) => ({
        label:  s.label,
        color:  palette[i % palette.length],
        values: allNames.map(name => { const d = s.report.designers.find(d => d.name === name); return d ? d.total : 0; }),
      })),
    }, { width: W, height: 300 });
  },

  // ── Delta table ───────────────────────────────────────────

  _renderDeltaTable(snapshots, allNames) {
    const wrap = document.getElementById('delta-wrap');
    if (!wrap) return;
    const n = snapshots.length;

    const nameRows = allNames.map(name => {
      const vals  = snapshots.map(s => { const d = s.report.designers.find(d => d.name === name); return d ? d.total : null; });
      const first = vals.find(v => v != null);
      const last  = [...vals].reverse().find(v => v != null);
      const delta = (first != null && last != null) ? last - first : null;
      return { name, vals, delta };
    }).sort((a, b) => {
      if (a.delta == null && b.delta == null) return 0;
      if (a.delta == null) return 1;
      if (b.delta == null) return -1;
      return b.delta - a.delta;
    });

    const deltaHdr = n >= 2
      ? `<th>Δ ${esc(snapshots[0].label)} → ${esc(snapshots[n-1].label)}</th>` : '';

    wrap.innerHTML = `
      <table class="delta-table">
        <thead><tr>
          <th>Diseñador</th>
          ${snapshots.map(s => `<th>${esc(s.label)}</th>`).join('')}
          ${deltaHdr}
        </tr></thead>
        <tbody>${nameRows.map(({ name, vals, delta }) => {
          const color  = DESIGNER_COLORS[name] || '#888';
          const dStyle = delta == null ? '' : delta > 0 ? 'color:var(--above-text)' : delta < 0 ? 'color:var(--below-text)' : '';
          const dText  = delta == null ? '—' : delta > 0 ? `+${fmtNum(delta)} ↑` : delta < 0 ? `${fmtNum(delta)} ↓` : '0';
          return `<tr>
            <td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${esc(name)}</td>
            ${vals.map(v => `<td>${v != null ? fmtNum(v) : '<span style="color:var(--faint)">—</span>'}</td>`).join('')}
            ${n >= 2 ? `<td style="${dStyle}"><strong>${dText}</strong></td>` : ''}
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  },

  // ── Helpers ───────────────────────────────────────────────

  _key(stored) {
    return `${stored.year}_${String(stored.month).padStart(2, '0')}`;
  },

  _allDesignerNames(reports) {
    const set = new Set();
    for (const r of reports) for (const d of r.designers) set.add(d.name);
    return [...set].sort();
  },
};
