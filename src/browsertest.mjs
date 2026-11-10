import puppeteer from 'puppeteer-core';
import path from 'path';

const file = 'file://' + path.resolve('index.html');
const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome-stable',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--allow-file-access-from-files']
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(file, { waitUntil: 'networkidle0' });
let fails = 0;
const check = async (name, fn) => {
  try { const r = await fn(); if (r === false) throw new Error('assertion false'); console.log('  PASS ' + name); }
  catch (e) { fails++; console.log('  FAIL ' + name + ' — ' + e.message); }
};

console.log('== explorer');
const cards = await page.$$eval('.wcard', els => els.length);
await check('grid renders every weight (' + cards + ')', () => cards === 23);
const stats = await page.$$eval('.stat .v', els => els.map(e => e.textContent));
await check('summary stats present', () => stats.length === 5);
await page.screenshot({ path: 'shot-explorer.png' });

// filters
await page.select('select[data-filter="kind"]', 'derived');
const derived = await page.$$eval('.wcard', els => els.length);
await check('derived filter narrows to 4', () => derived === 4);
await page.select('select[data-filter="kind"]', 'all');
await page.click('#q');
await page.type('#q', 'perplexity');
await new Promise(r => setTimeout(r, 400));
const searched = await page.$$eval('.wcard .nm', els => els.map(e => e.textContent));
await check('premise search finds qkv (' + searched.join(',') + ')', () => searched.length > 0 && searched.some(s => s.includes('qkv')));
await page.evaluate(() => { const i = document.querySelector('#q'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
await new Promise(r => setTimeout(r, 300));

console.log('== graph');
await page.click('.wcard[data-id="w-b7-qkv"]');
await new Promise(r => setTimeout(r, 350));
await check('graph view active', () => page.$eval('#view', v => v.innerHTML.includes('Why this value')));
const nodes = await page.$$eval('svg.g .node', els => els.length);
await check('graph has nodes (' + nodes + ')', () => nodes >= 8);
const ledger = await page.$eval('.ledger', el => el.innerText);
await check('ledger shows anchor and all four events', () => ledger.includes('anchor') && ledger.includes('e-b7qkv-1') && ledger.includes('e-b7qkv-4'));
await page.screenshot({ path: 'shot-graph.png' });

console.log('== withdraw from graph');
await page.evaluate(() => {
  const b = Array.from(document.querySelectorAll('[data-act="withdraw-open"]')).find(x => x.dataset.id === 'R-LEARN1');
  b.click();
});
await new Promise(r => setTimeout(r, 250));
const coneText = await page.$eval('.modal', el => el.innerText);
await check('cone preview lists the two learn-1 events', () => coneText.includes('e-b7qkv-1') && coneText.includes('e-b7qkv-3') && coneText.includes('falls 2 events'));
await page.screenshot({ path: 'shot-cone.png' });
await page.evaluate(() => document.querySelector('[data-act="withdraw-confirm"]').click());
await new Promise(r => setTimeout(r, 400));
const chips = await page.$$eval('.chip.warn', els => els.map(e => e.textContent));
await check('qkv shows changed-by-withdrawal chip', () => chips.some(c => c.includes('changed by withdrawal')));

console.log('== retraction view');
await page.click('[data-act="nav"][data-view="retraction"]');
await new Promise(r => setTimeout(r, 350));
const rows = await page.$$eval('.dtable tbody tr', els => els.map(e => ({
  name: e.querySelector('.wname').textContent,
  norm: e.children[4].textContent,
  depth: e.children[1].textContent
})));
console.log('    diff rows: ' + JSON.stringify(rows));
await check('diff rows = qkv + 2 views', () => rows.length === 3);
await page.screenshot({ path: 'shot-retraction.png', fullPage: false });
const summary = await page.$$eval('.stats .v', els => els.map(e => e.textContent));
await check('summary says 3 weights recomputed', () => summary[0] === '3');

console.log('== persistence');
await page.click('[data-act="save-open"]');
await new Promise(r => setTimeout(r, 200));
await page.evaluate(() => { document.querySelector('#expname').value = 'learn-1 retracted'; });
await page.evaluate(() => { document.querySelector('#expnote').value = 'two learn-1 events fall, views follow'; });
await page.evaluate(() => document.querySelector('[data-act="save-confirm"]').click());
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => {
  const ta = document.querySelector('[data-note="weight"]');
  if (ta) { ta.value = 'checked: diff matches anchor arithmetic'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
});
await page.evaluate(() => { document.querySelector('[data-act="nav"][data-view="graph"]').click(); });
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => {
  const ta = document.querySelector('[data-note="weight"]');
  ta.value = 'checked: diff matches anchor arithmetic';
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 500));
await page.reload({ waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 400));
const restored = await page.evaluate(() => ({
  withdrawn: document.querySelector('#tab-withdrawn').textContent,
  view: document.querySelector('.tab[aria-selected="true"]').dataset.view,
  note: document.querySelector('[data-note="weight"]') ? document.querySelector('[data-note="weight"]').value : null,
  saved: document.querySelector('#tab-withdrawn').textContent
}));
console.log('    restored: ' + JSON.stringify(restored));
await check('withdrawn set survived reload', () => restored.withdrawn === '1');
await check('weight note survived reload', () => (restored.note || '').includes('anchor arithmetic'));

console.log('== saved explorations drawer');
await page.click('[data-act="drawer-open"]');
await new Promise(r => setTimeout(r, 250));
const exp = await page.$$eval('.expl', els => els.map(e => e.innerText));
await check('saved exploration listed', () => exp.length === 1 && exp[0].includes('learn-1 retracted'));
await page.screenshot({ path: 'shot-drawer.png' });
await page.evaluate(() => document.querySelector('[data-act="drawer-close"]').click());

console.log('== multi withdrawal + restore + reset');
await page.click('[data-act="nav"][data-view="retraction"]');
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => { const b = document.querySelector('[data-act="withdraw-open"][data-id="C-EQUALIZE"]'); b.click(); });
await new Promise(r => setTimeout(r, 200));
await page.evaluate(() => document.querySelector('[data-act="withdraw-confirm"]').click());
await new Promise(r => setTimeout(r, 350));
const rows2 = await page.$$eval('.dtable tbody tr', els => els.length);
await check('multi withdrawal recomputes more weights (' + rows2 + ')', () => rows2 > 3);
const strip = await page.$$eval('.wtag', els => els.length);
await check('withdrawn strip shows two tags', () => strip === 2);
await page.evaluate(() => document.querySelector('[data-act="undo"]').click());
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => document.querySelector('[data-act="reset-withdrawals"]').click());
await new Promise(r => setTimeout(r, 300));
const empty = await page.$eval('#view', v => v.innerText);
await check('reset returns to the empty diff state', () => /nothing withdrawn/i.test(empty));

console.log('== about');
await page.click('[data-act="nav"][data-view="about"]');
await new Promise(r => setTimeout(r, 300));
const about = await page.$eval('#view', v => v.innerText);
await check('about states what is simulated', () => /what is simulated/i.test(about) && /named gaps/i.test(about) && /no network/i.test(about));
await page.screenshot({ path: 'shot-about.png', fullPage: true });

console.log('== no dead buttons');
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 400));
const acts = await page.$$eval('[data-act]', els => Array.from(new Set(els.map(e => e.dataset.act))));
console.log('    acts present: ' + acts.join(', '));
const handled = new Set(['nav','select-weight','premise-detail','withdraw-open','withdraw-confirm','restore','modal-close','drawer-open','drawer-close','save-open','save-confirm','exploration-load','exploration-delete','exploration-export','export','clear-data','clear-confirm','copy-diff','clear-filters','reset-withdrawals','undo','none']);
await check('every rendered action is handled', () => acts.every(a => handled.has(a)));

console.log('== mobile');
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.reload({ waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 400));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await check('no horizontal page overflow on 390px (' + overflow + ')', () => overflow <= 0);
await page.screenshot({ path: 'shot-mobile.png' });
await page.click('[data-act="nav"][data-view="graph"]');
await new Promise(r => setTimeout(r, 400));
const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
await check('graph stays inside the viewport shell (' + overflow2 + ')', () => overflow2 <= 0);
await page.screenshot({ path: 'shot-mobile-graph.png' });

console.log('== console errors');
await check('no page errors (' + errors.slice(0, 5).join(' | ') + ')', () => errors.length === 0);

await browser.close();
console.log(fails ? '\n' + fails + ' FAILURES' : '\nall browser checks passed');
process.exit(fails ? 1 : 0);
