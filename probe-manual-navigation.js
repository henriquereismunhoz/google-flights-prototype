const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = __dirname;
const artifacts = path.join(root, 'artifacts');
const continueFlag = path.join(artifacts, 'manual-continue.flag');
fs.mkdirSync(artifacts, { recursive: true });
try { fs.unlinkSync(continueFlag); } catch {}

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--lang=pt-PT'], slowMo: 100 });
  const context = await browser.newContext({ locale: 'pt-PT', extraHTTPHeaders: { 'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8' } });
  const page = await context.newPage();
  await page.goto('about:blank');
  console.log('[MANUAL] Chromium aberto em about:blank. Navegue manualmente até ao Google Flights.');
  console.log('[MANUAL] Depois de confirmar que os resultados/preços carregaram, clique em Continuar automação.');
  while (!fs.existsSync(continueFlag)) await new Promise(resolve => setTimeout(resolve, 500));
  const state = { continuedAt: new Date().toISOString(), url: page.url(), title: await page.title(), text: (await page.locator('body').innerText().catch(() => '')).slice(0, 2000) };
  fs.writeFileSync(path.join(artifacts, 'manual-navigation-state.json'), JSON.stringify(state, null, 2));
  console.log(`[MANUAL] Continuação recebida. URL atual: ${state.url}`);
  console.log('[MANUAL] Estado guardado em artifacts/manual-navigation-state.json');
  console.log('[MANUAL] Pré-validação concluída; a integração com o scanner será feita no próximo passo.');
  await browser.close();
})().catch(error => { console.error(`[MANUAL] Erro: ${error.stack || error.message}`); process.exitCode = 1; });
