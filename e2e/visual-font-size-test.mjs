/**
 * Local visual QA: overlay font size vs original glyph scale on a known poster.
 *
 * Usage: node e2e/visual-font-size-test.mjs
 * Requires GOOGLE_API_KEY in .env
 */
import { chromium } from 'playwright';
import { createServer } from 'http';
import {
  rmSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXT_PATH = join(ROOT, 'dist');
const FIXTURE_DIR = join(__dirname, 'fixtures');
const OUT_DIR = join(__dirname, 'visual-results');
const userDataDir = join(ROOT, '.visual-chrome-profile');
const PAGE_PORT = 8791;

function loadEnvFile() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnvFile();
const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY || '').trim();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

function startFixtureServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const path = (req.url || '/').split('?')[0];
      const file =
        path === '/' ? 'font-size-sample.html' : path.replace(/^\//, '');
      const full = join(FIXTURE_DIR, file);
      if (!full.startsWith(FIXTURE_DIR) || !existsSync(full)) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(full)] || 'application/octet-stream' });
      res.end(readFileSync(full));
    });
    server.listen(PAGE_PORT, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${PAGE_PORT}/`,
        close: () =>
          new Promise((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
    server.on('error', reject);
  });
}

async function waitForServiceWorker(context, timeoutMs = 45000) {
  const existing = context.serviceWorkers();
  if (existing.length > 0) return existing[0];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for extension service worker')),
      timeoutMs,
    );
    context.once('serviceworker', (sw) => {
      clearTimeout(timer);
      resolve(sw);
    });
  });
}

function extensionIdFromWorker(worker) {
  const url = worker.url();
  const match = url.match(/^chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error(`Could not parse extension id from ${url}`);
  return match[1];
}

async function configureExtension(context, extensionId, apiKey) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await page.evaluate(async (google) => {
    await chrome.storage.sync.set({
      settings: {
        enabled: true,
        sourceLang: 'auto',
        targetLang: 'en',
        provider: 'google',
        apiKeys: { google },
        ocrMode: 'cloud',
        translateImages: true,
        siteBlocklist: [],
      },
    });
  }, apiKey);
  await page.close();
}

async function collectFontMetrics(page) {
  return page.evaluate(() => {
    const overlays = [...document.querySelectorAll('.lt-overlay')];
    return overlays.map((o) => {
      const r = o.getBoundingClientRect();
      const text = (o.textContent ?? '').trim();
      const fontSize = parseFloat(getComputedStyle(o).fontSize) || 0;
      const lines = Math.max(
        1,
        Math.round(
          (o.querySelector('.lt-overlay-text')?.scrollHeight || r.height) /
            Math.max(1, fontSize * 1.05),
        ),
      );
      const expected = (r.height / lines) * 0.85;
      const ratio = expected > 0 ? fontSize / expected : 0;
      return {
        text: text.slice(0, 60),
        w: Math.round(r.width),
        h: Math.round(r.height),
        fontSize: Math.round(fontSize),
        lines,
        expectedMin: Math.round(expected),
        ratio: +ratio.toFixed(2),
        // Large display boxes must stay near original glyph height.
        tooSmall: r.height >= 36 && ratio < 0.7,
      };
    });
  });
}

async function run() {
  if (!GOOGLE_API_KEY) {
    throw new Error('GOOGLE_API_KEY required in .env');
  }
  if (!existsSync(join(EXT_PATH, 'manifest.json'))) {
    throw new Error('dist/ missing — run npm run build first');
  }
  if (!existsSync(join(FIXTURE_DIR, 'font-size-sample.jpg'))) {
    throw new Error('e2e/fixtures/font-size-sample.jpg missing');
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });

  const server = await startFixtureServer();
  console.log(`Fixture page at ${server.url}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 1280, height: 900 },
  });

  const report = {
    startedAt: new Date().toISOString(),
    url: server.url,
    overlays: [],
    issues: [],
  };

  try {
    const worker = await waitForServiceWorker(context);
    const extensionId = extensionIdFromWorker(worker);
    console.log(`Extension ID: ${extensionId}`);
    await configureExtension(context, extensionId, GOOGLE_API_KEY);

    const page = await context.newPage();
    page.on('console', (msg) => {
      const t = msg.text();
      if (t.includes('Live Translate')) console.log(`  [console] ${t.slice(0, 200)}`);
    });

    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sample', { timeout: 10000 });
    // Wait for OCR overlays
    await page.waitForFunction(
      () => document.querySelectorAll('.lt-overlay').length > 0,
      null,
      { timeout: 90000 },
    );
    await page.waitForTimeout(2500);

    const shot = join(OUT_DIR, 'font-size-sample.png');
    await page.screenshot({ path: shot, fullPage: true });
    report.screenshot = shot;

    const overlays = await collectFontMetrics(page);
    report.overlays = overlays;
    report.overlayCount = overlays.length;

    console.log(`\nOverlays: ${overlays.length}`);
    for (const o of overlays) {
      const mark = o.tooSmall ? 'TOO_SMALL' : 'ok';
      console.log(
        `  [${mark}] ${o.fontSize}px (min~${o.expectedMin}, ratio ${o.ratio}) ${o.w}x${o.h} "${o.text}"`,
      );
      if (o.tooSmall) {
        report.issues.push(
          `Overlay too small vs box: font ${o.fontSize}px < ~${o.expectedMin}px for "${o.text}"`,
        );
      }
    }

    // Title-like overlays (tall or wide display text) must mostly match.
    const display = overlays.filter((o) => o.h >= 40 || (o.w >= 280 && o.h >= 28));
    const badDisplay = display.filter((o) => o.tooSmall);
    if (display.length === 0) {
      report.issues.push('No display-sized overlays found');
    } else if (badDisplay.length > 0) {
      report.issues.push(
        `${badDisplay.length}/${display.length} display overlay(s) much smaller than original glyphs`,
      );
    }

    await page.close();
  } finally {
    await context.close().catch(() => {});
    await server.close().catch(() => {});
  }

  report.finishedAt = new Date().toISOString();
  report.ok = report.issues.length === 0;
  const reportPath = join(OUT_DIR, 'font-size-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport: ${reportPath}`);
  console.log(`ok=${report.ok} issues=${report.issues.length}`);
  for (const i of report.issues) console.log(`  - ${i}`);

  if (!report.ok) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
