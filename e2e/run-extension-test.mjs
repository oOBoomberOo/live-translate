import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXT_PATH = join(ROOT, 'dist');
const FIXTURE_DIR = join(__dirname, 'fixtures');
const FIXTURE_HTML = join(FIXTURE_DIR, 'sample-page.html');
const PAGE_PORT = 8766;
const CDN_PORT = 8767;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'application/javascript',
};

function ensureFixtures() {
  const needed = [
    'bonjour.png',
    'cors-bonjour.png',
    'fox.png',
    'hello.png',
    'large-intrinsic.png',
    'vertical.png',
    'c/250x250/cors-bonjour.png',
  ];
  if (needed.some((f) => !existsSync(join(FIXTURE_DIR, f)))) {
    console.log('Generating image fixtures...');
    execFileSync(process.execPath, [join(__dirname, 'generate-fixtures.mjs')], {
      stdio: 'inherit',
    });
  }
}

function startDirServer(port, rootDir, { requireReferer = false } = {}) {
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (requireReferer) {
      const referer = req.headers.referer || '';
      if (!referer.includes('127.0.0.1') && !referer.includes('localhost')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Referer required');
        return;
      }
    }

    let pathName = (req.url || '/').split('?')[0];
    if (pathName === '/') pathName = '/index.html';
    const filePath = join(rootDir, pathName.replace(/^\//, ''));

    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    try {
      const data = readFileSync(filePath);
      const type = MIME[extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
    server.on('error', reject);
  });
}

function startPageServer(port, htmlPath, crossOriginImageUrl, thumbUrlImage) {
  let html = readFileSync(htmlPath, 'utf8');
  html = html.replace('__CROSS_ORIGIN_IMAGE__', crossOriginImageUrl);
  html = html.replace('__THUMB_URL_IMAGE__', thumbUrlImage);

  const server = createServer((req, res) => {
    const pathName = (req.url || '/').split('?')[0];
    if (pathName === '/' || pathName === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    const filePath = join(FIXTURE_DIR, pathName.replace(/^\//, ''));
    try {
      const data = readFileSync(filePath);
      const type = MIME[extname(filePath)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise((resClose, rejClose) => {
            server.close((err) => (err ? rejClose(err) : resClose()));
          }),
      });
    });
    server.on('error', reject);
  });
}

async function waitForServiceWorker(context, timeoutMs = 30000) {
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

async function configureExtension(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  await page.evaluate(async () => {
    const settings = {
      enabled: true,
      sourceLang: 'fr',
      targetLang: 'en',
      provider: 'mock',
      apiKeys: { google: '' },
      ocrMode: 'mock',
      translateImages: true,
      siteBlocklist: [],
    };
    await chrome.storage.sync.set({ settings });
  });
  await page.close();
}

async function assertTargetLanguageSkipped(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  const result = await page.evaluate(async () => {
    return chrome.runtime.sendMessage({
      type: 'TRANSLATE_TEXT',
      units: [{ id: 'english', text: 'Hello world' }],
      from: 'auto',
      to: 'en',
    });
  });
  await page.close();

  const translated = result?.results?.[0]?.translated;
  if (translated !== 'Hello world') {
    throw new Error(`Expected English target text to be skipped, got "${translated}"`);
  }
}

/**
 * Mock OCR path: OCR_IMAGE still carries `from` (sourceLang) for API compatibility.
 */
async function assertOcrThreadsSourceLang(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
  const result = await page.evaluate(async () => {
    // 1×1 PNG — mock OCR does not decode pixels; URL basename picks fixture text.
    const png =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    return chrome.runtime.sendMessage({
      type: 'OCR_IMAGE',
      id: 'lang-thread-test',
      url: 'http://127.0.0.1/hello.png',
      imageBase64: png,
      width: 1,
      height: 1,
      from: 'ja',
      to: 'en',
    });
  });
  await page.close();

  if (result?.error) {
    throw new Error(`OCR_IMAGE with from=ja failed: ${result.error}`);
  }
  if (!result?.result?.ocr?.boxes?.length) {
    throw new Error('Expected mock OCR boxes when threading sourceLang via from');
  }
}

async function waitForTranslated(page, selector, expected, timeoutMs = 20000) {
  await page.waitForFunction(
    ({ sel, text }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      if (!el.hasAttribute('data-lt-done')) return false;
      return (el.textContent ?? '').trim() === text;
    },
    { sel: selector, text: expected },
    { timeout: timeoutMs },
  );
}

async function waitForImageOverlay(page, imgSelector, expectedText, timeoutMs = 25000) {
  await page.waitForFunction(
    ({ sel, text }) => {
      const img = document.querySelector(sel);
      if (!img || !img.hasAttribute('data-lt-done')) return false;
      const container = img.closest('.lt-overlay-container');
      if (!container) return false;
      const overlays = [...container.querySelectorAll('.lt-overlay')];
      return overlays.some((o) => (o.textContent ?? '').trim() === text);
    },
    { sel: imgSelector, text: expectedText },
    { timeout: timeoutMs },
  );
}

async function waitForImageDone(page, imgSelector, timeoutMs = 25000) {
  await page.waitForFunction(
    (sel) => {
      const img = document.querySelector(sel);
      return Boolean(img?.hasAttribute('data-lt-done'));
    },
    imgSelector,
    { timeout: timeoutMs },
  );
}

async function waitForImageNotProcessed(page, imgSelector, timeoutMs = 5000) {
  await page.waitForTimeout(timeoutMs);
  const done = await page.locator(imgSelector).getAttribute('data-lt-done');
  const loading = await page.locator(imgSelector).getAttribute('data-lt-processing');
  if (done !== null || loading !== null) {
    throw new Error(`Expected ${imgSelector} to stay unprocessed (thumbnail defer)`);
  }
}

function nearlyEqual(a, b, tol = 3) {
  return Math.abs(a - b) <= tol;
}

async function run() {
  ensureFixtures();

  console.log('Starting CDN server (Referer-protected)...');
  const cdnServer = await startDirServer(CDN_PORT, FIXTURE_DIR, { requireReferer: true });

  console.log('Starting fixture page server...');
  const crossOriginImage = `http://127.0.0.1:${CDN_PORT}/cors-bonjour.png`;
  const thumbUrlImage = `http://127.0.0.1:${CDN_PORT}/c/250x250/cors-bonjour.png`;
  const pageServer = await startPageServer(PAGE_PORT, FIXTURE_HTML, crossOriginImage, thumbUrlImage);

  console.log(`Loading extension from ${EXT_PATH}`);
  const userDataDir = join(ROOT, '.e2e-chrome-profile');
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    viewport: { width: 900, height: 700 },
  });

  let failed = 0;

  try {
    const worker = await waitForServiceWorker(context);
    const extensionId = extensionIdFromWorker(worker);
    console.log(`Extension ID: ${extensionId}`);

    await configureExtension(context, extensionId);
    console.log('Extension configured (enabled, mock OCR, mock translate)');
    await assertTargetLanguageSkipped(context, extensionId);
    console.log('PASS: text already in target language bypassed translation');
    await assertOcrThreadsSourceLang(context, extensionId);
    console.log('PASS: OCR_IMAGE accepts sourceLang (from) with mock OCR');

    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.text().includes('Live Translate')) {
        console.log(`[page:${msg.type()}] ${msg.text()}`);
      }
    });

    await page.addInitScript(() => {
      window.__ltSawStatus = false;
      window.__ltLayoutBefore = null;
      const watch = () => {
        new MutationObserver(() => {
          if (document.querySelector('.lt-image-status')) {
            window.__ltSawStatus = true;
          }
        }).observe(document.documentElement, { childList: true, subtree: true });
      };
      if (document.documentElement) watch();
      else document.addEventListener('DOMContentLoaded', watch, { once: true });

      document.addEventListener(
        'DOMContentLoaded',
        () => {
          const img = document.querySelector('#viewer-image');
          const box = document.querySelector('#viewer-box');
          if (img && box) {
            const ir = img.getBoundingClientRect();
            const br = box.getBoundingClientRect();
            window.__ltLayoutBefore = {
              imgW: ir.width,
              imgH: ir.height,
              boxW: br.width,
              boxH: br.height,
            };
          }
        },
        { once: true },
      );
    });

    await page.goto(pageServer.url, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'networkidle' });

    // --- Text translation ---
    console.log('\n[text] Asserting above-the-fold translations...');
    await waitForTranslated(page, '#title', '[EN] Hello world');
    await waitForTranslated(
      page,
      '#visible-para',
      '[EN] The quick brown fox jumps over the lazy dog.',
    );
    console.log('PASS: above-the-fold text translated in place');

    // --- Thumbnail deferral ---
    console.log('\n[image] Small thumbnails should not be OCR’d yet...');
    await page.locator('#thumbnail-image').scrollIntoViewIfNeeded();
    await page.locator('#thumb-url-image').scrollIntoViewIfNeeded();
    await page.locator('#clipped-thumb-image').scrollIntoViewIfNeeded();
    await waitForImageNotProcessed(page, '#thumbnail-image', 4000);
    await waitForImageNotProcessed(page, '#thumb-url-image', 1500);
    await waitForImageNotProcessed(page, '#clipped-thumb-image', 1500);
    console.log('PASS: displayed / clipped thumbnails left without data-lt-done');

    console.log('\n[image] Enlarged thumbnail should OCR on resize...');
    await page.locator('#enlarge-thumb').click();
    await waitForImageOverlay(page, '#thumbnail-image', '[EN] Hello');
    console.log('PASS: enlarged thumbnail translated after display size grew');

    // --- Same-origin image (canvas / same-origin fetch path) ---
    console.log('\n[image] Same-origin image OCR + overlay + resize handles + blur...');
    await page.locator('#same-origin-image').scrollIntoViewIfNeeded();
    await waitForImageOverlay(page, '#same-origin-image', '[EN] Hello');
    const resizeEdges = await page
      .locator('#same-origin-image')
      .locator('xpath=..')
      .locator('.lt-overlay-resize-handle')
      .count();
    if (resizeEdges !== 4) {
      throw new Error(`Expected 4 resize edges, got ${resizeEdges}`);
    }
    const blurOk = await page.evaluate(() => {
      const overlay = document.querySelector('#same-origin-image')
        ?.closest('.lt-overlay-container')
        ?.querySelector('.lt-overlay');
      if (!overlay) return false;
      const style = getComputedStyle(overlay);
      const filter = `${style.backdropFilter || ''} ${style.webkitBackdropFilter || ''}`;
      return /blur\(/i.test(filter);
    });
    if (!blurOk) {
      throw new Error('Expected overlay computed style to include backdrop-filter blur');
    }
    const sawStatus = await page.evaluate(() => Boolean(window.__ltSawStatus));
    if (!sawStatus) {
      throw new Error('Expected .lt-image-status processing indicator while OCR ran');
    }
    const statusLeft = await page.locator('.lt-image-status').count();
    if (statusLeft !== 0) {
      throw new Error(`Expected processing indicator removed after success, found ${statusLeft}`);
    }
    console.log('PASS: same-origin overlay, 4-edge resize, blur backdrop, status indicator');

    // --- Layout must not blow up after overlay wrap ---
    console.log('\n[image] Constrained viewer layout size unchanged...');
    await page.locator('#viewer-image').scrollIntoViewIfNeeded();
    await waitForImageOverlay(page, '#viewer-image', '[EN] Hello');
    const layout = await page.evaluate(() => {
      const img = document.querySelector('#viewer-image');
      const box = document.querySelector('#viewer-box');
      const container = img?.closest('.lt-overlay-container');
      const before = window.__ltLayoutBefore;
      return {
        before,
        imgW: img.getBoundingClientRect().width,
        imgH: img.getBoundingClientRect().height,
        boxW: box.getBoundingClientRect().width,
        containerW: container?.getBoundingClientRect().width ?? 0,
        containerH: container?.getBoundingClientRect().height ?? 0,
      };
    });
    if (!layout.before?.imgW) {
      throw new Error('Missing pre-overlay layout snapshot for #viewer-image');
    }
    if (!nearlyEqual(layout.imgW, layout.before.imgW, 4)) {
      throw new Error(
        `Viewer img width changed ${layout.before.imgW.toFixed(1)} → ${layout.imgW.toFixed(1)}`,
      );
    }
    if (!nearlyEqual(layout.containerW, layout.before.imgW, 4)) {
      throw new Error(
        `Overlay container width ${layout.containerW.toFixed(1)} != pre-wrap img ${layout.before.imgW.toFixed(1)}`,
      );
    }
    if (layout.containerW > layout.boxW + 4) {
      throw new Error(
        `Overlay container ${layout.containerW.toFixed(1)} overflowed viewer ${layout.boxW.toFixed(1)}`,
      );
    }
    console.log('PASS: overlay wrapper preserved viewer image layout size');

    // --- Twitter-like absolute landscape media (must not be deferred as thumbnail) ---
    console.log('\n[image] Absolute landscape media (Twitter-like)...');
    await page.locator('#twitter-like-image').scrollIntoViewIfNeeded();
    await waitForImageOverlay(page, '#twitter-like-image', '[EN] Hello');
    const twitterFill = await page.evaluate(() => {
      const img = document.querySelector('#twitter-like-image');
      const container = img?.closest('.lt-overlay-container');
      return Boolean(container?.classList.contains('lt-overlay-container--fill'));
    });
    if (!twitterFill) {
      throw new Error('Expected Twitter-like media wrapper to use lt-overlay-container--fill');
    }
    console.log('PASS: landscape absolute media translated (not deferred by height < 300)');

    // --- Cross-origin image (background fetch + Referer) ---
    console.log('\n[image] Cross-origin (Referer-protected CDN) image...');
    await page.locator('#cross-origin-image').scrollIntoViewIfNeeded();
    await waitForImageOverlay(page, '#cross-origin-image', '[EN] Hello');
    console.log('PASS: cross-origin image fetched via background + overlay rendered');

    // --- EN→EN image: OCR runs but no translation overlay covering English ---
    console.log('\n[image] Skip overlay when OCR text already in target language...');
    await page.locator('#english-image').scrollIntoViewIfNeeded();
    await waitForImageDone(page, '#english-image');
    const englishOverlays = await page.evaluate(() => {
      const img = document.querySelector('#english-image');
      const container = img?.closest('.lt-overlay-container');
      if (!container) return [];
      return [...container.querySelectorAll('.lt-overlay')].map((o) => (o.textContent ?? '').trim());
    });
    if (englishOverlays.some((t) => t.length > 0)) {
      throw new Error(`Expected no EN→EN overlay text, got ${JSON.stringify(englishOverlays)}`);
    }
    console.log('PASS: English OCR text skipped (no translation overlay)');

    // --- Vertical bubble stays within OCR box ---
    console.log('\n[image] Vertical bubble text stays within OCR box...');
    await page.locator('#vertical-image').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const img = document.querySelector('#vertical-image');
      if (!img?.hasAttribute('data-lt-done')) return false;
      const overlay = img.closest('.lt-overlay-container')?.querySelector('.lt-overlay--vertical');
      return Boolean(overlay);
    }, { timeout: 25000 });
    const verticalCheck = await page.evaluate(() => {
      const overlay = document
        .querySelector('#vertical-image')
        ?.closest('.lt-overlay-container')
        ?.querySelector('.lt-overlay--vertical');
      if (!overlay) return { ok: false, reason: 'missing vertical overlay' };
      const textEl = overlay.querySelector('.lt-overlay-text');
      if (!textEl) return { ok: false, reason: 'missing text node' };
      const fontSize = parseFloat(getComputedStyle(overlay).fontSize) || 0;
      // Resize handles intentionally sit slightly outside the box; measure text only.
      const fits =
        textEl.scrollWidth <= overlay.clientWidth + 2 &&
        textEl.scrollHeight <= overlay.clientHeight + 2;
      return {
        ok: fits && fontSize >= 9 && fontSize <= Math.max(14, overlay.clientWidth),
        fontSize,
        boxW: overlay.clientWidth,
        boxH: overlay.clientHeight,
        textH: textEl.scrollHeight,
        text: (textEl.textContent ?? '').trim(),
        reason: fits ? '' : 'text overflowed OCR box',
      };
    });
    if (!verticalCheck.ok) {
      throw new Error(
        `Vertical bubble layout failed: ${verticalCheck.reason || 'bad font'} ${JSON.stringify(verticalCheck)}`,
      );
    }
    console.log('PASS: vertical bubble text fitted inside OCR box');

    // --- Below-fold image on scroll ---
    console.log('\n[image] Below-the-fold image on scroll...');
    await page.locator('#below-fold-image').scrollIntoViewIfNeeded();
    await waitForTranslated(
      page,
      '#below-para',
      '[EN] This paragraph is only visible after scrolling and should be translated on demand.',
    );
    await waitForImageOverlay(page, '#below-fold-image', '[EN] Fox');
    console.log('PASS: below-the-fold image translated on scroll');

    const overlayCount = await page.locator('.lt-overlay').count();
    // same-origin, viewer, twitter, cross-origin, vertical, enlarged thumb, below-fold = 7
    // english has none; thumbs deferred except enlarged
    if (overlayCount < 6) {
      throw new Error(`Expected at least 6 image overlays, got ${overlayCount}`);
    }
    console.log(`PASS: ${overlayCount} image overlays present`);

    const original = await page.locator('#title').getAttribute('data-lt-original');
    if (original !== 'Bonjour le monde') {
      throw new Error(`Expected original "Bonjour le monde", got "${original}"`);
    }
    console.log('PASS: original text preserved in data-lt-original');

    console.log('\nAll automated extension tests passed.');
  } catch (err) {
    failed = 1;
    console.error('\nTEST FAILED:', err);
  } finally {
    await context.close().catch(() => {});
    await pageServer.close().catch(() => {});
    await cdnServer.close().catch(() => {});
  }

  process.exit(failed);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
