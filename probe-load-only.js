const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const URL = 'https://www.google.com/travel/flights/search?tfs=CBwQAho2EgoyMDI3LTAyLTIwKAFqBwgBEgNDTkZqBwgBEgNHSUdyBwgBEgNMSVNyBwgBEgNPUE-QAawCGjYSCjIwMjctMDUtMTQoAWoHCAESA0xJU2oHCAESA09QT3IHCAESA0NORnIHCAESA0dJR5ABrAJAAUgBYIQHcAGCAQsI____________AZgBAQ&tfu=EgYIABAAGAA';
const OUT = path.join(__dirname, 'artifacts');
fs.mkdirSync(OUT, { recursive: true });
const startedAt = new Date();
const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`);

async function main() {
  log('Starting one clean Playwright load test');
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Europe/Lisbon' });
  const page = await context.newPage();
  let consentAcceptedAt = null;
  let resultsVisibleAt = null;
  let graphVisibleAt = null;
  let errorSeenAt = null;

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (page.url().includes('consent.google.com')) {
    const accept = page.getByRole('button', { name: /accept all|aceitar tudo|i agree/i }).first();
    if (await accept.count()) { await accept.click(); consentAcceptedAt = new Date(); log('Normal Google consent accepted'); }
  }

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => '');
    const error = /Oops, something went wrong/i.test(body);
    if (error && !errorSeenAt) { errorSeenAt = new Date(); log('Oops, something went wrong detected'); }
    const result = page.getByText(/Departing flights|Voos de ida|Flight details/i).first();
    if (!resultsVisibleAt && await result.count() && await result.isVisible().catch(() => false)) { resultsVisibleAt = new Date(); log('Flight results detected'); }
    const graph = page.locator('button').filter({ hasText: /Price graph|Gráfico de preços/i }).first();
    if (!graphVisibleAt && await graph.count() && await graph.isVisible().catch(() => false)) { graphVisibleAt = new Date(); log('Price Graph detected in DOM'); break; }
    await page.waitForTimeout(500);
  }

  const bodyText = await page.locator('body').innerText().catch(() => '');
  const report = {
    urlRequested: URL, finalUrl: page.url(), title: await page.title(),
    startedAt: startedAt.toISOString(), consentAcceptedAt: consentAcceptedAt?.toISOString() || null,
    resultsVisibleAt: resultsVisibleAt?.toISOString() || null, graphVisibleAt: graphVisibleAt?.toISOString() || null,
    errorSeenAt: errorSeenAt?.toISOString() || null,
    totalMs: Date.now() - startedAt.getTime(),
    priceGraphDetected: Boolean(graphVisibleAt),
    oopsDetected: Boolean(errorSeenAt),
    relevantVisibleText: bodyText.split(/\r?\n/).map(x => x.trim()).filter(x => /Departing flights|Price graph|Oops|No options|Cheapest|Best|flight/i.test(x)).slice(0, 80)
  };
  fs.writeFileSync(path.join(OUT, 'load-test.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'load-test.html'), await page.content(), 'utf8');
  await page.screenshot({ path: path.join(OUT, 'load-test.png'), fullPage: false });
  log(`FINAL: graph=${report.priceGraphDetected} results=${Boolean(resultsVisibleAt)} oops=${report.oopsDetected} totalMs=${report.totalMs}`);
  log(`Saved artifacts/load-test.png, artifacts/load-test.html, artifacts/load-test.json`);
  await browser.close();
}
main().catch(error => { console.error(`[${new Date().toISOString()}] LOAD TEST FAILED: ${error.stack || error.message}`); process.exitCode = 1; });
