// Takes Emberline's screenshots in headless Chromium: serves game/, loads each
// ?shot= scene, waits for window.__shotReady, and writes a 1280x720 JPEG.
// Usage: node shot.mjs [browser-executable] — with no argument it uses
// playwright's bundled chromium, or the chrome-headless-shell under
// ~/.cache/puppeteer when that is all there is.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '/tmp/pwtest/node_modules/playwright/index.mjs';

const SHOTS = [
  ['1-combat', 'combat'],
  ['2-start', 'start'],
  ['3-buy', 'buy'],
  ['4-plant', 'plant'],
];

function findBrowser() {
  if (process.argv[2]) return process.argv[2];
  const home = process.env.HOME;
  for (const base of [join(home, '.cache', 'ms-playwright'), join(home, '.cache', 'puppeteer')]) {
    if (!existsSync(base)) continue;
    const found = [];
    (function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/^(chrome|chrome-headless-shell|headless_shell)$/.test(entry.name) && statSync(p).size > 1000000) found.push(p);
      }
    })(base);
    if (found.length) return found.sort().at(-1);
  }
  return undefined; // playwright's own bundled chromium
}

const executablePath = findBrowser();
console.log('browser:', executablePath ?? '(playwright bundled)');
const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (msg) => { if (msg.type() === 'error') console.log('page error:', msg.text()); });
page.on('pageerror', (err) => console.log('pageerror:', String(err).slice(0, 300)));
for (const [name, shot] of SHOTS) {
  await page.goto(`http://localhost:8080/?shot=${shot}&seed=1`, { waitUntil: 'load' });
  try {
    await page.waitForFunction(() => window.__shotReady, null, { timeout: 30000 });
  } catch {
    console.log(`TIMEOUT waiting for __shotReady on ${shot}; shooting anyway`);
  }
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/${name}.jpg`, type: 'jpeg', quality: 82 });
  console.log('wrote', `screenshots/${name}.jpg`);
}
await browser.close();
