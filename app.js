/* Minimal client-side ODI map using plain SVG and CSV upload */
(function() {
  const COL_VOLUME = 'Qual o volume de pedidos mensal da sua empresa?';
  const COL_CANAL = 'Como a sua empresa realiza vendas atualmente??';
  const IMPORT_PREFIX = 'Importância - ';
  const SAT_OK = 'Satisfação - ';
  const SAT_TYPO = 'Satistação - ';

  const fileInput = document.getElementById('fileInput');
  const demoBtn = document.getElementById('demoBtn');
  const volumeSelect = document.getElementById('volumeSelect');
  const canalSelect = document.getElementById('canalSelect');
  const outcomeSearch = document.getElementById('outcomeSearch');
  const resetBtn = document.getElementById('resetBtn');
  const exportBtn = document.getElementById('exportBtn');
  const chartDiv = document.getElementById('chart');
  const tableBody = document.querySelector('#resultsTable tbody');
  const statusCount = document.getElementById('statusCount');
  const statusNote = document.getElementById('statusNote');
  const loadingEl = document.getElementById('loading');
  const emptyEl = document.getElementById('empty');
  const table = document.getElementById('resultsTable');
  const activeFiltersEl = document.getElementById('activeFilters');
  const toastContainer = document.getElementById('toastContainer');

  let rawRows = [];
  let columns = [];
  let results = [];
  let sortKey = 'os';
  let sortDir = 'desc';

  // Utils
  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }
  function normalizeSpaces(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function uniqueSorted(arr) { return Array.from(new Set(arr.filter(v => v != null && String(v).trim() !== '').map(String))).sort((a, b) => a.localeCompare(b)); }
  function toNumber(v) { if (v == null) return NaN; const s = String(v).trim(); if (!s) return NaN; const n = parseFloat(s.replace(',', '.')); return isNaN(n) ? NaN : n; }
  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }
  // Sistema de Toast
  function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${escapeHtml(message)}</span>
      <button class="toast-close" aria-label="Fechar notificação">×</button>
    `;
    
    // Adicionar evento de fechar
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toast));
    
    // Adicionar ao container
    toastContainer.appendChild(toast);
    
    // Auto-remover após duração
    if (duration > 0) {
      setTimeout(() => removeToast(toast), duration);
    }
    
    return toast;
  }
  
  function removeToast(toast) {
    if (!toast || !toast.parentNode) return;
    
    toast.classList.add('removing');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }
  
  function notify(msg, type = 'info') { 
    if (msg) {
      showToast(msg, type);
    }
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  function setBusy(b) { [fileInput, demoBtn, volumeSelect, canalSelect, outcomeSearch, resetBtn, exportBtn].forEach(el => { if (el) el.disabled = b; }); if (b) show(loadingEl); else hide(loadingEl); }

  // CSV parsing
  function splitCSVLine(line) {
    const out = [], n = line.length;
    let cur = '', inQ = false;
    for (let i = 0; i < n; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }
  function parseCSV(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter(Boolean);
    if (!lines.length) return { header: [], rows: [] };
    const header = splitCSVLine(lines[0]);
    const rows = lines.slice(1).map(splitCSVLine).filter(r => r.length > 1);
    return { header, rows };
  }
  function csvToObjects(header, rows) {
    const normHeader = header.map(normalizeSpaces);
    return rows.map(r => {
      const obj = {};
      for (let i = 0; i < normHeader.length; i++) obj[normHeader[i]] = r[i];
      return obj;
    });
  }

  // Data logic
  function detectPairs(cols) {
    const importanceCols = cols.filter(c => c.startsWith(IMPORT_PREFIX));
    const pairs = [];
    for (const imp of importanceCols) {
      const label = imp.slice(IMPORT_PREFIX.length).trim();
      const candidates = [`${SAT_OK}${label}`, `${SAT_TYPO}${label}`];
      let sat = candidates.find(c => cols.includes(c));
      if (!sat) {
        sat = cols.find(c => (c.startsWith(SAT_OK) || c.startsWith(SAT_TYPO)) && c.split('-', 1)[1]?.trim() === label);
      }
      if (sat) pairs.push({ label, imp, sat });
    }
    return pairs;
  }

  function compute(pairs, rows, scaleMin) {
    const recs = [];
    for (const { label, imp, sat } of pairs) {
      const impVals = rows.map(r => toNumber(r[imp])).filter(v => !Number.isNaN(v));
      const satVals = rows.map(r => toNumber(r[sat])).filter(v => !Number.isNaN(v));
      if (impVals.length === 0 && satVals.length === 0) continue;
      const impMean = impVals.reduce((a, b) => a + b, 0) / (impVals.length || 1);
      const satMean = satVals.reduce((a, b) => a + b, 0) / (satVals.length || 1);
      const I = impMean; // Importância sempre considerada na escala 0–10
      const S = satMean; // Satisfação na escala 0–10
      const OS = 2 * I - S;
      const underservedBoundary = 2 * I - 10; // y = 2x - 10
      const seg = (S > I) ? 'OVER-SERVED' : (S < underservedBoundary ? 'UNDER-SERVED' : 'APPROPRIATELY-SERVED');
      recs.push({ outcome: label, importancia: I, satisfacao: S, os: OS, segment: seg });
    }
    recs.sort((a, b) => b.os - a.os);
    return recs;
  }

  function populateFilters(rows) {
    const volumes = ['__ALL__', ...uniqueSorted(rows.map(r => r[COL_VOLUME]))];
    volumeSelect.innerHTML = volumes.map(v => `<option value="${escapeHtml(v)}">${v === '__ALL__' ? 'Todos' : escapeHtml(v)}</option>`).join('');
    const canais = ['__ALL__', ...uniqueSorted(rows.map(r => r[COL_CANAL]))];
    canalSelect.innerHTML = canais.map(v => `<option value="${escapeHtml(v)}">${v === '__ALL__' ? 'Todos' : escapeHtml(v)}</option>`).join('');
    restoreFilterState();
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch])); }

  function applyFilters(rows) {
    const v = volumeSelect.value;
    const c = canalSelect.value;
    let out = [...rows];
    if (v && v !== '__ALL__') out = out.filter(r => String(r[COL_VOLUME]) === v);
    if (c && c !== '__ALL__') out = out.filter(r => String(r[COL_CANAL]) === c);
    return out;
  }

  // UI rendering
  function renderStatus(filteredRows) {
    const n = filteredRows.length;
    statusCount.textContent = `${n} ${n === 1 ? 'resposta' : 'respostas'} filtradas`;
    statusNote.textContent = outcomeSearch.value ? 'Busca ativa' : '';
  }

  function renderActiveFilters() {
    const filters = [];
    
    // Volume filter
    if (volumeSelect.value && volumeSelect.value !== '__ALL__') {
      filters.push({
        type: 'volume',
        label: 'Volume',
        value: volumeSelect.value,
        remove: () => { volumeSelect.value = '__ALL__'; update(); }
      });
    }
    
    // Canal filter
    if (canalSelect.value && canalSelect.value !== '__ALL__') {
      filters.push({
        type: 'canal',
        label: 'Canal',
        value: canalSelect.value,
        remove: () => { canalSelect.value = '__ALL__'; update(); }
      });
    }
    
    // Search filter
    if (outcomeSearch.value && outcomeSearch.value.trim()) {
      filters.push({
        type: 'search',
        label: 'Busca',
        value: outcomeSearch.value.trim(),
        remove: () => { outcomeSearch.value = ''; update(); }
      });
    }
    
    // Render tags
    activeFiltersEl.innerHTML = filters.map(filter => `
      <div class="filter-tag" data-type="${filter.type}">
        <span>${filter.label}: ${escapeHtml(filter.value)}</span>
        <span class="tag-remove" onclick="${filter.remove}">×</span>
      </div>
    `).join('');
    
    // Add click handlers for remove buttons
    activeFiltersEl.querySelectorAll('.tag-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tag = e.target.closest('.filter-tag');
        const type = tag.dataset.type;
        
        if (type === 'volume') {
          volumeSelect.value = '__ALL__';
        } else if (type === 'canal') {
          canalSelect.value = '__ALL__';
        } else if (type === 'search') {
          outcomeSearch.value = '';
        }
        
        update();
      });
    });
  }
  function renderEmptyState(recs) { if (!recs.length) { show(emptyEl); } else hide(emptyEl); }

  function renderTable(recs) {
    const q = outcomeSearch.value.trim().toLowerCase();
    let data = q ? recs.filter(r => r.outcome.toLowerCase().includes(q)) : recs;
    data = sortData(data);
    tableBody.innerHTML = data.map(r => `
      <tr>
        <td>${escapeHtml(r.outcome)}</td>
        <td>${r.importancia.toFixed(2)}</td>
        <td>${r.satisfacao.toFixed(2)}</td>
        <td>${r.os.toFixed(2)}</td>
        <td>${r.segment}</td>
      </tr>
    `).join('');
  }

  function sortData(arr) {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
  function setSort(th) {
    $all('#resultsTable thead th').forEach(h => h.setAttribute('aria-sort', 'none'));
    const key = th.getAttribute('data-key');
    if (sortKey === key) {
      sortDir = (sortDir === 'asc') ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = 'asc';
    }
    th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
    renderTable(results);
  }

  function el(tag, attrs, text) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, String(v)));
    if (text != null) n.appendChild(document.createTextNode(text));
    return n;
  }

  function renderChart(recs) {
    const q = outcomeSearch.value.trim().toLowerCase();
    const data = q ? recs.filter(r => r.outcome.toLowerCase().includes(q)) : recs;
    chartDiv.innerHTML = '';
    const w = chartDiv.clientWidth || 1000, h = chartDiv.clientHeight || 520;
    const m = { l: 60, r: 20, t: 20, b: 44 }, iw = w - m.l - m.r, ih = h - m.t - m.b;
    const xMin = 0, xMax = 10, yMin = 0, yMax = 10;
    const sx = v => m.l + (v - xMin) / (xMax - xMin) * iw;
    const sy = v => m.t + ih - (v - yMin) / (yMax - yMin) * ih;

    const svg = el('svg', { viewBox: `0 0 ${w} ${h}`, role: 'presentation' });

    // grid
    const grid = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grid.setAttribute('class', 'grid');
    for (let t = xMin; t <= xMax; t += 1) {
      grid.appendChild(el('line', { x1: sx(t), y1: sy(yMin), x2: sx(t), y2: sy(yMax) }));
      grid.appendChild(el('line', { x1: sx(xMin), y1: sy(t), x2: sx(xMax), y2: sy(t) }));
    }
    svg.appendChild(grid);

    // axes
    svg.appendChild(el('line', { class: 'axis', x1: sx(xMin), y1: sy(yMin), x2: sx(xMax), y2: sy(yMin) }));
    for (let t = xMin; t <= xMax; t += 1) {
      svg.appendChild(el('line', { class: 'axis', x1: sx(t), y1: sy(yMin) - 4, x2: sx(t), y2: sy(yMin) + 4 }));
      svg.appendChild(el('text', { class: 'axis', x: sx(t), y: sy(yMin) + 20, 'text-anchor': 'middle' }, String(t)));
    }
    svg.appendChild(el('line', { class: 'axis', x1: sx(xMin), y1: sy(yMin), x2: sx(xMin), y2: sy(yMax) }));
    for (let t = yMin; t <= yMax; t += 1) {
      svg.appendChild(el('line', { class: 'axis', x1: sx(xMin) - 4, y1: sy(t), x2: sx(xMin) + 4, y2: sy(t) }));
      svg.appendChild(el('text', { class: 'axis', x: sx(xMin) - 10, y: sy(t) + 4, 'text-anchor': 'end' }, String(t)));
    }
    // diagonals (limitadas à área visível)
    // y = x
    const t0 = Math.max(xMin, yMin);
    svg.appendChild(el('line', { class: 'diag', x1: sx(t0), y1: sy(t0), x2: sx(xMax), y2: sy(xMax) }));
    // y = 2x - 10 (linha de under-served)
    const xStartUS = Math.max(xMin, (yMin + 10) / 2);
    const yStartUS = 2 * xStartUS - 10;
    const yEndUS = 2 * xMax - 10;
    svg.appendChild(el('line', { class: 'diag-1', x1: sx(xStartUS), y1: sy(yStartUS), x2: sx(xMax), y2: sy(yEndUS) }));

    // tooltip and keyboard support
    const tip = document.createElement('div');
    tip.className = 'tooltip';
    chartDiv.appendChild(tip);
    function showTip(html, x, y) {
      const rect = chartDiv.getBoundingClientRect();
      tip.style.display = 'block';
      tip.innerHTML = html;
      tip.style.left = (x - rect.left + 12) + 'px';
      tip.style.top = (y - rect.top + 12) + 'px';
    }
    function hideTip() { tip.style.display = 'none'; }

    for (const r of data) {
      const cls = r.segment === 'OVER-SERVED' ? 'over' : (r.segment === 'UNDER-SERVED' ? 'under' : 'ok');
      const cx = sx(r.importancia), cy = sy(r.satisfacao);
      const dot = el('circle', { class: `dot ${cls}`, cx, cy, r: 6, tabindex: '0', role: 'button', 'aria-label': `${r.outcome}. I ${r.importancia.toFixed(2)}, S ${r.satisfacao.toFixed(2)}, OS ${r.os.toFixed(2)}, ${r.segment}` });
      dot.addEventListener('mouseenter', ev => showTip(`<div class="tip-title">${escapeHtml(r.outcome)}</div><div class="tip-metrics">I: ${r.importancia.toFixed(2)} · S: ${r.satisfacao.toFixed(2)} · OS: ${r.os.toFixed(2)} · ${r.segment}</div>`, ev.clientX, ev.clientY));
      dot.addEventListener('mousemove', ev => showTip(tip.innerHTML, ev.clientX, ev.clientY));
      dot.addEventListener('mouseleave', hideTip);
      dot.addEventListener('focus', () => {
        statusNote.textContent = `${r.outcome}: I ${r.importancia.toFixed(2)}, S ${r.satisfacao.toFixed(2)}, OS ${r.os.toFixed(2)}. ${r.segment}`;
      });
      dot.addEventListener('blur', () => { statusNote.textContent = ''; });
      dot.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          const rect = chartDiv.getBoundingClientRect();
          showTip(`<div class="tip-title">${escapeHtml(r.outcome)}</div><div class="tip-metrics">I: ${r.importancia.toFixed(2)} · S: ${r.satisfacao.toFixed(2)} · OS: ${r.os.toFixed(2)} · ${r.segment}</div>`, rect.left + cx, rect.top + cy);
        }
        if (ev.key === 'Escape') { hideTip(); }
      });
      svg.appendChild(dot);
    }
    chartDiv.appendChild(svg);
  }

  function update() {
    const pairs = detectPairs(columns);
    const filtered = applyFilters(rawRows);
    renderStatus(filtered);
    renderActiveFilters();
    results = compute(pairs, filtered, 0);
    renderEmptyState(results);
    renderTable(results);
    renderChart(results);
    saveFilterState();
    notify('', 'info');
  }

  function exportCSV() {
    const q = outcomeSearch.value.trim().toLowerCase();
    const data = q ? results.filter(r => r.outcome.toLowerCase().includes(q)) : results;
    if (!data.length) { notify('Nada para exportar com os filtros atuais.', 'error'); return; }
    const header = ['Outcome', 'Importância', 'Satisfação', 'Opportunity_Score', 'Segment'];
    const rows = data.map(r => [r.outcome, r.importancia.toFixed(2), r.satisfacao.toFixed(2), r.os.toFixed(2), r.segment]);
    const csv = [header, ...rows].map(r => r.map(toCsvCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'odi_opportunity_scores.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function toCsvCell(v) { const s = String(v); return (s.includes('"') || s.includes(',') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  async function loadFromJson() {
    setBusy(true);
    try {
      const res = await fetch('data.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('data.json não encontrado');
      const json = await res.json();
      const list = Array.isArray(json) ? json : (Array.isArray(json.rows) ? json.rows : []);
      if (!list.length) throw new Error('JSON vazio');
      // Normaliza chaves e monta columns/rawRows compatíveis
      const allKeys = new Set();
      const normalizedRows = list.map(r => {
        const o = {};
        Object.keys(r).forEach(k => {
          const nk = normalizeSpaces(k);
          allKeys.add(nk);
          o[nk] = r[k];
        });
        return o;
      });
      columns = Array.from(allKeys);
      rawRows = normalizedRows;
      if (!columns.includes(COL_VOLUME)) notify(`Coluna não encontrada: "${COL_VOLUME}".`, 'error');
      populateFilters(rawRows);
      update();
      notify('Dados carregados de data.json.', 'success');
    } catch (e) {
      notify('Falha ao carregar data.json. Usando dados de demonstração.', 'info');
      loadDemo();
    } finally {
      setBusy(false);
    }
  }

  function handleFile(file) {
    if (!file || !/\.csv$/i.test(file.name)) { notify('Selecione um arquivo .csv válido.', 'error'); return; }
    setBusy(true);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { header, rows } = parseCSV(reader.result);
        if (!header.length) { throw new Error('Cabeçalho não encontrado.'); }
        columns = header.map(normalizeSpaces);
        rawRows = csvToObjects(header, rows).map(r => {
          const o = {};
          Object.keys(r).forEach(k => o[normalizeSpaces(k)] = r[k]);
          return o;
        });
        if (!columns.includes(COL_VOLUME)) notify(`Coluna não encontrada: "${COL_VOLUME}".`, 'error');
        populateFilters(rawRows);
        update();
        notify('Arquivo carregado com sucesso.', 'success');
      } catch (e) {
        notify('Erro ao processar CSV: ' + (e?.message || e), 'error');
      }
      setBusy(false);
    };
    reader.onerror = () => { notify('Falha ao ler o arquivo.', 'error'); setBusy(false); };
    reader.readAsText(file, 'utf-8');
  }

  // Filter state persistence
  function saveFilterState() {
    try {
      localStorage.setItem('odi.filters', JSON.stringify({ v: volumeSelect.value, c: canalSelect.value, s: outcomeSearch.value }));
    } catch {}
  }
  function restoreFilterState() {
    try {
      const raw = localStorage.getItem('odi.filters');
      if (!raw) return;
      const f = JSON.parse(raw);
      if (f.v) volumeSelect.value = f.v;
      if (f.c) canalSelect.value = f.c;
      if (typeof f.s === 'string') outcomeSearch.value = f.s;
    } catch {}
  }

  // Demo data
  function loadDemo() {
    const demo = [
      ['Submission ID', 'Respondent ID', 'Submitted at', 'idEmpresa', 'idUsuario', 'Qual é a sua função na empresa?', 'Qual o volume de pedidos mensal da sua empresa?', 'Como a sua empresa realiza vendas atualmente??', 'Importância - Minimizar erros', 'Satisfação - Minimizar erros', 'Importância - Minimizar tempo', 'Satistação - Minimizar tempo', 'Importância - Minimizar custos', 'Satisfação - Minimizar custos'],
      ['1', 'A', '2025-10-01', 'x', 'y', 'Resp. Financeiro', 'Até 200 pedidos', 'Ambos os canais (online e offline)', '9', '6', '8', '7', '10', '6'],
      ['2', 'B', '2025-10-02', 'x', 'y', 'Sócio', 'Entre 200 e 2.000', 'Apenas online (e-commerce, redes sociais, marketplaces etc.)', '8', '7', '9', '6', '10', '5'],
      ['3', 'C', '2025-10-03', 'x', 'y', 'Resp. Financeiro', 'Entre 200 e 2.000', 'Ambos os canais (online e offline)', '7', '5', '9', '6', '9', '5']
    ];
    const text = demo.map(r => r.join(',')).join('\n');
    const { header, rows } = parseCSV(text);
    columns = header.map(normalizeSpaces);
    rawRows = csvToObjects(header, rows).map(r => {
      const o = {};
      Object.keys(r).forEach(k => o[normalizeSpaces(k)] = r[k]);
      return o;
    });
    populateFilters(rawRows);
    update();
    notify('Dados de demonstração carregados.', 'success');
  }

  // Events
  fileInput.addEventListener('change', e => {
    const file = e.target.files && e.target.files[0];
    if (file) handleFile(file);
  });
  demoBtn.addEventListener('click', loadDemo);
  // Debounce na busca para reduzir repaints
  const onInputDebounced = debounce(update, 120);
  [volumeSelect, canalSelect].forEach(el => el.addEventListener('input', update));
  outcomeSearch.addEventListener('input', onInputDebounced);
  resetBtn.addEventListener('click', () => {
    volumeSelect.value = '__ALL__';
    canalSelect.value = '__ALL__';
    outcomeSearch.value = '';
    update();
  });
  exportBtn.addEventListener('click', exportCSV);
  $all('#resultsTable thead th').forEach(th => th.addEventListener('click', () => setSort(th)));

  // Acessibilidade: foco inicial no arquivo (opcional, pode remover se preferir)
  // fileInput.focus();
  // Carrega dados do JSON ao iniciar (fallback para demo se ausente)
  loadFromJson();
})();
