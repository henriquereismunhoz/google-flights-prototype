(() => {
  if (window.matrixCapture?.installed) {
    console.warn('[matrixCapture] já está instalado');
    return;
  }

  const captured = [];
  const endpoint = 'FlightsFrontendService/GetCalendarGrid';

  function save(url, status, body) {
    captured.push({
      index: captured.length,
      capturedAt: new Date().toISOString(),
      url: String(url).split('?')[0],
      status,
      bytes: body.length,
      body
    });
    console.log(`[matrixCapture] resposta ${captured.length}: HTTP ${status}, ${body.length} bytes`);
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    if (String(url).includes(endpoint)) {
      const copy = response.clone();
      copy.text().then(body => save(url, response.status, body)).catch(error => console.warn('[matrixCapture] erro fetch:', error));
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__matrixCaptureUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    if (String(this.__matrixCaptureUrl).includes(endpoint)) {
      this.addEventListener('load', () => save(this.__matrixCaptureUrl, this.status, String(this.responseText || '')));
    }
    return originalSend.apply(this, args);
  };

  window.matrixCapture = {
    installed: true,
    status() {
      return { responses: captured.length, bytes: captured.reduce((sum, item) => sum + item.bytes, 0) };
    },
    clear() {
      captured.length = 0;
      console.log('[matrixCapture] captura limpa');
    },
    export() {
      const payload = { exportedAt: new Date().toISOString(), endpoint, responses: captured };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `get-calendar-grid-${new Date().toISOString().replaceAll(':', '-')}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      console.log(`[matrixCapture] exportadas ${captured.length} respostas`);
    }
  };

  console.log('[matrixCapture] instalado. Agora navegue na matriz. Para exportar: matrixCapture.export()');
})();
