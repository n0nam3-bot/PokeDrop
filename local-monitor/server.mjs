import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import net from 'node:net';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);
const MAX_PRODUCTS = 30;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_SETTINGS = { checkIntervalMinutes: 3, discordWebhookUrl: '' };
const MIME_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

let products = [];
let settings = { ...DEFAULT_SETTINGS };
let activity = [];
let lastRunAt = null;
let runInProgress = false;
let nextRunAt = Date.now() + 2_000;
let persistQueue = Promise.resolve();

const nowIso = () => new Date().toISOString();

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Could not read ${path.basename(file)}; using defaults: ${error.message}`);
    return fallback;
  }
}

async function writeJson(file, value) {
  const temp = `${file}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
}

async function loadData() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  products = await readJson(PRODUCTS_FILE, []);
  if (!Array.isArray(products)) products = [];
  settings = { ...DEFAULT_SETTINGS, ...(await readJson(SETTINGS_FILE, {})) };
  activity = await readJson(ACTIVITY_FILE, []);
  if (!Array.isArray(activity)) activity = [];
  settings.checkIntervalMinutes = clamp(Number(settings.checkIntervalMinutes) || 3, 2, 30);
  settings.discordWebhookUrl = validDiscordWebhook(settings.discordWebhookUrl) ? settings.discordWebhookUrl : '';
  await persistAll();
}

async function persistAll() {
  persistQueue = persistQueue.catch(() => {}).then(async () => {
    await Promise.all([
      writeJson(PRODUCTS_FILE, products),
      writeJson(SETTINGS_FILE, settings),
      writeJson(ACTIVITY_FILE, activity.slice(0, 100))
    ]);
  });
  return persistQueue;
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function validDiscordWebhook(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && /^(discord\.com|discordapp\.com)$/i.test(url.hostname) && /^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname);
  } catch { return false; }
}

function isPrivateIp(hostname) {
  const version = net.isIP(hostname);
  if (version === 4) {
    const p = hostname.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  if (version === 6) {
    const h = hostname.toLowerCase();
    return h === '::' || h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:') || h.startsWith('::ffff:127.') || h.startsWith('::ffff:10.');
  }
  return false;
}

function validateProductUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('Enter a valid product page URL (maximum 2,048 characters).');
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('That product page URL is not valid.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only HTTP or HTTPS product page links are supported.');
  if (url.username || url.password) throw new Error('Product links cannot contain a username or password.');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.test') || isPrivateIp(host)) {
    throw new Error('Use a public retailer product page, not a local or private network address.');
  }
  url.hash = '';
  return url.toString();
}

function allowedLocalRequest(req) {
  const hostHeader = String(req.headers.host || '').toLowerCase();
  if (hostHeader && ![`127.0.0.1:${PORT}`, `localhost:${PORT}`].includes(hostHeader)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32 * 1024) throw new Error('Request was too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&quot;/gi, '"').replace(/&#34;/g, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function parseAttributes(tag) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(tag))) attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  return attrs;
}

function normalizeAvailability(value) {
  const v = String(value ?? '').toLowerCase().replace(/^https?:\/\/(?:www\.)?schema\.org\//, '').replace(/[\s_-]+/g, '');
  if (!v) return null;
  if (/(outofstock|soldout|discontinued|unavailable|outofinventory)/.test(v)) return 'out-of-stock';
  if (/(preorder|presale|backorder|preorderable)/.test(v)) return 'preorder';
  if (/(instock|limitedavailability|onlineonly|inwarehouse|available)/.test(v)) return 'in-stock';
  return null;
}

function inspectJsonLd(value, result) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) inspectJsonLd(item, result); return; }
  const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
  if (types.some(type => String(type).toLowerCase() === 'product')) {
    if (!result.name && value.name) result.name = String(value.name).trim();
    const image = Array.isArray(value.image) ? value.image[0] : value.image;
    if (!result.imageUrl && typeof image === 'string') result.imageUrl = image;
    else if (!result.imageUrl && image && typeof image.url === 'string') result.imageUrl = image.url;
    const offers = value.offers;
    const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
    for (const offer of list) {
      const mapped = normalizeAvailability(offer?.availability);
      if (mapped) result.statuses.push(mapped);
      if (!result.price && offer?.price != null) result.price = String(offer.price);
      if (!result.currency && offer?.priceCurrency) result.currency = String(offer.priceCurrency);
    }
  }
  if (value.availability) {
    const mapped = normalizeAvailability(value.availability);
    if (mapped) result.statuses.push(mapped);
  }
  for (const child of Object.values(value)) if (child && typeof child === 'object') inspectJsonLd(child, result);
}

function parseProductPage(html) {
  const result = { name: '', imageUrl: '', price: '', currency: '', statuses: [], source: 'page' };
  const ldScripts = html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of ldScripts) {
    try { inspectJsonLd(JSON.parse(decodeEntities(match[1].trim())), result); } catch { /* Ignore malformed structured data. */ }
  }

  const metaTags = html.matchAll(/<meta\b[^>]*>/gi);
  for (const match of metaTags) {
    const attrs = parseAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    const value = attrs.content || '';
    if (!value) continue;
    if (!result.name && ['og:title', 'twitter:title'].includes(key)) result.name = value.trim();
    if (!result.imageUrl && ['og:image', 'twitter:image'].includes(key)) result.imageUrl = value.trim();
    if (!result.price && ['product:price:amount', 'og:price:amount', 'price'].includes(key)) result.price = value.trim();
    if (!result.currency && ['product:price:currency', 'og:price:currency'].includes(key)) result.currency = value.trim();
    if (['product:availability', 'og:availability', 'availability', 'itemprop=availability'].includes(key)) {
      const status = normalizeAvailability(value);
      if (status) result.statuses.push(status);
    }
  }

  const rawAvailability = html.match(/(?:itemprop|data-testid|data-availability|class)\s*=\s*["'][^"']*(?:availability|stock)[^"']*["'][^>]*>[\s\S]{0,240}?\b(in stock|out of stock|sold out|pre-?order|currently unavailable)\b/i);
  if (rawAvailability) {
    const status = normalizeAvailability(rawAvailability[1]);
    if (status) result.statuses.push(status);
  }

  result.status = result.statuses.includes('in-stock') ? 'in-stock' :
    result.statuses.includes('preorder') ? 'preorder' :
    result.statuses.includes('out-of-stock') ? 'out-of-stock' : 'unknown';
  return result;
}

async function fetchText(url) {
  validateProductUrl(url);
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'user-agent': 'PokeDropLocalMonitor/1.0 (personal product availability checks)',
      'accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
      'accept-language': 'en-US,en;q=0.8'
    }
  });
  if (response.status === 403 || response.status === 429) {
    const error = new Error(`Retailer declined the request (${response.status}). The monitor will not try to bypass its protection.`);
    error.blocked = true;
    throw error;
  }
  if (!response.ok) throw new Error(`Retailer page returned HTTP ${response.status}.`);
  validateProductUrl(response.url || url);
  const contentType = response.headers.get('content-type') || '';
  if (!/(text\/html|application\/json|text\/plain)/i.test(contentType)) throw new Error(`Unsupported page type: ${contentType || 'unknown'}.`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > MAX_PAGE_BYTES) throw new Error('Retailer page is larger than the 5 MB safety limit.');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_PAGE_BYTES) throw new Error('Retailer page is larger than the 5 MB safety limit.');
  return { text, responseUrl: response.url || url };
}

async function tryShopifyProductJson(pageUrl, html) {
  if (!/cdn\.shopify\.com|Shopify\.theme|shopify-section|myshopify\.com/i.test(html)) return null;
  const url = new URL(pageUrl);
  if (!/\/products\/[^/]+\/?$/i.test(url.pathname)) return null;
  url.pathname = `${url.pathname.replace(/\/$/, '')}.js`;
  url.search = '';
  try {
    const { text } = await fetchText(url.toString());
    const product = JSON.parse(text);
    if (typeof product.available !== 'boolean') return null;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    const anyVariantAvailable = variants.some(variant => variant.available === true);
    const available = variants.length ? anyVariantAvailable : product.available;
    return {
      status: available ? 'in-stock' : 'out-of-stock',
      name: product.title || '',
      imageUrl: typeof product.featured_image === 'string' ? product.featured_image : '',
      price: product.price != null ? String(Number(product.price) / 100) : '',
      currency: '',
      source: 'Shopify public product data'
    };
  } catch { return null; }
}

async function inspectProduct(url) {
  const { text, responseUrl } = await fetchText(url);
  const page = parseProductPage(text);
  if (page.status !== 'unknown') return { ...page, checkedUrl: responseUrl };
  const shopify = await tryShopifyProductJson(responseUrl, text);
  if (shopify) return { ...shopify, checkedUrl: responseUrl };
  return { ...page, checkedUrl: responseUrl };
}

function friendlyStatus(status) {
  return ({ 'in-stock': 'IN STOCK', 'out-of-stock': 'OUT OF STOCK', 'preorder': 'PREORDER', 'unknown': 'UNKNOWN' })[status] || 'UNKNOWN';
}

async function sendDiscordAlert(product, status, isFirstCheck = false) {
  if (!settings.discordWebhookUrl) return { sent: false, reason: 'Discord webhook is not configured.' };
  const message = [
    `**${isFirstCheck ? 'PokeDrop availability found' : 'PokeDrop restock alert'}**`,
    `**${escapeDiscord(product.name || product.retailer || 'Pokémon TCG product')}** — ${friendlyStatus(status)}`,
    product.price ? `Price: ${escapeDiscord(`${product.currency || ''} ${product.price}`.trim())}` : '',
    product.url
  ].filter(Boolean).join('\n');
  const response = await fetch(settings.discordWebhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: message.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}.`);
  return { sent: true };
}

function escapeDiscord(value) { return String(value ?? '').replace(/([\\*_~`|>])/g, '\\$1').slice(0, 180); }

function addActivity(kind, product, details) {
  activity.unshift({ id: randomUUID(), at: nowIso(), kind, productName: product.name || product.retailer || 'Tracked product', details, url: product.url });
  activity = activity.slice(0, 100);
}

async function checkOne(product) {
  const previousStatus = product.lastStatus || 'unknown';
  product.checkState = 'checking';
  product.lastError = '';
  try {
    const result = await inspectProduct(product.url);
    product.name = product.name || result.name || product.retailer || 'Tracked product';
    product.lastStatus = result.status;
    product.lastCheckedAt = nowIso();
    product.checkState = result.status === 'unknown' ? 'unrecognized' : 'ok';
    product.lastError = result.status === 'unknown' ? 'The page loaded, but did not expose a reliable stock signal. No alert was sent.' : '';
    product.lastPrice = result.price || product.lastPrice || '';
    product.currency = result.currency || product.currency || '';
    product.imageUrl = result.imageUrl || product.imageUrl || '';
    product.statusSource = result.source || 'product page';

    const firstCompletedCheck = !product.hasCompletedFirstCheck;
    const available = result.status === 'in-stock' || result.status === 'preorder';
    const becameAvailable = available && (previousStatus === 'out-of-stock' || previousStatus === 'unknown');
    const shouldNotify = available && ((firstCompletedCheck && product.notifyOnFirstCheck) || (!firstCompletedCheck && becameAvailable));
    if (shouldNotify) {
      try {
        const sent = await sendDiscordAlert(product, result.status, firstCompletedCheck);
        if (sent.sent) {
          product.lastNotifiedAt = nowIso();
          addActivity(firstCompletedCheck ? 'found' : 'restock', product, `${friendlyStatus(result.status)} detected; Discord alert sent.`);
        }
      } catch (error) {
        product.lastError = `Stock detected, but Discord alert failed: ${error.message}`;
        addActivity('alert-error', product, product.lastError);
      }
    } else if (result.status !== previousStatus) {
      addActivity('status', product, `Status changed to ${friendlyStatus(result.status)}.`);
    }
    product.hasCompletedFirstCheck = true;
    product.lastCheckDurationMs = Date.now() - new Date(product._checkStartedAt || Date.now()).getTime();
    delete product._checkStartedAt;
  } catch (error) {
    product.lastCheckedAt = nowIso();
    product.checkState = error.blocked ? 'blocked' : 'error';
    product.lastError = error.message || 'Could not check this product page.';
    product.hasCompletedFirstCheck = true;
    addActivity(error.blocked ? 'blocked' : 'error', product, product.lastError);
    delete product._checkStartedAt;
  }
  await persistAll();
  return product;
}

async function runChecks(targetId = null) {
  if (runInProgress) return { started: false, reason: 'A scan is already running.' };
  const targets = products.filter(product => product.enabled !== false && (!targetId || product.id === targetId));
  if (!targets.length) return { started: false, reason: targetId ? 'Product was not found.' : 'Add a product URL to begin.' };
  runInProgress = true;
  lastRunAt = nowIso();
  nextRunAt = Date.now() + settings.checkIntervalMinutes * 60_000;
  for (const product of targets) { product._checkStartedAt = Date.now(); product.checkState = 'checking'; }
  await persistAll();
  try {
    const concurrency = 3;
    for (let i = 0; i < targets.length; i += concurrency) {
      await Promise.all(targets.slice(i, i + concurrency).map(checkOne));
    }
  } finally {
    runInProgress = false;
    await persistAll();
  }
  return { started: true, checked: targets.length };
}

function publicSnapshot() {
  return {
    products: products.map(({ _checkStartedAt, ...product }) => product),
    settings: {
      checkIntervalMinutes: settings.checkIntervalMinutes,
      discordConfigured: Boolean(settings.discordWebhookUrl)
    },
    activity: activity.slice(0, 20),
    lastRunAt,
    nextRunAt: new Date(nextRunAt).toISOString(),
    runInProgress,
    maxProducts: MAX_PRODUCTS
  };
}

async function handleApi(req, res, pathname) {
  if (pathname === '/api/status' && req.method === 'GET') return sendJson(res, 200, publicSnapshot());

  if (pathname === '/api/products' && req.method === 'POST') {
    const body = await readBody(req);
    if (products.length >= MAX_PRODUCTS) return sendJson(res, 400, { error: `The local monitor is limited to ${MAX_PRODUCTS} products to keep retailer checks reasonable.` });
    const url = validateProductUrl(body.url);
    const duplicate = products.find(product => product.url === url);
    if (duplicate) return sendJson(res, 409, { error: 'That product URL is already being monitored.' });
    const product = {
      id: randomUUID(),
      name: String(body.name || '').trim().slice(0, 120),
      retailer: String(body.retailer || '').trim().slice(0, 60),
      url,
      enabled: true,
      notifyOnFirstCheck: body.notifyOnFirstCheck !== false,
      hasCompletedFirstCheck: false,
      lastStatus: 'unknown',
      checkState: 'waiting',
      createdAt: nowIso(),
      lastCheckedAt: null,
      lastError: ''
    };
    if (!product.name) product.name = product.retailer || new URL(url).hostname.replace(/^www\./, '');
    products.unshift(product);
    await persistAll();
    setTimeout(() => { runChecks(product.id).catch(error => console.error('Initial product check failed:', error)); }, 250);
    return sendJson(res, 201, { product: { ...product } });
  }

  if (pathname.startsWith('/api/products/') && req.method === 'DELETE') {
    const id = decodeURIComponent(pathname.slice('/api/products/'.length));
    const before = products.length;
    products = products.filter(product => product.id !== id);
    if (products.length === before) return sendJson(res, 404, { error: 'Product not found.' });
    await persistAll();
    return sendJson(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/products/') && pathname.endsWith('/check') && req.method === 'POST') {
    const id = decodeURIComponent(pathname.slice('/api/products/'.length, -'/check'.length));
    const result = await runChecks(id);
    return sendJson(res, result.started ? 202 : 409, result);
  }

  if (pathname === '/api/check-now' && req.method === 'POST') {
    const result = await runChecks();
    return sendJson(res, result.started ? 202 : 409, result);
  }

  if (pathname === '/api/settings' && req.method === 'PUT') {
    const body = await readBody(req);
    if (body.checkIntervalMinutes !== undefined) settings.checkIntervalMinutes = clamp(Number(body.checkIntervalMinutes) || 3, 2, 30);
    if (body.clearWebhook === true) settings.discordWebhookUrl = '';
    else if (typeof body.discordWebhookUrl === 'string' && body.discordWebhookUrl.trim()) {
      if (!validDiscordWebhook(body.discordWebhookUrl.trim())) return sendJson(res, 400, { error: 'That does not look like a valid Discord webhook URL.' });
      settings.discordWebhookUrl = body.discordWebhookUrl.trim();
    }
    await persistAll();
    return sendJson(res, 200, { ok: true, settings: { checkIntervalMinutes: settings.checkIntervalMinutes, discordConfigured: Boolean(settings.discordWebhookUrl) } });
  }

  if (pathname === '/api/test-discord' && req.method === 'POST') {
    if (!settings.discordWebhookUrl) return sendJson(res, 400, { error: 'Save a Discord webhook before sending a test.' });
    try {
      const response = await fetch(settings.discordWebhookUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: '**PokeDrop test alert** — Discord notifications are connected.', allowed_mentions: { parse: [] } }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error(`Discord returned HTTP ${response.status}.`);
      return sendJson(res, 200, { ok: true });
    } catch (error) { return sendJson(res, 502, { error: error.message }); }
  }

  return sendJson(res, 404, { error: 'API endpoint not found.' });
}

async function serveStatic(req, res, pathname) {
  const routes = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
  const fileName = routes[pathname];
  if (!fileName) return sendJson(res, 404, { error: 'Not found.' });
  const filePath = path.join(PUBLIC_DIR, fileName);
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'content-type': MIME_TYPES[path.extname(filePath)], 'cache-control': 'no-store', 'content-length': data.length, 'x-content-type-options': 'nosniff' });
    res.end(data);
  } catch {
    sendJson(res, 500, { error: 'The local monitor interface could not be loaded.' });
  }
}

const server = createServer(async (req, res) => {
  try {
    if (!allowedLocalRequest(req)) return sendJson(res, 403, { error: 'This local dashboard only accepts requests from this PC.' });
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url.pathname);
    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 400, { error: error.message || 'Request failed.' });
    else res.end();
  }
});

await loadData();
server.listen(PORT, HOST, () => {
  console.log(`PokeDrop Local Monitor is running at http://${HOST}:${PORT}`);
  console.log('Keep this window open while you want product checks to run.');
  console.log(`Tracking ${products.length}/${MAX_PRODUCTS} product URLs; scan interval: ${settings.checkIntervalMinutes} minute(s).`);
});

const scheduler = setInterval(() => {
  if (!runInProgress && Date.now() >= nextRunAt) {
    runChecks().catch(error => console.error('Scheduled scan failed:', error));
  }
}, 5_000);

async function shutdown() {
  clearInterval(scheduler);
  server.close(async () => {
    try { await persistAll(); } catch (error) { console.error('Could not save local data:', error); }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
