const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const URL = 'https://www.google.com/travel/flights/search?tfs=CBwQAho2EgoyMDI3LTAyLTIwKAFqBwgBEgNDTkZqBwgBEgNHSUdyBwgBEgNMSVNyBwgBEgNPUE-QAawCGjYSCjIwMjctMDUtMTQoAWoHCAESA0xJU2oHCAESA09QT3IHCAESA0NORnIHCAESA0dJR5ABrAJAAUgBYIQHcAGCAQsI____________AZgBAQ&tfu=EgYIABAAGAA';
const OUT = path.join(__dirname, 'artifacts'); fs.mkdirSync(OUT, { recursive: true });
const startedAt = new Date(); const log = s => console.log(`[${new Date().toISOString()}] ${s}`);
const visibleDates = text => [...new Set(text.match(/20\d{2}-\d{2}-\d{2}|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+[A-Z][a-z]{2}\s+\d{1,2}/g) || [])];

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Europe/Lisbon' });
  const page = await context.newPage();
  let cookiesRejected = false; let graphSeenAt = null; let resultsSeenAt = null; let oopsSeenAt = null;
  const graphResponses = [];
  page.on('response', async response => {
    if (!response.url().includes('GetCalendarGraph')) return;
    const item = { timestamp: new Date().toISOString(), status: response.status(), url: response.url(), bytes: null };
    try { item.bytes = (await response.body()).length; } catch {}
    graphResponses.push(item); log(`GetCalendarGraph observed: status=${item.status} bytes=${item.bytes}`);
  });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (page.url().includes('consent.google.com')) {
    const reject = page.getByRole('button', { name: /reject all|recusar todos|decline all/i }).first();
    if (await reject.count()) { await reject.click(); cookiesRejected = true; log('Cookies rejected'); }
  }
  const loadDeadline = Date.now() + 60000;
  while (Date.now() < loadDeadline) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (!resultsSeenAt && await page.getByText(/Departing flights|Voos de ida|Flight details/i).first().count()) resultsSeenAt = new Date();
    if (!oopsSeenAt && /Oops, something went wrong/i.test(body)) oopsSeenAt = new Date();
    const graph = page.locator('button').filter({ hasText: /Price graph|Gráfico de preços/i }).first();
    if (await graph.count() && await graph.isVisible().catch(() => false)) { graphSeenAt = new Date(); break; }
    await page.waitForTimeout(500);
  }
  const beforeText = await page.locator('body').innerText().catch(() => '');
  const filterPresent = /(?:Up to|Até)\s+€\s?\d+/i.test(beforeText);
  const beforeDates = visibleDates(beforeText);
  await page.screenshot({ path: path.join(OUT, 'click-test-before.png'), fullPage: false });
  fs.writeFileSync(path.join(OUT, 'click-test-before.html'), await page.content(), 'utf8');

  const arrow = page.locator('button[aria-label="Rolar para a frente"], button[aria-label="Scroll forward"]').first();
  const arrowFound = await arrow.count() > 0;
  const arrowLabel = arrowFound ? await arrow.getAttribute('aria-label') : null;
  const arrowVisible = arrowFound && await arrow.isVisible().catch(() => false);
  const arrowEnabled = arrowFound && await arrow.isEnabled().catch(() => false);
  let clickExecuted = false; let visualChangedAt = null; let stableAt = null;
  if (arrowFound && arrowVisible && arrowEnabled) {
    const beforeHash = beforeText;
    await arrow.click(); clickExecuted = true; log(`Exactly one arrow click executed (${arrowLabel})`);
    const deadline = Date.now() + 60000; let lastText = beforeHash; let changedAt = null; let stableSince = null;
    while (Date.now() < deadline) {
      const text = await page.locator('body').innerText().catch(() => '');
      if (!oopsSeenAt && /Oops, something went wrong/i.test(text)) oopsSeenAt = new Date();
      if (!changedAt && text !== beforeHash) { changedAt = new Date(); visualChangedAt = changedAt; log('Visible page state changed after click'); }
      if (changedAt && text === lastText) { if (!stableSince) stableSince = Date.now(); } else stableSince = null;
      lastText = text;
      const graph = page.locator('button').filter({ hasText: /Price graph|Gráfico de preços/i }).first();
      if (changedAt && stableSince && Date.now() - stableSince >= 1500) { stableAt = new Date(); break; }
      await page.waitForTimeout(500);
    }
  }
  const afterText = await page.locator('body').innerText().catch(() => '');
  const afterDates = visibleDates(afterText);
  const graphStillVisible = await page.locator('button').filter({ hasText: /Price graph|Gráfico de preços/i }).first().isVisible().catch(() => false);
  await page.screenshot({ path: path.join(OUT, 'click-test-after.png'), fullPage: false });
  fs.writeFileSync(path.join(OUT, 'click-test-after.html'), await page.content(), 'utf8');
  const report = { url: URL, finalUrl: page.url(), title: await page.title(), cookiesRejected, priceFilterPresent: filterPresent, priceFilterAbsent: !filterPresent, resultsVisible: Boolean(resultsSeenAt), priceGraphInitialVisible: Boolean(graphSeenAt), arrowFound, arrowLabel, arrowVisible, arrowEnabled, clickExecuted, clickCount: clickExecuted ? 1 : 0, window0FirstDate: beforeDates[0] || null, window0LastDate: beforeDates.at(-1) || null, window1FirstDate: afterDates[0] || null, window1LastDate: afterDates.at(-1) || null, beforeDates, afterDates, visualChanged: Boolean(visualChangedAt), visualChangedAt: visualChangedAt?.toISOString() || null, graphStillVisible, stableAt: stableAt?.toISOString() || null, oopsDetected: Boolean(oopsSeenAt), oopsSeenAt: oopsSeenAt?.toISOString() || null, getCalendarGraphResponses: graphResponses, totalMs: Date.now() - startedAt.getTime() };
  fs.writeFileSync(path.join(OUT, 'click-test.json'), JSON.stringify(report, null, 2), 'utf8');
  log(`FINAL: clicked=${clickExecuted} visualChanged=${report.visualChanged} graphStillVisible=${graphStillVisible} oops=${report.oopsDetected}`);
  await browser.close();
}
main().catch(e => { console.error(`[${new Date().toISOString()}] CLICK TEST FAILED: ${e.stack || e.message}`); process.exitCode = 1; });
