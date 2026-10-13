(() => {
  const state = { active: true, responses: [], startedAt: new Date().toISOString() };
  const panel = document.createElement('div');
  panel.id = '__gf_matrix_panel';
  panel.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#202124;color:#fff;padding:10px 12px;border-radius:8px;font:13px Arial;box-shadow:0 2px 12px #0006;min-width:210px';
  panel.innerHTML = '<div><b>Matrix capture</b> <span id="__gf_matrix_count">0 respostas</span></div><div id="__gf_matrix_status" style="margin:6px 0;color:#bdc1c6">A instalar…</div><button id="__gf_matrix_stop">Parar</button> <button id="__gf_matrix_export">Exportar JSON</button> <button id="__gf_matrix_excel">Exportar Excel</button>';
  const update = text => { const el = document.getElementById('__gf_matrix_status'); if (el) el.textContent = text; const count = document.getElementById('__gf_matrix_count'); if (count) count.textContent = `${state.responses.length} respostas`; };
  const exportData = () => { const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), endpoint: 'GetCalendarGrid', responses: state.responses }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `get-calendar-grid-${new Date().toISOString().replaceAll(':','-')}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); update('JSON exportado'); };
  const records = () => {
    const map = new Map();
    const pattern = /\\"(20\d{2}-\d{2}-\d{2})\\",\\"(20\d{2}-\d{2}-\d{2})\\",(?:\[\[null,(\d+)\]|null,2)/g;
    for (const response of state.responses) {
      for (const match of String(response.body || '').matchAll(pattern)) {
        const key = `${match[1]}|${match[2]}`;
        map.set(key, { departure: match[1], returnDate: match[2], price: match[3] ? Number(match[3]) : null, status: match[3] ? 'price' : 'no_flights' });
      }
    }
    return [...map.values()];
  };
  const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
  const exportExcel = () => {
    const items = records(); const departures = [...new Set(items.map(x => x.departure))].sort(); const returns = [...new Set(items.map(x => x.returnDate))].sort(); const lookup = new Map(items.map(x => [`${x.departure}|${x.returnDate}`, x]));
    const cells = [['Volta \\ Partida', ...departures], ...returns.map(r => [r, ...departures.map(d => { const x = lookup.get(`${d}|${r}`); return x ? (x.price === null ? 'sem voos' : x.price) : '—'; })])];
    const htmlTable = `<html><head><meta charset="utf-8"></head><body><table border="1">${cells.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('')}</table></body></html>`;
    const blob = new Blob([htmlTable], { type: 'application/vnd.ms-excel' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `google-flights-matrix-${new Date().toISOString().replaceAll(':','-')}.xls`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); update(`Excel exportado: ${items.length} pares`);
  };
  const install = () => { const script = document.createElement('script'); script.src = chrome.runtime.getURL('page-hook.js'); script.onload = () => script.remove(); (document.head || document.documentElement).appendChild(script); };
  window.addEventListener('__gf_matrix_response', event => { const item = event.detail || {}; if (item.type === 'installed') return update('Captura ativa'); if (!state.active) return; state.responses.push(item); update(`Última resposta: HTTP ${item.status || '?'} (${item.body?.length || 0} bytes)`); });
  const mount = () => { if (!document.body || document.getElementById(panel.id)) return; document.body.appendChild(panel); document.getElementById('__gf_matrix_stop').onclick = () => { state.active = false; update('Captura parada'); }; document.getElementById('__gf_matrix_export').onclick = exportData; document.getElementById('__gf_matrix_excel').onclick = exportExcel; install(); };
  if (document.body) mount(); else new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
})();
