(() => {
  if (window.__gfMatrixHookInstalled) return;
  window.__gfMatrixHookInstalled = true;
  const endpoint = 'FlightsFrontendService/GetCalendarGrid';
  const emit = detail => window.dispatchEvent(new CustomEvent('__gf_matrix_response', { detail }));
  const capture = async (url, status, reader) => {
    try {
      const body = await reader();
      emit({ url: String(url).split('?')[0], status, body, capturedAt: new Date().toISOString() });
    } catch (error) {
      emit({ url: String(url).split('?')[0], status, error: String(error) });
    }
  };
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (String(url).includes(endpoint)) capture(url, response.status, () => response.clone().text());
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__gfMatrixUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (String(this.__gfMatrixUrl).includes(endpoint)) {
      this.addEventListener('load', () => emit({ url: String(this.__gfMatrixUrl).split('?')[0], status: this.status, body: String(this.responseText || ''), capturedAt: new Date().toISOString() }));
    }
    return originalSend.apply(this, args);
  };
  emit({ type: 'installed' });
})();
