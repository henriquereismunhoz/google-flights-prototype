const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const TEST_URL = 'https://www.google.com/travel/flights/search?tfs=CBwQAho2EgoyMDI3LTAyLTIwKAFqBwgBEgNDTkZqBwgBEgNHSUdyBwgBEgNMSVNyBwgBEgNPUE-QAawCGjYSCjIwMjctMDUtMTQoAWoHCAESA0xJU2oHCAESA09QT3IHCAESA0NORnIHCAESA0dJR5ABrAJAAUgBcAGCAQsI____________AZgBAQ&tfu=EgYIABAAGAA';
const OUT_DIR = path.join(__dirname, 'artifacts');
fs.mkdirSync(OUT_DIR, { recursive: true });

const ts = () => new Date().toISOString();
const log = (message, details) => console.log(`[${ts()}] ${message}${details === undefined ? '' : ` ${details}`}`);
const safeName = (value) => value.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 100);

function looksLikeGraphRequest(request) {
  const haystack = `${request.url()} ${request.method()} ${request.postData() || ''}`.toLowerCase();
  return /getcalendargraph|calendargraph|price.?graph|calendar|flightsui\/data\/batchexecute|batchexecute/.test(haystack);
}

function findCalendarRecords(text) {
  // GetCalendarGraph returns a length-prefixed batched response. Each wrb.fr
  // payload contains a JSON string whose nested arrays include [departure,
  // return, [null, price], ...] when a price is available.
  const records = [];
  const seen = new Set();
  const iso = /^20\d{2}-\d{2}-\d{2}$/;
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === 'string' && iso.test(value[0]) && typeof value[1] === 'string' && iso.test(value[1])) {
      let price = null;
      const searchNumber = (node) => {
        if (price !== null || node === null || node === undefined) return;
        if (Array.isArray(node)) return node.forEach(searchNumber);
        if (typeof node === 'number' && node >= 50 && node <= 50000) price = node;
      };
      searchNumber(value[2]);
      const key = `${value[0]}|${value[1]}`;
      if (!seen.has(key)) { seen.add(key); records.push({ departure_date: value[0], return_date: value[1], price }); }
    }
    value.forEach(walk);
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('[[')) continue;
    try {
      const outer = JSON.parse(line);
      const payload = outer?.[0]?.[2];
      if (typeof payload === 'string') walk(JSON.parse(payload));
    } catch { /* non-JSON transport/status lines are expected */ }
  }
  return records;
}

async function main() {
  log('STARTING Playwright Chromium probe');
  log(`Output directory: ${OUT_DIR}`);
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  log('Chromium opened successfully');
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Europe/Lisbon' });
  const page = await context.newPage();
  const candidates = [];
  const pendingResponseReads = new Set();
  let responseCounter = 0;

  page.on('request', (request) => {
    if (looksLikeGraphRequest(request)) {
      log(`RELEVANT REQUEST: ${request.method()} ${request.url()}`);
      candidates.push({ request, response: null });
    }
  });
  page.on('response', async (response) => {
    const request = response.request();
    if (!looksLikeGraphRequest(request)) return;
    const item = candidates.find((candidate) => candidate.request === request);
    if (!item || item.response) return;
    const readPromise = (async () => { try {
      const body = await response.body();
      const base = `${String(++responseCounter).padStart(2, '0')}_${safeName(new URL(response.url()).pathname)}`;
      const rawPath = path.join(OUT_DIR, `${base}.bin`);
      fs.writeFileSync(rawPath, body);
      item.response = { status: response.status(), url: response.url(), contentType: response.headers()['content-type'], bytes: body.length, rawPath };
      log(`GRAPH RESPONSE CAPTURED: status=${response.status()} bytes=${body.length} file=${rawPath}`);
    } catch (error) {
      log(`Could not read candidate response: ${error.message}`);
    } })();
    pendingResponseReads.add(readPromise);
    await readPromise.finally(() => pendingResponseReads.delete(readPromise));
  });

  log('Navigating to Google Flights URL');
  const navigation = await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  log(`Page navigation completed: status=${navigation ? navigation.status() : 'unknown'} title="${await page.title()}"`);
  if (page.url().includes('consent.google.com')) {
    log('Google consent page detected; looking for the reject-all button');
    const consentButtons = [
      page.getByRole('button', { name: /reject all|recusar todos|decline all/i }).first(),
      page.locator('button').filter({ hasText: /reject all|recusar todos|decline all/i }).first(),
      page.locator('input[type="submit"]').filter({ hasValue: /reject|recusar|decline/i }).first()
    ];
    let rejected = false;
    for (const button of consentButtons) {
      if (await button.count()) {
        try { await button.click({ timeout: 5000 }); rejected = true; log('Consent rejected; continuing to Google Flights'); break; } catch (error) { log(`Consent control found but click failed: ${error.message}`); }
      }
    }
    if (!rejected) log('Consent page was shown but no reject-all control was found');
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  }
  const graphDeadline = Date.now() + 60000;
  let graphControl = null;
  while (Date.now() < graphDeadline && !graphControl) {
    const controls = [
      page.getByRole('button', { name: /price graph|gráfico de preços/i }).first(),
      page.getByText('Price graph', { exact: true }).first(),
      page.getByText('Gráfico de preços', { exact: true }).first(),
      page.getByText('Price history', { exact: true }).first()
    ];
    for (const locator of controls) {
      if (await locator.count() && await locator.isVisible().catch(() => false)) { graphControl = locator; break; }
    }
    if (!graphControl) await page.waitForTimeout(1000);
  }
  log(`Page loaded; current URL=${page.url()}`);

  const graphControls = [
    page.getByRole('button', { name: /price graph|gráfico de preços/i }).first(),
    page.getByText('Price graph', { exact: true }).first(),
    page.getByText('Gráfico de preços', { exact: true }).first(),
    page.getByText('Price history', { exact: true }).first()
  ];
  for (const locator of graphControls) {
    if (!graphControl && await locator.count()) {
      log('GRAPH UI FOUND: Price graph control');
      try { await locator.click({ timeout: 5000 }); log('Clicked Price graph control'); } catch (error) { log(`Graph control visible but click failed: ${error.message}`); }
      break;
    }
  }
  if (graphControl) {
    log('GRAPH UI FOUND: visible Price graph control');
    try { await graphControl.click({ timeout: 5000 }); log('Clicked Price graph control'); } catch (error) { log(`Graph control click failed: ${error.message}`); }
  }
  await page.waitForTimeout(10000);
  if (pendingResponseReads.size) {
    log(`Waiting for ${pendingResponseReads.size} response body read(s) to finish`);
    await Promise.allSettled([...pendingResponseReads]);
  }
  await page.screenshot({ path: path.join(OUT_DIR, 'page.png'), fullPage: false });
  log('Screenshot saved');

  const html = await page.content();
  fs.writeFileSync(path.join(OUT_DIR, 'page.html'), html, 'utf8');
  const allText = html;
  const extracted = [];
  for (const item of candidates.filter((candidate) => candidate.response)) {
    const raw = fs.readFileSync(item.response.rawPath);
    const text = raw.toString('utf8');
    const pairs = findCalendarRecords(text);
    extracted.push(...pairs);
    log(`Candidate structure: ${JSON.stringify({ ...item.response, firstChars: text.slice(0, 300) })}`);
    log(`Candidate extracted records: ${pairs.length}`);
  }
  if (!candidates.length) log('No requests matching GetCalendarGraph/calendar/price graph were observed');
  if (candidates.length && !candidates.some((candidate) => candidate.response)) log('Relevant request(s) observed, but no readable response captured');
  const entries = extracted.map((record) => ({
    departureDate: record.departure_date,
    returnDate: record.return_date,
    durationDays: Math.round((Date.parse(record.return_date) - Date.parse(record.departure_date)) / 86400000),
    price: record.price === null ? null : record.price
  }));
  const report = {
    testedAt: ts(), url: TEST_URL, pageTitle: await page.title(), finalUrl: page.url(),
    graphRequestsObserved: candidates.map((item) => ({ method: item.request.method(), url: item.request.url(), postData: item.request.postData() })),
    responsesCaptured: candidates.map((item) => item.response).filter(Boolean),
    extractedRecords: entries,
    notes: 'Extraction is conservative and does not invent return dates. Inspect raw .bin files and page.html for the actual Google response structure.'
  };
  const reportSource = report.responsesCaptured.find((x) => x.bytes === Math.max(...report.responsesCaptured.map((r) => r.bytes || 0))) || null;
  const windowReport = {
    window: { points: entries.length, source: reportSource ? 'GetCalendarGraph' : null },
    entries,
    source: reportSource
  };
  fs.writeFileSync(path.join(OUT_DIR, 'price-graph-window.json'), JSON.stringify(windowReport, null, 2), 'utf8');
  log(`PRICE GRAPH WINDOW SAVED: ${path.join(OUT_DIR, 'price-graph-window.json')} points=${entries.length}`);
  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  log(`REPORT SAVED: ${reportPath}`);
  log(`SUMMARY: requests=${report.graphRequestsObserved.length} responses=${report.responsesCaptured.length} records=${entries.length}`);
  if (entries.length) console.table(entries.slice(0, 10));
  await browser.close();
  log('Chromium closed');
}

main().catch((error) => {
  console.error(`[${ts()}] PROBE FAILED: ${error.stack || error.message}`);
  process.exitCode = 1;
});
