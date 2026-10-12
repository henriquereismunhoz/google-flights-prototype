const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const BASE_URL_80 = process.env.GOOGLE_FLIGHTS_URL || 'https://www.google.com/travel/flights/search?tfs=CBwQAho2EgoyMDI3LTAyLTA4KAFqBwgBEgNDTkZqBwgBEgNHSUdyBwgBEgNMSVNyBwgBEgNPUE-QAawCGjYSCjIwMjctMDQtMjkoAWoHCAESA0xJU2oHCAESA09QT3IHCAESA0NORnIHCAESA0dJR5ABrAJAAUgBYKAGcAGCAQsI____________AZgBAQ&tfu=EgYIABAAGAA';
const DURATION_FROM = Number(process.env.DURATION_FROM || 80);
const DURATION_TO = Number(process.env.DURATION_TO || 90);
const DURATIONS = Array.from({ length: Math.max(0, DURATION_TO - DURATION_FROM + 1) }, (_, i) => DURATION_FROM + i);
function dateToken(iso, departure = false) { return Buffer.from(`${departure ? '0' : ''}${iso.slice(2)}`).toString('base64').replace(/=+$/g, ''); }
function urlForDates(departure, returnDate) { return BASE_URL_80.replace('MDI3LTAyLTA4', dateToken(departure, true)).replace('MjctMDQtMjk', dateToken(returnDate)); }
const OUT = path.join(__dirname, 'artifacts');
fs.mkdirSync(OUT, { recursive: true });
const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`);

function parseCalendar(text) {
  const out = [], seen = new Set();
  const iso = /^20\d{2}-\d{2}-\d{2}$/;
  const walk = (v) => {
    if (!Array.isArray(v)) return;
    if (typeof v[0] === 'string' && iso.test(v[0]) && typeof v[1] === 'string' && iso.test(v[1])) {
      let price = null;
      const numbers = (x) => {
        if (price !== null || x == null) return;
        if (Array.isArray(x)) return x.forEach(numbers);
        if (typeof x === 'number' && x >= 50 && x <= 50000) price = x;
      };
      numbers(v[2]);
      const key = `${v[0]}|${v[1]}`;
      if (!seen.has(key)) { seen.add(key); out.push({ departure_date: v[0], return_date: v[1], price }); }
    }
    v.forEach(walk);
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('[[')) continue;
    try { const outer = JSON.parse(line); const payload = outer?.[0]?.[2]; if (typeof payload === 'string') walk(JSON.parse(payload)); } catch {}
  }
  out.sort((a, b) => a.departure_date.localeCompare(b.departure_date));
  return out;
}

async function nextValidGraphResponse(queue, ignored, maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  const quietMs = 8000;
  let latestValid = null;
  let lastEventAt = null;
  while (Date.now() < deadline) {
    const event = queue.shift();
    if (!event) {
      if (latestValid && lastEventAt && Date.now() - lastEventAt >= quietMs) {
        log(`GetCalendarGraph stable after ${quietMs}ms without a new response`);
        return latestValid;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      continue;
    }
    const { response, raw, records } = event;
    lastEventAt = Date.now();
    log(`GetCalendarGraph response: timestamp=${new Date().toISOString()} status=${response.status()} bytes=${raw.length} pairs=${records.length} ${records[0]?.departure_date || '?'} -> ${records.at(-1)?.departure_date || '?'}`);
    if (records.length > 0) { latestValid = event; continue; }
    ignored.push({ status: response.status(), bytes: raw.length, observedAt: new Date().toISOString() });
    log(`Ignored invalid GetCalendarGraph response: status=${response.status()} bytes=${raw.length}`);
  }
  return null;
}

function dayDiff(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
function sortRecords(records) { return [...records].sort((a, b) => a.departure_date.localeCompare(b.departure_date)); }
function consecutive(records) {
  const ordered = sortRecords(records);
  return ordered.every((record, index) => index === 0 || dayDiff(ordered[index - 1].departure_date, record.departure_date) === 1);
}
function compare(a, b) {
  const da = new Set(a.map(x => x.departure_date));
  const db = new Set(b.map(x => x.departure_date));
  return { overlap: [...da].filter(x => db.has(x)).length, onlyA: [...da].filter(x => !db.has(x)), onlyB: [...db].filter(x => !da.has(x)) };
}

function isoPlusDays(iso, days) { return new Date(Date.parse(iso) + days * 86400000).toISOString().slice(0, 10); }
async function waitForPriceLoadingToFinish(page, timeoutMs = 90000) {
  log(`[STEP] waiting for final prices (timeout=${timeoutMs}ms)`);
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  while (Date.now() < deadline) {
    const body = await page.locator('body').innerText().catch(() => '');
    const matches = body.match(/Getting prices|A obter preços(?:…|\.\.\.)?/gi) || [];
    if (matches.length !== lastCount) {
      lastCount = matches.length;
      log(`Price loading indicators: ${lastCount}`);
    }
    if (matches.length === 0) {
      log('[STEP] final prices ready: no loading indicators');
      return true;
    }
    await page.waitForTimeout(1000);
  }
  log(`Price loading timeout reached with ${lastCount} indicator(s) still visible`);
  return false;
}
async function hoverDateTargets(page, targetDate) {
  log(`[STEP] opening departure calendar for target month ${targetDate.slice(0, 7)}`);
  const departure = page.locator('input[aria-label="Partida"]');
  if (await departure.count()) {
    await departure.first().click();
    await page.waitForTimeout(1000);
    log('[STEP] departure calendar opened first time');
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(1000);
    log('[STEP] departure calendar closed after warm-up');
    await departure.first().click();
    await page.waitForTimeout(1000);
    log('[STEP] departure calendar opened second time');
  }
  const calendar = page.locator('div.oB61Xb[role="dialog"], div.oB61Xb').filter({ has: page.locator('[role="grid"]') }).last();
  const targetMonth = targetDate.slice(0, 7);
  const nextMonth = isoPlusDays(`${targetMonth}-01`, 32).slice(0, 7);
  for (let attempt = 0; attempt < 12; attempt++) {
    const visibleTarget = calendar.locator(`[role="gridcell"][data-iso^="${targetMonth}"]:visible, [role="gridcell"][data-iso^="${nextMonth}"]:visible`);
    if (await visibleTarget.count().catch(() => 0)) break;
    const forward = calendar.getByRole('button', { name: 'Avançar' }).first();
    if (!await forward.count()) break;
    await forward.click();
    await page.waitForTimeout(300);
  }
  const targets = calendar.locator(`[role="gridcell"][data-iso^="${targetMonth}"]:visible, [role="gridcell"][data-iso^="${nextMonth}"]:visible`);
  const count = Math.min(await targets.count().catch(() => 0), 180);
  log(`[STEP] hovering calendar dates in target and following month: ${count} dates`);
  log('[STEP] fast calendar hover pass without waiting');
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!await target.isVisible().catch(() => false)) continue;
    const box = await target.boundingBox().catch(() => null);
    if (!box) continue;
    const hoverTarget = target.locator('.p1BRgf, [jsname="nEWxA"]').first();
    const hoverBox = await hoverTarget.boundingBox().catch(() => null);
    const point = hoverBox || box;
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2, { steps: 2 }).catch(() => {});
  }
  log('[STEP] starting calendar hover pass with state waits');
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!await target.isVisible().catch(() => false)) continue;
    const box = await target.boundingBox().catch(() => null);
    if (!box) continue;
    const iso = await target.getAttribute('data-iso').catch(() => null);
    const hoverTarget = target.locator('.p1BRgf, [jsname="nEWxA"]').first();
    const hoverBox = await hoverTarget.boundingBox().catch(() => null);
    const point = hoverBox || box;
    await page.mouse.move(point.x + point.width / 2, point.y + point.height / 2, { steps: 8 }).catch(() => {});
    const settleDeadline = Date.now() + Number(process.env.DATE_SETTLE_TIMEOUT ?? 15000);
    let settled = false;
    while (Date.now() < settleDeadline) {
      const loading = await target.evaluate((el) => {
        const nodes = [el, ...el.querySelectorAll('*')];
        return nodes.some((node) => {
          const style = getComputedStyle(node);
          const className = typeof node.className === 'string' ? node.className : '';
          return /blur/i.test(style.filter || '') || /blur|loading|progress/i.test(className) || /Getting prices|A obter preços/i.test(node.textContent || '');
        });
      }).catch(() => false);
      if (!loading) { settled = true; break; }
      await page.waitForTimeout(250);
    }
    if (!settled) log(`Date hover timeout: ${iso || i + 1}`);
    log(`Date hover completed: ${iso || i + 1}/${count}`);
  }
  await page.keyboard.press('Escape').catch(() => {});
  log('[STEP] departure calendar closed without changing the date');
}
async function hoverGraphTargets(page) {
  log('[STEP] hovering across Price Graph bars');
  const overlay = page.locator('rect.N4v6Cc:visible').first();
  const box = await overlay.boundingBox().catch(() => null);
  const pause = Number(process.env.HOVER_WAIT ?? 800);
  if (box) {
    const points = Math.max(21, Math.min(60, Number(process.env.GRAPH_HOVER_POINTS ?? 60)));
    const y = box.y + box.height / 2;
    log(`[STEP] fast Price Graph hover pass without waiting: ${points} positions`);
    for (let i = 0; i < points; i++) {
      const x = box.x + (box.width * i) / Math.max(1, points - 1);
      await page.mouse.move(x, y, { steps: 2 }).catch(() => {});
    }
    log('[STEP] starting Price Graph hover pass with state waits');
    for (let i = 0; i < points; i++) {
      const x = box.x + (box.width * i) / Math.max(1, points - 1);
      await page.mouse.move(x, y, { steps: 4 }).catch(() => {});
      await waitForPriceLoadingToFinish(page, Number(process.env.BAR_SETTLE_TIMEOUT ?? 15000));
    }
    log(`[STEP] Price Graph hover completed inside rect.N4v6Cc: ${points} horizontal positions`);
    return;
  }
  const groups = page.locator('g.SFDJge:visible');
  const count = Math.min(await groups.count().catch(() => 0), 60);
  log(`[STEP] rect.N4v6Cc not found; using ${count} g.SFDJge bars`);
  log('[STEP] fast bar hover pass without waiting');
  for (let i = 0; i < count; i++) {
    const barBox = await groups.nth(i).boundingBox().catch(() => null);
    if (!barBox) continue;
    await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2, { steps: 2 }).catch(() => {});
  }
  log('[STEP] starting bar hover pass with state waits');
  for (let i = 0; i < count; i++) {
    const bar = groups.nth(i);
    const barBox = await bar.boundingBox().catch(() => null);
    if (!barBox) continue;
    await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2, { steps: 4 }).catch(() => {});
    await waitForPriceLoadingToFinish(page, Number(process.env.BAR_SETTLE_TIMEOUT ?? 15000));
  }
  log(`[STEP] Price Graph hover completed inside g.SFDJge: ${count} bars`);
}
async function runScan(URL, targetStart, targetEnd, duration, shared = null, options = {}) {
  log('Starting Chromium navigation test');
  const ownsBrowser = !shared;
  const headless = !/^(false|0|no)$/i.test(String(process.env.HEADLESS ?? 'true').trim());
  log(`${shared ? 'Reusing existing Chromium/page' : 'Chromium launch mode: ' + (headless ? 'headless' : 'visible')} (HEADLESS=${process.env.HEADLESS ?? '<unset>'})`);
  const slowMo = Number(process.env.SLOW_MO ?? (headless ? 0 : 100));
  const browser = shared?.browser || await chromium.launch({ headless, slowMo, args: ['--lang=pt-PT'] });
  const context = shared?.context || await browser.newContext({ locale: 'pt-PT', extraHTTPHeaders: { 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8' } });
  const page = shared?.page || await context.newPage();
  page.removeAllListeners('response');
  const graphResponseQueue = [];
  const ignoredGraphResponses = [];
  page.on('response', async (response) => {
    if (!response.url().includes('GetCalendarGraph')) return;
    try {
      const raw = await response.body();
      graphResponseQueue.push({ response, raw, records: parseCalendar(raw.toString('utf8')) });
    } catch (error) {
      log(`GetCalendarGraph response body unavailable: ${error.message}`);
    }
  });
  if (!options.skipNavigation) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  } else {
    log('Manual navigation mode: keeping the page opened by the user');
  }
  if (page.url().includes('consent.google.com')) {
    const reject = page.locator('button, [role="button"], input[type="submit"], input[type="button"]')
      .filter({ hasText: /reject all|recusar todos|recusar tudo|rejeitar tudo|decline all/i })
      .or(page.locator('[aria-label="Reject all"], [aria-label="Recusar tudo"], [aria-label="Rejeitar tudo"]'))
      .first();
    if (await reject.count()) { await reject.click(); await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}); log('Consent rejected'); }
    else log('Consent page detected but reject-all control was not found');
  }
  const readyDeadline = Date.now() + 60000;
  let graphReady = false;
  let reloadsAfterOops = 0;
  while (Date.now() < readyDeadline) {
    const graphProbe = page.locator('button').filter({ hasText: /price graph|gráfico de preços/i }).first();
    const fallbackProbe = page.getByText('Gráfico de preços', { exact: true }).or(page.getByText('Price graph', { exact: true })).first();
    const graphCount = await graphProbe.count().catch(() => 0) + await fallbackProbe.count().catch(() => 0);
    const body = await page.locator('body').innerText().catch(() => '');
    if (/(Oops, something went wrong|Ups! Algo correu mal)/i.test(body) && reloadsAfterOops < 1) {
      reloadsAfterOops++;
      log(`Oops detected during initial load; reloading immediately (attempt ${reloadsAfterOops}/1)`);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(error => log(`Reload after Oops failed: ${error.message}`));
      if (page.url().includes('consent.google.com')) {
        const rejectAfterReload = page.locator('button, [role="button"], input[type="submit"], input[type="button"]')
          .filter({ hasText: /reject all|recusar todos|recusar tudo|rejeitar tudo|decline all/i })
          .or(page.locator('[aria-label="Reject all"], [aria-label="Recusar tudo"], [aria-label="Rejeitar tudo"]'))
          .first();
        if (await rejectAfterReload.count()) {
          await rejectAfterReload.click().catch(() => {});
          await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
          log('Consent rejected after reload');
        }
      }
      continue;
    }
    if (graphCount > 0 && !/(Oops, something went wrong|Ups! Algo correu mal)/i.test(body)) { graphReady = true; break; }
    await page.waitForTimeout(1000);
  }
  log(`Ready wait finished: graphReady=${graphReady} elapsedMs=${60000 - Math.max(0, readyDeadline - Date.now())}`);
  log(`Page loaded: ${await page.title()} url=${page.url()}`);
  const bodyText = await page.locator('body').innerText();
  log(`Rendered price-filter labels: ${JSON.stringify(bodyText.match(/up to €\d+|até €\s?\d+|€\d+ and up|No options matching your filters|Não há nenhum resultado para seus filtros|Oops, something went wrong|Ups! Algo correu mal/gi) || [])}`);

  log(`Duration ${duration}: scanning ${targetStart} -> ${targetEnd}`);
  log(`Using user-provided URL without modification`);
  await hoverDateTargets(page, targetStart);
  await waitForPriceLoadingToFinish(page, 30000);

  let graph = page.locator('button').filter({ hasText: /price graph|gráfico de preços/i }).first();
  if (!await graph.count()) {
    log('Role selector did not find graph; trying exact text fallback');
    const fallback = page.getByText('Gráfico de preços', { exact: true }).or(page.getByText('Price graph', { exact: true })).first();
    if (await fallback.count()) graph = fallback;
  }
  if (!await graph.count()) {
    log('Price Graph not present yet; waiting an additional 20 seconds before declaring this attempt failed');
    await page.waitForTimeout(20000);
    graph = page.locator('button').filter({ hasText: /price graph|gráfico de preços/i }).first();
    if (!await graph.count()) {
      const fallback = page.getByText('Gráfico de preços', { exact: true }).or(page.getByText('Price graph', { exact: true })).first();
      if (await fallback.count()) graph = fallback;
    }
  }
  if (!await graph.count()) {
    await page.screenshot({ path: path.join(OUT, 'navigation-failure.png'), fullPage: false }).catch(() => {});
    fs.writeFileSync(path.join(OUT, 'navigation-failure.html'), await page.content(), 'utf8');
    throw new Error('Price graph button not found; saved navigation-failure.png and navigation-failure.html');
  }
  await graph.waitFor({ state: 'visible', timeout: 30000 });
  log('[STEP] Price Graph button found; opening graph first time');
  const firstResponsePromise = nextValidGraphResponse(graphResponseQueue, ignoredGraphResponses);
  await graph.click();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(1000);
  log('[STEP] Price Graph closed after warm-up');
  await graph.click();
  await page.waitForTimeout(1000);
  log('[STEP] Price Graph opened second time');
  await hoverGraphTargets(page);
  const response0 = await firstResponsePromise;
  await waitForPriceLoadingToFinish(page);
  if (!response0 || response0.records.length !== 60) {
    throw new Error(`Initial GetCalendarGraph did not contain 60 valid points (received ${response0?.records.length || 0}); stopping before any arrow click`);
  }

  async function saveWindow(index, captured) {
    if (!captured) throw new Error(`Window ${index}: no valid GetCalendarGraph response with date records was captured before timeout`);
    const { response, raw, records } = captured;
    const rawPath = path.join(OUT, `window-${index}.bin`);
    fs.writeFileSync(rawPath, raw);
    const data = { window: index, capturedAt: new Date().toISOString(), requestUrl: response.url(), responseBytes: raw.length, records };
    fs.writeFileSync(path.join(OUT, `window-${index}.json`), JSON.stringify(data, null, 2));
    log(`Window ${index}: GetCalendarGraph captured, ${records.length} records, ${records.filter(x => x.price !== null).length} prices, ${records[0]?.departure_date} -> ${records.at(-1)?.departure_date}`);
    return records;
  }
  const windows = [await saveWindow(0, response0)];
  let calendar = new Map(windows[0].map(record => [record.departure_date, record]));
  const deltas = [];

  async function clickNext(index) {
    const arrows = page.locator('button[aria-label="Deslocar para a frente"], button[aria-label="Rolar para a frente"], button[aria-label="Scroll forward"]');
    const count = await arrows.count();
    log(`Window ${index}: forward-arrow buttons found=${count}`);
    if (!count) {
      const visibleButtons = await page.locator('button:visible').evaluateAll(btns => btns.map(b => ({ aria: b.getAttribute('aria-label'), text: (b.innerText || '').trim(), title: b.getAttribute('title') })).filter(x => x.aria || x.text || x.title));
      log(`Visible button inventory: ${JSON.stringify(visibleButtons)}`);
      throw new Error('Price graph right arrow not found (Deslocar para a frente / Rolar para a frente / Scroll forward)');
    }
    const arrow = arrows.last();
    log(`Window ${index}: arrow visible=${await arrow.isVisible()} enabled=${await arrow.isEnabled()}`);
    if (!await arrow.isVisible() || !await arrow.isEnabled()) throw new Error('Price graph forward arrow is not visible or enabled');
    const nextResponse = nextValidGraphResponse(graphResponseQueue, ignoredGraphResponses);
    await arrow.click();
    log(`Window ${index}: right arrow clicked once`);
    const response = await nextResponse;
    log(`Window ${index}: re-hovering visible Price Graph bars after arrow click`);
    await hoverGraphTargets(page);
    await waitForPriceLoadingToFinish(page);
    const records = await saveWindow(index, response);
    const previousCalendar = sortRecords([...calendar.values()]);
    const ordered = sortRecords(records);
    const previousLast = previousCalendar.at(-1)?.departure_date;
    const cmp = compare(previousCalendar, records);
    const expectedFirst = previousLast ? new Date(Date.parse(previousLast) + 86400000).toISOString().slice(0, 10) : null;
    const expectedLast = ordered.length && expectedFirst ? new Date(Date.parse(expectedFirst) + (ordered.length - 1) * 86400000).toISOString().slice(0, 10) : null;
    const delta = { index, pointsReceived: records.length, firstDeparture: ordered[0]?.departure_date || null, lastDeparture: ordered.at(-1)?.departure_date || null, overlapWithAccumulated: cmp.overlap, consecutive: consecutive(records), immediatelyAfterPrevious: ordered[0]?.departure_date === expectedFirst && ordered.at(-1)?.departure_date === expectedLast, expectedFirst, expectedLast };
    deltas.push(delta);
    log(`Delta ${index}: ${records.length} points ${delta.firstDeparture} -> ${delta.lastDeparture}; overlap=${delta.overlapWithAccumulated}; consecutive=${delta.consecutive}; immediatelyAfterPrevious=${delta.immediatelyAfterPrevious}`);
    log(`Delta ${index}: dates=${ordered.map(record => record.departure_date).join(', ')}`);
    for (const record of records) calendar.set(record.departure_date, record);
    windows.push(records);
    // The network response can arrive before the graph has committed the new
    // window to the UI. Manual clicks naturally include this settling time.
    await page.waitForTimeout(5000);
  }
  async function clickNextWithRetry(index) {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await clickNext(index);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          log(`Window ${index}: advance attempt failed (${error.message}); retrying same arrow on the existing page`);
          await page.waitForTimeout(5000);
        }
      }
    }
    throw lastError;
  }
  while (sortRecords([...calendar.values()]).at(-1)?.departure_date < targetEnd) {
    await clickNextWithRetry(deltas.length + 1);
  }
  const c01 = compare(windows[0], windows[1]);
  const summary = {
    windows: [{ index: 0, departureStart: sortRecords(windows[0])[0]?.departure_date, departureEnd: sortRecords(windows[0]).at(-1)?.departure_date, pointsReceived: windows[0].length, newPoints: windows[0].length }, ...deltas.map(delta => ({ index: delta.index, departureStart: delta.firstDeparture, departureEnd: delta.lastDeparture, pointsReceived: delta.pointsReceived, newPoints: delta.pointsReceived, ...delta }))],
    totalUniqueDates: calendar.size,
    ignoredGraphResponses,
    calendar: sortRecords([...calendar.values()]),
    comparisons: { window0To1: c01 },
    target: { start: targetStart, end: targetEnd, present: calendar.has(targetStart) && calendar.has(targetEnd), missing: (() => { const missing = []; for (let t = targetStart; t <= targetEnd; t = isoPlusDays(t, 1)) if (!calendar.has(t)) missing.push(t); return missing; })(), outsideBefore: sortRecords([...calendar.values()]).filter(r => r.departure_date < targetStart).map(r => r.departure_date), outsideAfter: sortRecords([...calendar.values()]).filter(r => r.departure_date > targetEnd).map(r => r.departure_date) },
    confirms: { sixtyRecordsInitial: windows[0].length === 60, eachDelta21: deltas.every(delta => delta.pointsReceived === 21), eachDeltaConsecutive: deltas.every(delta => delta.consecutive), eachDeltaImmediatelyAfterPrevious: deltas.every(delta => delta.immediatelyAfterPrevious), accumulatedUniqueDates: calendar.size, targetComplete: (() => { for (let t = targetStart; t <= targetEnd; t = isoPlusDays(t, 1)) if (!calendar.has(t)) return false; return true; })() }
  };
  fs.writeFileSync(path.join(OUT, `navigation-summary-${duration}.json`), JSON.stringify(summary, null, 2));
  console.table(summary.windows);
  console.log(JSON.stringify(summary.comparisons, null, 2));
  console.log(JSON.stringify(summary.confirms, null, 2));
  if (ownsBrowser) {
    await browser.close();
    log('Chromium closed');
  } else {
    log('Chromium kept open for next duration');
  }
  return summary;
}

async function main() {
  const requestedStart = process.env.START_DATE || '2027-02-08';
  const targetStart = process.env.COVERAGE_START || isoPlusDays(requestedStart, -7);
  const targetEnd = process.env.TARGET_END || '2027-05-31';
  const durations = {};
  const headless = !/^(false|0|no)$/i.test(String(process.env.HEADLESS ?? 'true').trim());
  const slowMo = Number(process.env.SLOW_MO ?? (headless ? 0 : 100));
  const browser = await chromium.launch({ headless, slowMo, args: ['--lang=pt-PT'] });
  const context = await browser.newContext({ locale: 'pt-PT', extraHTTPHeaders: { 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8' } });
  const page = await context.newPage();
  const shared = { browser, context, page };
  let manualReady = false;
  if (/^(true|1|yes)$/i.test(String(process.env.MANUAL_NAVIGATION ?? 'false'))) {
    await page.goto('about:blank');
    const flag = path.join(OUT, 'manual-continue.flag');
    try { fs.unlinkSync(flag); } catch {}
    log('MANUAL: Chromium opened on about:blank; navigate manually and resolve any Google verification if shown');
    log('MANUAL: after the results and Price Graph are ready, create artifacts/manual-continue.flag');
    while (!fs.existsSync(flag)) await new Promise(resolve => setTimeout(resolve, 500));
    manualReady = true;
    log(`MANUAL: continuation received; current URL=${page.url()}`);
  }
  for (const duration of DURATIONS) {
    let workingStart = requestedStart; let result = null; let attempts = 0; let shiftDays = 0;
    while (!result && shiftDays <= 10) {
      const workingReturn = isoPlusDays(workingStart, duration);
      if (dayDiff(workingStart, workingReturn) !== duration) throw new Error(`Duration ${duration} URL validation failed`);
      const url = urlForDates(workingStart, workingReturn);
      for (let attempt = 1; attempt <= 2 && !result; attempt++) {
        attempts++;
        log(`Duration ${duration}: attempt=${attempts} start=${workingStart} return=${workingReturn} shift=${shiftDays}`);
        try {
          result = await runScan(url, workingStart, targetEnd, duration, shared, { skipNavigation: manualReady });
          manualReady = false;
        } catch (error) {
          log(`Duration ${duration}: attempt failed: ${error.message}`);
          if (shared.page.isClosed()) {
            log('Shared page was closed unexpectedly; creating a replacement page in the same browser/context');
            shared.page = await shared.context.newPage();
          }
        }
      }
      if (!result) { shiftDays++; workingStart = isoPlusDays(requestedStart, shiftDays); }
    }
    durations[String(duration)] = result ? { ...result, metadata: { requested_start_date: targetStart, working_start_date: workingStart, working_return_date: isoPlusDays(workingStart, duration), date_shift_days: shiftDays, attempts_before_success: attempts, status: 'success', number_of_points: result.totalUniqueDates, number_of_null_prices: result.calendar.filter(x => x.price === null).length, number_of_advances: result.windows.length - 1 } } : { metadata: { requested_start_date: targetStart, working_start_date: null, working_return_date: null, date_shift_days: null, attempts_before_success: attempts, status: 'no_working_graph' }, calendar: [] };
    fs.writeFileSync(path.join(OUT, 'price-scanner-80-90.json'), JSON.stringify({ search: { requested_departure: requestedStart, departure_from: targetStart, departure_to: targetEnd, duration_from: DURATION_FROM, duration_to: DURATION_TO }, durations }, null, 2));
  }
  await browser.close();
  log('Chromium closed');
  log('PRICE SCANNER 80-90 COMPLETE');
}
main().catch(e => { console.error(`[${new Date().toISOString()}] TEST FAILED: ${e.stack || e.message}`); process.exitCode = 1; });
