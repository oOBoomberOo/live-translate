/**
 * Visual QA: load Live Translate on real JP manga/illustration sites.
 * Uses Google Cloud Translation + Vision via GOOGLE_API_KEY from .env.
 *
 * Usage: npm run test:visual
 */
import { chromium } from 'playwright';
import {
  rmSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXT_PATH = join(ROOT, 'dist');
const OUT_DIR = join(__dirname, 'visual-results');
const userDataDir = join(ROOT, '.visual-chrome-profile');

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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const GOOGLE_API_KEY = (process.env.GOOGLE_API_KEY || '').trim();
const directUrl = process.argv[2]?.trim();

const SITES = directUrl
  ? [
      {
        id: 'direct',
        name: directUrl,
        urls: [directUrl],
        waitMs: 15000,
        scrollSteps: 0,
      },
    ]
  : [
  {
    id: 'pixiv',
    name: 'Pixiv',
    urls: [
      'https://www.pixiv.net/tags/%E6%BC%AB%E7%94%BB/illustrations',
      'https://www.pixiv.net/',
    ],
    waitMs: 10000,
    scrollSteps: 3,
  },
  {
    id: 'nhentai',
    name: 'nhentai',
    urls: [
      'https://nhentai.net/language/japanese/',
      'https://nhentai.net/',
    ],
    waitMs: 10000,
    scrollSteps: 3,
    openFirstGallery: true,
  },
];

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
    const settings = {
      enabled: true,
      sourceLang: 'auto',
      targetLang: 'en',
      provider: 'google',
      apiKeys: { google },
      ocrMode: 'cloud',
      translateImages: true,
      siteBlocklist: [],
    };
    await chrome.storage.sync.set({ settings });
  }, apiKey);
  await page.close();
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img')];
    const processed = imgs.filter((i) => i.hasAttribute('data-lt-done'));
    const processing = imgs.filter((i) => i.hasAttribute('data-lt-processing'));
    const overlays = [...document.querySelectorAll('.lt-overlay')];
    const containers = [...document.querySelectorAll('.lt-overlay-container')];
    const statuses = [...document.querySelectorAll('.lt-image-status')];

    const overlaySamples = overlays.slice(0, 12).map((o) => {
      const r = o.getBoundingClientRect();
      const text = (o.textContent ?? '').trim().slice(0, 80);
      const parent = o.closest('.lt-overlay-container');
      const img = parent?.querySelector('img');
      const ir = img?.getBoundingClientRect();
      const spill =
        ir &&
        (r.left < ir.left - 2 ||
          r.top < ir.top - 2 ||
          r.right > ir.right + 2 ||
          r.bottom > ir.bottom + 2);
      return {
        text,
        w: Math.round(r.width),
        h: Math.round(r.height),
        spill: Boolean(spill),
      };
    });

    const sizeBlowups = containers
      .map((c) => {
        const img = c.querySelector('img');
        if (!img) return null;
        const cr = c.getBoundingClientRect();
        const ir = img.getBoundingClientRect();
        if (cr.width > ir.width + 40 || cr.height > ir.height + 40) {
          return {
            container: { w: Math.round(cr.width), h: Math.round(cr.height) },
            img: { w: Math.round(ir.width), h: Math.round(ir.height) },
          };
        }
        return null;
      })
      .filter(Boolean);

    const thumbsTranslatedEarly = imgs.filter((img) => {
      const r = img.getBoundingClientRect();
      const maxEdge = Math.max(r.width, r.height);
      const area = r.width * r.height;
      const small = maxEdge < 300 || area < 70_000;
      return small && (img.hasAttribute('data-lt-done') || img.hasAttribute('data-lt-processing'));
    }).length;

    const navOverlayHits = overlays.filter((o) => {
      const r = o.getBoundingClientRect();
      return r.top < 64 && r.bottom > 0 && r.left < window.innerWidth && r.right > 0;
    }).length;

    return {
      imgCount: imgs.length,
      processedCount: processed.length,
      processingCount: processing.length,
      overlayCount: overlays.length,
      containerCount: containers.length,
      statusCount: statuses.length,
      overlaySamples,
      spillCount: overlaySamples.filter((s) => s.spill).length,
      sizeBlowups,
      thumbsTranslatedEarly,
      navOverlayHits,
      layoutWiderThanViewport: document.documentElement.scrollWidth > window.innerWidth + 8,
    };
  });
}

async function screenshot(page, name) {
  const path = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function tryClickFirst(page, selectors) {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) continue;
    try {
      await loc.click({ timeout: 4000 });
      return sel;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function testSite(context, site) {
  const result = {
    id: site.id,
    name: site.name,
    ok: false,
    blocked: false,
    url: null,
    screenshots: [],
    issues: [],
    metrics: [],
    notes: [],
  };
  const push = (msg) => {
    console.log(`  ${msg}`);
    result.notes.push(msg);
  };

  const page = await context.newPage();
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('Live Translate')) {
      console.log(`  [console:${msg.type()}] ${t.slice(0, 200)}`);
      if (msg.type() === 'error' || msg.type() === 'warning') {
        result.issues.push(`console:${msg.type()}: ${t.slice(0, 300)}`);
      }
    }
  });

  try {
    let loaded = false;
    for (const url of site.urls) {
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        const status = resp?.status() ?? 0;
        push(`goto ${url} → ${status}`);
        if (status >= 400) continue;
        loaded = true;
        result.url = url;
        break;
      } catch (err) {
        push(`goto failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!loaded) {
      result.blocked = true;
      result.issues.push('Could not load any URL for this site');
      return result;
    }

    await page.waitForTimeout(site.waitMs);

    const bodyText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 500));
    if (/log in|sign in|ログイン|请登录/i.test(bodyText) && bodyText.length < 800) {
      result.blocked = true;
      result.issues.push('Page looks like a login wall');
    }

    result.screenshots.push(await screenshot(page, `${site.id}-01-initial`));

    for (let i = 0; i < site.scrollSteps; i++) {
      await page.mouse.wheel(0, 900);
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(site.waitMs);

    let metrics = await collectMetrics(page);
    result.metrics.push({ phase: 'after-scroll', ...metrics });
    result.screenshots.push(await screenshot(page, `${site.id}-02-scrolled`));
    push(
      `after scroll: ${metrics.overlayCount} overlays, ${metrics.processedCount} processed imgs, ${metrics.thumbsTranslatedEarly} early thumbs`,
    );

    if (site.id === 'pixiv') {
      const clicked = await tryClickFirst(page, [
        'a[href*="/artworks/"] img',
        'a[href*="/artworks/"]',
      ]);
      if (clicked) {
        push(`opened artwork via ${clicked}`);
        await page.waitForTimeout(site.waitMs);
        metrics = await collectMetrics(page);
        result.metrics.push({ phase: 'enlarged', ...metrics });
        result.screenshots.push(await screenshot(page, `${site.id}-03-enlarged`));
      } else {
        result.issues.push('Could not open an enlarged Pixiv artwork');
      }
    }

    if (site.id === 'nhentai' && site.openFirstGallery) {
      const clicked = await tryClickFirst(page, [
        '.gallery a',
        '.index-container .gallery a',
        'a.cover',
        '.gallery',
      ]);
      if (clicked) {
        push(`opened gallery via ${clicked}`);
        await page.waitForTimeout(4000);
        result.screenshots.push(await screenshot(page, `${site.id}-03-gallery`));

        const pageClick = await tryClickFirst(page, [
          '#cover a',
          '.gallerythumb',
          '#thumbnail-container a',
          'a.gallerythumb',
        ]);
        if (pageClick) {
          push(`opened reader page via ${pageClick}`);
          await page.waitForTimeout(site.waitMs + 5000);
          metrics = await collectMetrics(page);
          result.metrics.push({ phase: 'reader', ...metrics });
          result.screenshots.push(await screenshot(page, `${site.id}-04-reader`));

          await page.keyboard.press('ArrowRight');
          await page.waitForTimeout(site.waitMs);
          metrics = await collectMetrics(page);
          result.metrics.push({ phase: 'reader-next', ...metrics });
          result.screenshots.push(await screenshot(page, `${site.id}-05-reader-next`));
        } else {
          result.issues.push('Opened gallery but could not enter reader');
        }
      } else {
        result.issues.push('Could not open a gallery');
      }
    }

    for (const m of result.metrics) {
      if (m.spillCount > 0) {
        result.issues.push(`${m.phase}: ${m.spillCount} overlay(s) spill outside image bounds`);
      }
      if (m.sizeBlowups?.length) {
        result.issues.push(`${m.phase}: ${m.sizeBlowups.length} possible layout blowup(s)`);
      }
      if (m.thumbsTranslatedEarly > 0 && site.id === 'pixiv') {
        result.issues.push(
          `${m.phase}: ${m.thumbsTranslatedEarly} small thumbnail(s) translated/processed early`,
        );
      }
      if (m.navOverlayHits > 0) {
        result.issues.push(`${m.phase}: ${m.navOverlayHits} overlay(s) overlapping top nav area`);
      }
      if (m.layoutWiderThanViewport) {
        result.issues.push(`${m.phase}: page wider than viewport after translation`);
      }
      if (m.overlayCount === 0 && m.processedCount === 0 && m.processingCount === 0) {
        result.issues.push(
          `${m.phase}: no image OCR activity (overlays/processed/processing all 0) — may be blocked images or missing API access`,
        );
      }
    }

    result.ok = true;
  } catch (err) {
    result.issues.push(err instanceof Error ? err.message : String(err));
    try {
      result.screenshots.push(await screenshot(page, `${site.id}-error`));
    } catch {
      /* ignore */
    }
  }

  await page.close().catch(() => {});
  return result;
}

async function run() {
  if (!GOOGLE_API_KEY) {
    throw new Error(
      'GOOGLE_API_KEY is required for visual tests. Copy .env.example to .env and set your key.',
    );
  }

  if (!existsSync(join(EXT_PATH, 'manifest.json'))) {
    throw new Error('dist/ missing — run npm run build first');
  }

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  rmSync(userDataDir, { recursive: true, force: true });
  mkdirSync(userDataDir, { recursive: true });

  console.log(`Loading extension from ${EXT_PATH}`);
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_PATH}`,
      `--load-extension=${EXT_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1280, height: 900 },
    ignoreHTTPSErrors: true,
  });

  const report = {
    startedAt: new Date().toISOString(),
    extensionPath: EXT_PATH,
    ocrNote: 'Uses Google Cloud Vision + Translation via GOOGLE_API_KEY from .env',
    sites: [],
  };

  try {
    const worker = await waitForServiceWorker(context);
    const extensionId = extensionIdFromWorker(worker);
    console.log(`Extension ID: ${extensionId}`);
    report.extensionId = extensionId;

    await configureExtension(context, extensionId, GOOGLE_API_KEY);
    console.log('Extension enabled (Google Vision OCR + Google Translation)');

    for (const site of SITES) {
      console.log(`\n=== ${site.name} ===`);
      const r = await testSite(context, site);
      report.sites.push(r);
    }
  } finally {
    await context.close().catch(() => {});
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = join(OUT_DIR, 'report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport written to ${reportPath}`);

  for (const s of report.sites) {
    console.log(`\n## ${s.name}`);
    console.log(`ok=${s.ok} blocked=${s.blocked}`);
    console.log(`screenshots: ${s.screenshots.join(', ')}`);
    console.log(`issues (${s.issues.length}):`);
    for (const i of s.issues) console.log(`  - ${i}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
