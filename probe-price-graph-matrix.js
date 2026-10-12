const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, 'artifacts', 'matrix-diagnostic');
const FLAG = path.join(__dirname, 'artifacts', 'manual-continue.flag');
const URL = process.env.GOOGLE_FLIGHTS_URL || '';
fs.mkdirSync(OUT, { recursive: true });
const log = message => console.log(`[MATRIX] ${new Date().toISOString()} ${message}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function rejectConsent(page) {
  if (!page.url().includes('consent.google.com')) return;
  const button = page.locator('button, [role="button"], input[type="submit"], input[type="button"]')
    .filter({ hasText: /reject all|recusar todos|recusar tudo|rejeitar tudo|decline all/i })
    .or(page.locator('[aria-label="Reject all"], [aria-label="Recusar tudo"], [aria-label="Rejeitar tudo"]')).first();
  if (await button.count()) { await button.click(); await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}); log('consent rejected'); }
  else log('consent page detected but reject-all control was not found');
}

function summarizeRaw(raw) {
  const text = raw.toString('utf8');
  return { bytes: raw.length, lines: text.split(/\r?\n/).length, firstChars: text.slice(0, 500), containsError: /ErrorResponse|error/i.test(text), dateLikeValues: [...new Set(text.match(/20\d{2}-\d{2}-\d{2}/g) || [])].slice(0, 100), euroValues: [...new Set(text.match(/(?:€|EUR)\s?[\d.,]+/g) || [])].slice(0, 100) };
}

async function main() {
  const manual = !/^(false|0|no)$/i.test(String(process.env.MANUAL_NAVIGATION || 'true'));
  const browser = await chromium.launch({ headless: false, slowMo: Number(process.env.SLOW_MO || 100), args: ['--lang=pt-PT'] });
  const context = await browser.newContext({ locale: 'pt-PT', extraHTTPHeaders: { 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8' } });
  const page = await context.newPage();
  const responses = [];
  page.on('response', async response => {
    if (!response.url().includes('FlightsFrontendService/GetCalendarGrid')) return;
    try { const raw = await response.body(); const summary = summarizeRaw(raw); const index = responses.length; fs.writeFileSync(path.join(OUT, `get-calendar-grid-${index}.bin`), raw); responses.push({ index, capturedAt: new Date().toISOString(), url: response.url(), status: response.status(), ...summary }); log(`GetCalendarGrid captured index=${index} status=${response.status()} bytes=${raw.length} dates=${summary.dateLikeValues.length}`); }
    catch (error) { log(`GetCalendarGrid body unavailable: ${error.message}`); }
  });
  if (manual) {
    try { fs.unlinkSync(FLAG); } catch {}
    await page.goto('about:blank');
    log('Chromium opened on about:blank; navigate manually to Google Flights');
    log('Resolve any Google verification manually, then create artifacts/manual-continue.flag');
    while (!fs.existsSync(FLAG)) await sleep(500);
    log(`manual continuation received; url=${page.url()}`);
  } else { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); await rejectConsent(page); }
  if (page.url().includes('consent.google.com')) await rejectConsent(page);
  await page.waitForTimeout(2000);
  let calendar = page.locator('span[jsname="V67aGc"]:visible').first();
  if (!await calendar.count()) calendar = page.getByText(/^(Calendário|Calendar)$/i).first();
  if (!await calendar.count()) {
    log('Calendário control not found immediately; waiting up to 30 seconds');
    await page.waitForTimeout(30000);
    calendar = page.locator('span[jsname="V67aGc"]:visible').first();
    if (!await calendar.count()) calendar = page.getByText(/^(Calendário|Calendar)$/i).first();
  }
  if (!await calendar.count()) {
    const visibleText = (await page.locator('body').innerText().catch(() => '')).slice(0, 2000);
    log(`visible page text before failure: ${visibleText}`);
    throw new Error('Calendário button not found');
  }
  await calendar.scrollIntoViewIfNeeded();
  await calendar.click(); log('Calendário opened first time'); await page.waitForTimeout(1000); await page.keyboard.press('Escape'); await page.waitForTimeout(1000); log('Calendário closed after warm-up'); await calendar.click(); log('Calendário opened second time'); await page.waitForTimeout(3000);
  const canvas = page.locator('canvas.Nk9ZY[role="grid"]');
  const canvasInfo = await canvas.count() ? await canvas.first().evaluate(el => ({ width: el.width, height: el.height, cssWidth: el.clientWidth, cssHeight: el.clientHeight, role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label') })) : null;
  const buttons = await page.locator('button:visible').evaluateAll(btns => btns.map(b => ({ ariaLabel: b.getAttribute('aria-label'), text: (b.innerText || '').trim() })).filter(x => x.ariaLabel && /Rolar para|Scroll/i.test(x.ariaLabel)));
  const result = { capturedAt: new Date().toISOString(), url: page.url(), title: await page.title(), canvas: canvasInfo, navigationButtons: buttons, responseCount: responses.length, responses };
  fs.writeFileSync(path.join(OUT, 'matrix-diagnostic.json'), JSON.stringify(result, null, 2)); fs.writeFileSync(path.join(OUT, 'matrix-diagnostic.html'), await page.content(), 'utf8'); await page.screenshot({ path: path.join(OUT, 'matrix-diagnostic.png'), fullPage: false }); log(`diagnostic complete: canvas=${Boolean(canvasInfo)} responses=${responses.length}`); log(`artefacts saved in ${OUT}`); await browser.close();
}
main().catch(error => { console.error(`[MATRIX] FAILED ${error.stack || error.message}`); process.exitCode = 1; });
