const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const URL = 'https://www.google.com/travel/flights/search?tfs=CBwQAho2EgoyMDI3LTAyLTIwKAFqBwgBEgNDTkZqBwgBEgNHSUdyBwgBEgNMSVNyBwgBEgNPUE-QAawCGjYSCjIwMjctMDUtMTQoAWoHCAESA0xJU2oHCAESA09QT3IHCAESA0NORnIHCAESA0dJR5ABrAJAAUgBcAGCAQsI____________AZgBAQ&tfu=EgYIABAAGAA';
const OUT = path.join(__dirname, 'artifacts');
fs.mkdirSync(OUT, { recursive: true });
const startedAt = new Date();
const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`);

async function main() {
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  // Deliberately no storageState, no userDataDir, no cookies and no persistent context.
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Europe/Lisbon' });
  const page = await context.newPage();
  let consentAction = null;
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });

  if (page.url().includes('consent.google.com')) {
    const reject = page.getByRole('button', { name: /reject all|recusar todos|decline all/i }).first();
    if (await reject.count()) {
      await reject.click();
      consentAction = 'reject_all';
      log('Clicked consent button: Reject all / Recusar todos');
    } else {
      consentAction = 'consent_page_without_reject_button';
      log('Consent page appeared, but the reject-all button was not found');
    }
  } else {
    consentAction = 'no_consent_page';
    log('No consent page appeared');
  }

  const deadline = Date.now() + 60000;
  let resultsVisibleAt = null;
  let graphVisibleAt = null;
  let oopsSeenAt = null;
  let priceFilterVisible = false;
  let priceFilterText = null;
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => '');
    if (!oopsSeenAt && /Oops, something went wrong/i.test(body)) { oopsSeenAt = new Date(); log('Oops, something went wrong detected'); }
    if (!resultsVisibleAt) {
      const results = page.getByText(/Departing flights|Voos de ida|Flight details/i).first();
      if (await results.count() && await results.isVisible().catch(() => false)) { resultsVisibleAt = new Date(); log('Flight results detected'); }
    }
    const priceMatch = body.match(/(?:Up to|Até)\s+€\s?[\d.,]+/i);
    if (priceMatch) { priceFilterVisible = true; priceFilterText = priceMatch[0]; }
    const graph = page.locator('button').filter({ hasText: /Price graph|Gráfico de preços/i }).first();
    if (!graphVisibleAt && await graph.count() && await graph.isVisible().catch(() => false)) { graphVisibleAt = new Date(); log('Price Graph detected'); }
    if (resultsVisibleAt && graphVisibleAt) break;
    await page.waitForTimeout(500);
  }

  const body = await page.locator('body').innerText().catch(() => '');
  const report = {
    isolatedContext: true, storageStateUsed: false, persistentProfileUsed: false,
    urlRequested: URL, finalUrl: page.url(), title: await page.title(),
    startedAt: startedAt.toISOString(), consentAction,
    resultsVisible: Boolean(resultsVisibleAt), resultsVisibleAt: resultsVisibleAt?.toISOString() || null,
    priceGraphVisible: Boolean(graphVisibleAt), priceGraphVisibleAt: graphVisibleAt?.toISOString() || null,
    priceFilterVisible, priceFilterText, oopsDetected: Boolean(oopsSeenAt), oopsSeenAt: oopsSeenAt?.toISOString() || null,
    totalMs: Date.now() - startedAt.getTime(),
    relevantVisibleText: body.split(/\r?\n/).map(x => x.trim()).filter(x => /Up to|Até|Price|Price graph|Departing|Oops|No options|Best|Cheapest/i.test(x)).slice(0, 100)
  };
  fs.writeFileSync(path.join(OUT, 'cookie-reject-test.json'), JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT, 'cookie-reject-test.html'), await page.content(), 'utf8');
  await page.screenshot({ path: path.join(OUT, 'cookie-reject-test.png'), fullPage: false });
  log(`FINAL: priceFilterVisible=${priceFilterVisible} text=${priceFilterText || 'none'} results=${report.resultsVisible} graph=${report.priceGraphVisible} oops=${report.oopsDetected}`);
  await browser.close();
}
main().catch(error => { console.error(`[${new Date().toISOString()}] COOKIE TEST FAILED: ${error.stack || error.message}`); process.exitCode = 1; });
