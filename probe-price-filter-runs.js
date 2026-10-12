const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const URL = 'https://www.google.com/travel/flights/search?tfs=CBwQAho2EgoyMDI3LTAyLTIwKAFqBwgBEgNDTkZqBwgBEgNHSUdyBwgBEgNMSVNyBwgBEgNPUE-QAawCGjYSCjIwMjctMDUtMTQoAWoHCAESA0xJU2oHCAESA09QT3IHCAESA0NORnIHCAESA0dJR5ABrAJAAUgBcAGCAQsI____________AZgBAQ&tfu=EgYIABAAGAA';
const OUT = path.join(__dirname, 'artifacts', 'price-filter-runs'); fs.mkdirSync(OUT, { recursive: true });
const log = s => console.log(`[${new Date().toISOString()}] ${s}`);
const debug = (n, s) => console.log(`[DEBUG ${String(n).padStart(2, '0')}] ${s}`);
process.on('uncaughtException', e => console.error('[FATAL uncaughtException]', e.name, e.message, e.stack));
process.on('unhandledRejection', e => console.error('[FATAL unhandledRejection]', e?.name, e?.message, e?.stack || e));
debug(1, 'script started');
debug(2, `output directory resolved: ${OUT}`);

async function observe(page, elapsedMs) {
  const body = await page.locator('body').innerText().catch(() => '');
  const active = page.locator('button[aria-label="up to €900, Price, Selected"]');
  const activeCount = await active.count();
  const visibleActive = activeCount > 0 && await active.first().isVisible().catch(() => false);
  const graph = page.locator('button').filter({ hasText: /Price graph|Gráfico de preços/i }).first();
  const results = page.getByText(/Departing flights|Voos de ida|Flight details/i).first();
  const filters = (body.match(/All filters \(\d+\)|Todos os filtros \(\d+\)/i) || [null])[0];
  return { elapsedMs, bodyHasUpTo900: /up to €900/i.test(body), activeFilterElementCount: activeCount, activeFilterVisible: visibleActive, priceFilterActive: visibleActive, allFilters: filters, priceGraphVisible: await graph.count() > 0 && (await graph.isVisible().catch(() => false) || /Price graph|Gráfico de preços/i.test(body)), resultsVisible: await results.count() > 0 || /Departing flights|Voos de ida|Flight details/i.test(body) };
}

async function runOne(run) {
  debug(3, `run ${run} starting browser launch`);
  const startedAt = new Date();
  const browser = await chromium.launch({ headless: process.env.HEADLESS !== 'false' });
  debug(4, `run ${run} browser launched`);
  const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Europe/Lisbon' });
  debug(5, `run ${run} context created`);
  const page = await context.newPage();
  debug(6, `run ${run} page created`);
  let cookiesRejected = false;
  debug(7, `run ${run} navigation starting`);
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  debug(8, `run ${run} navigation completed: ${page.url()}`);
  if (page.url().includes('consent.google.com')) {
    debug(8.1, `run ${run} consent page detected`);
    const reject = page.getByRole('button', { name: /reject all|recusar todos|decline all/i }).first();
    if (await reject.count()) {
      debug(8.2, `run ${run} rejecting cookies`);
      await reject.click(); cookiesRejected = true;
      debug(8.3, `run ${run} waiting for return to Google Flights`);
      await page.waitForURL(url => !url.toString().includes('consent.google.com'), { timeout: 30000 }).catch(() => {});
      debug(8.4, `run ${run} returned from consent; final URL: ${page.url()}`);
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    } else debug(8.2, `run ${run} reject-all button not found`);
  }
  const readyDeadline = Date.now() + 20000;
  debug(9, `run ${run} waiting for page state`);
  let lastProgressLog = 0;
  while (Date.now() < readyDeadline) {
    const state = await observe(page, Date.now() - startedAt.getTime());
    if (Date.now() - lastProgressLog >= 1000) {
      debug(9.1, `run ${run} waiting: url=${page.url()} resultsVisible=${state.resultsVisible} priceGraphVisible=${state.priceGraphVisible}`);
      lastProgressLog = Date.now();
    }
    if (state.resultsVisible && state.priceGraphVisible) break;
    await page.waitForTimeout(250);
  }
  if (Date.now() >= readyDeadline) debug(9.2, `run ${run} ready deadline reached`);
  const checkpoints = {};
  debug(10, `run ${run} checking price filter checkpoints`);
  for (const seconds of [0, 1, 2, 5]) {
    const target = startedAt.getTime() + seconds * 1000;
    if (Date.now() < target) await page.waitForTimeout(target - Date.now());
    checkpoints[`${seconds}s`] = await observe(page, Date.now() - startedAt.getTime());
  }
  const html = await page.content();
  debug(11, `run ${run} writing JSON artifact`);
  const report = { run, urlRequested: URL, finalUrl: page.url(), title: await page.title(), startedAt: startedAt.toISOString(), cookiesRejected, checkpoints, clickCount: 0, requestsModified: false };
  fs.writeFileSync(path.join(OUT, `run-${run}.json`), JSON.stringify(report, null, 2), 'utf8');
  debug(12, `run ${run} JSON written`);
  fs.writeFileSync(path.join(OUT, `run-${run}.html`), html, 'utf8');
  await page.screenshot({ path: path.join(OUT, `run-${run}.png`), fullPage: false });
  debug(13, `run ${run} screenshot written`);
  log(`Run ${run}: 0s=${checkpoints['0s'].priceFilterActive} 1s=${checkpoints['1s'].priceFilterActive} 2s=${checkpoints['2s'].priceFilterActive} 5s=${checkpoints['5s'].priceFilterActive} filters=${checkpoints['5s'].allFilters}`);
  await browser.close();
  debug(14, `run ${run} completed`);
  return report;
}

async function main() {
  debug(15, 'main started');
  const runs = [];
  for (let run = 1; run <= 5; run++) { debug(16, `starting run ${run}`); runs.push(await runOne(run)); }
  const summary = runs.map(r => ({ run: r.run, '0s': r.checkpoints['0s'].priceFilterActive, '1s': r.checkpoints['1s'].priceFilterActive, '2s': r.checkpoints['2s'].priceFilterActive, '5s': r.checkpoints['5s'].priceFilterActive, allFilters: r.checkpoints['5s'].allFilters, priceGraph: r.checkpoints['5s'].priceGraphVisible, results: r.checkpoints['5s'].resultsVisible }));
  const final = { url: URL, runs: summary, activeFilterRuns: summary.filter(x => x['5s']).length, generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(final, null, 2), 'utf8');
  debug(17, 'summary written');
  console.table(summary);
  log(`Conclusion: active visible up to €900 at 5s in ${final.activeFilterRuns}/5 runs`);
}
main().catch(e => { console.error(`[${new Date().toISOString()}] FILTER RUN TEST FAILED`, e.name, e.message, e.stack); process.exitCode = 1; });
