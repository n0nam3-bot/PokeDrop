import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = process.cwd();
const PRODUCT_FILE = `${ROOT}/products.json`;
const STATUS_FILE = `${ROOT}/product-status.json`;
const REQUEST_TIMEOUT_MS = 9500;
const MAX_NEW_PER_RETAILER = 2;
const MAX_TRACKED_PRODUCTS = 70;
const CONCURRENCY = 4;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 PokeDropStockRadar/1.0';

const RETAILERS = [
  { name: 'Pokémon Center', domain: 'pokemoncenter.com', path: /\/product\//i },
  { name: 'Target', domain: 'target.com', path: /\/p\//i },
  { name: 'Walmart', domain: 'walmart.com', path: /\/ip\//i },
  { name: 'Best Buy', domain: 'bestbuy.com', path: /\/site\/[^/]+\/\d{5,}/i },
  { name: 'GameStop', domain: 'gamestop.com', path: /\/product\//i },
  { name: 'Amazon', domain: 'amazon.com', path: /\/(?:dp|gp\/product)\/[a-z0-9]{8,}/i },
  { name: 'Costco', domain: 'costco.com', path: /\/(?:p|product)\//i },
  { name: 'TCGplayer', domain: 'tcgplayer.com', path: /\/product\//i },
  { name: 'Barnes & Noble', domain: 'barnesandnoble.com', path: /\/w\//i },
  { name: 'Meijer', domain: 'meijer.com', path: /\/(?:shopping\/)?product\//i }
];

const PRODUCT_TERMS = /\b(tcg|trading cards?|booster (?:box|packs?|bundle)|elite trainer boxes?|\betb\b|collection boxes?|mini tins?|ultra[- ]premium|premium collection|build and battle|promo cards?)\b/i;
const BLOCKED_TEXT = /access denied|unusual traffic|verify you are human|are you a robot|robot check|captcha|automated requests|cloudflare ray id|request blocked|temporarily blocked/i;
const SEARCH_STATS = { requests: 0, successful: 0, resultLinks: 0, errors: 0, bing: 0, duckduckgo: 0 };

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function decodeEntities(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, raw) => {
    const key = raw.toLowerCase();
    if (key === 'amp') return '&'; if (key === 'lt') return '<'; if (key === 'gt') return '>';
    if (key === 'quot') return '"'; if (key === 'apos') return "'"; if (key === 'nbsp') return ' ';
    try { return String.fromCodePoint(key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10)); } catch { return all; }
  });
}
function stripTags(value) {
  return decodeEntities(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function attribute(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(source || '').match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : '';
}
function canonicalize(value) {
  try {
    const url = new URL(value); url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return ''; }
}
function unwrapSearchUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    if (/bing\.com$/i.test(url.hostname)) {
      const value = url.searchParams.get('u');
      if (value?.startsWith('a1')) {
        const decoded = Buffer.from(value.slice(2), 'base64').toString('utf8');
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
    if (/duckduckgo\.com$/i.test(url.hostname)) {
      const value = url.searchParams.get('uddg');
      if (value) return new URL(value).href;
    }
    return url.href;
  } catch { return ''; }
}
function domainMatches(url, retailer) {
  try { const host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); return host === retailer.domain || host.endsWith(`.${retailer.domain}`); }
  catch { return false; }
}
function isProductUrl(url, retailer) {
  try { return domainMatches(url, retailer) && retailer.path.test(new URL(url).pathname); }
  catch { return false; }
}
function extractSearchResults(html, baseUrl, retailer) {
  const source = String(html || '');
  const blocks = [];
  for (const match of source.matchAll(/<li\b([^>]*)>[\s\S]*?<\/li>/gi)) if (/\bb_algo\b/i.test(attribute(match[1], 'class'))) blocks.push(match[0]);
  for (const match of source.matchAll(/<div\b([^>]*)>[\s\S]*?<\/div>/gi)) if (/\bresult__body\b/i.test(attribute(match[1], 'class'))) blocks.push(match[0]);
  const candidates = blocks.length ? blocks : [...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((match) => /result__a|result-link/i.test(attribute(match[1], 'class'))).map((match) => match[0]);
  const results = []; const seen = new Set();
  for (const block of candidates) {
    const anchor = block.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i); if (!anchor) continue;
    const url = canonicalize(unwrapSearchUrl(attribute(anchor[1], 'href'), baseUrl));
    if (!url || !isProductUrl(url, retailer)) continue;
    const title = stripTags(anchor[2]);
    const snippet = stripTags(block).slice(0, 800);
    const key = url.toLowerCase();
    if (!title || seen.has(key)) continue;
    if (!/pok[eé]mon/i.test(`${title} ${snippet}`) || !PRODUCT_TERMS.test(`${title} ${snippet}`)) continue;
    seen.add(key); results.push({ url, title, snippet });
  }
  return results;
}
async function searchRetailer(retailer) {
  const query = `site:${retailer.domain} ("Pokemon TCG" OR "Pokemon Trading Card Game") (booster OR "elite trainer" OR collection OR tin) -used`;
  const engines = [
    { name: 'Bing', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=us` },
    { name: 'DuckDuckGo', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` }
  ];
  let lastError = '';
  let reached = false;
  for (const engine of engines) {
    try {
      SEARCH_STATS.requests++; SEARCH_STATS[engine.name === 'Bing' ? 'bing' : 'duckduckgo']++;
      const response = await fetch(engine.url, { redirect: 'follow', headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) { lastError = `HTTP ${response.status}`; SEARCH_STATS.errors++; continue; }
      reached = true;
      const html = (await response.text()).slice(0, 1800000);
      const results = extractSearchResults(html, response.url || engine.url, retailer);
      SEARCH_STATS.resultLinks += results.length;
      if (results.length) { SEARCH_STATS.successful++; return { ok: true, results: results.slice(0, MAX_NEW_PER_RETAILER + 3), engine: engine.name }; }
      lastError = 'No matching product detail pages in search results';
    } catch (error) { lastError = error?.message || String(error); SEARCH_STATS.errors++; }
  }
  return reached ? { ok: true, results: [], error: lastError } : { ok: false, results: [], error: lastError || 'Search unavailable' };
}
async function fetchProductPage(url) {
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/ld+json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const html = (await response.text()).slice(0, 2600000);
  const finalUrl = response.url || url;
  if (response.status === 403 || response.status === 429 || response.status === 503) {
    const error = new Error(`HTTP ${response.status}`); error.blocked = true; throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (BLOCKED_TEXT.test(stripTags(html).slice(0, 30000))) { const error = new Error('Anti-bot or access-block page'); error.blocked = true; throw error; }
  if (html.length < 250) throw new Error('Empty or incomplete retailer page');
  return { html, url: finalUrl };
}
function metaContent(html, names) {
  const target = new Set(names.map((name) => name.toLowerCase()));
  for (const [, attrs] of String(html || '').matchAll(/<meta\b([^>]*)>/gi)) {
    const key = (attribute(attrs, 'property') || attribute(attrs, 'name') || attribute(attrs, 'itemprop')).toLowerCase();
    if (target.has(key)) { const value = attribute(attrs, 'content'); if (value) return value; }
  }
  return '';
}
function pageTitle(html) { const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i); return match ? stripTags(match[1]) : ''; }
function canonicalPageUrl(html, fallback) {
  for (const [, attrs] of String(html || '').matchAll(/<link\b([^>]*)>/gi)) {
    if (/canonical/i.test(attribute(attrs, 'rel'))) { try { return new URL(attribute(attrs, 'href'), fallback).href; } catch { /* fallback */ } }
  }
  return fallback;
}
function flatten(value, target = []) {
  if (Array.isArray(value)) value.forEach((item) => flatten(item, target));
  else if (value && typeof value === 'object') { target.push(value); Object.values(value).forEach((child) => { if (child && typeof child === 'object') flatten(child, target); }); }
  return target;
}
function schemaNodes(html) {
  const nodes = [];
  for (const [, attrs, raw] of String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(attribute(attrs, 'type'))) continue;
    try { nodes.push(...flatten(JSON.parse(raw.replace(/^\s*<!--|-->\s*$/g, '').trim()))); } catch { /* malformed structured data */ }
  }
  return nodes;
}
function isProductNode(node) {
  const type = node?.['@type']; return (Array.isArray(type) ? type : [type]).some((value) => String(value || '').toLowerCase() === 'product');
}
function offerFor(product) {
  const offer = Array.isArray(product?.offers) ? product.offers.find((item) => item && typeof item === 'object') : product?.offers;
  return offer && typeof offer === 'object' ? offer : {};
}
function classifyAvailability(raw, bodyText) {
  const schema = String(raw || '').toLowerCase().replace(/[\s_-]/g, '');
  if (/outofstock|soldout|discontinued|presaleended/.test(schema)) return 'OUT_OF_STOCK';
  if (/preorder|presale/.test(schema)) return 'PREORDER';
  if (/instock|limitedavailability|onlineonly|instoreonly/.test(schema)) return 'IN_STOCK';
  const text = String(bodyText || '').toLowerCase();
  if (/\b(sold out|out of stock|currently unavailable|not available online)\b/.test(text)) return 'OUT_OF_STOCK';
  if (/\b(pre-?order now|available for pre-?order|pre-?order)\b/.test(text)) return 'PREORDER';
  if (/\b(add to cart|add to bag|in stock|available to ship|ships to you)\b/.test(text)) return 'IN_STOCK';
  return 'UNKNOWN';
}
function firstImage(product, html, base) {
  let value = product?.image;
  if (Array.isArray(value)) value = value[0];
  if (value && typeof value === 'object') value = value.url || value.contentUrl;
  value ||= metaContent(html, ['og:image', 'twitter:image']);
  try { const url = new URL(value, base); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
}
function stockFromProductPage(page, retailer) {
  const nodes = schemaNodes(page.html);
  const pageName = pageTitle(page.html);
  const metaName = metaContent(page.html, ['og:title', 'twitter:title']);
  const products = nodes.filter(isProductNode);
  const product = products.find((item) => /pok[eé]mon/i.test(`${item.name || ''} ${item.description || ''}`) && PRODUCT_TERMS.test(`${item.name || ''} ${item.description || ''}`)) || products.find((item) => /pok[eé]mon/i.test(item.name || '') && PRODUCT_TERMS.test(item.name || '')) || null;
  const name = String(product?.name || metaName || pageName).replace(/\s*[|—-]\s*(Target|Walmart|Best Buy|GameStop|Amazon|Pokémon Center).*$/i, '').trim();
  const identity = `${name} ${product?.description || ''}`;
  if (!/pok[eé]mon/i.test(identity) || !PRODUCT_TERMS.test(identity)) return null;
  const body = stripTags(page.html).slice(0, 500000);
  const offer = offerFor(product);
  const availabilityRaw = offer.availability || product?.offers?.availability || metaContent(page.html, ['product:availability', 'availability']);
  const stockState = classifyAvailability(availabilityRaw, body);
  const price = offer.price ?? offer.lowPrice ?? metaContent(page.html, ['product:price:amount', 'og:price:amount']) ?? '';
  const currency = offer.priceCurrency || metaContent(page.html, ['product:price:currency']) || 'USD';
  const priceText = price !== '' ? `${currency === 'USD' ? '$' : `${currency} `}${price}` : '';
  return { name: name.slice(0, 180), retailer: retailer.name, productUrl: canonicalPageUrl(page.html, page.url), imageUrl: firstImage(product, page.html, page.url), price: priceText, stockState, availabilitySource: availabilityRaw ? 'structured-data' : (stockState === 'UNKNOWN' ? 'none' : 'page-text') };
}
function productKey(url) { return canonicalize(url).split(/[?#]/)[0].toLowerCase(); }
function oldMap(items) { return new Map(items.filter((item) => item?.productUrl).map((item) => [productKey(item.productUrl), item])); }
function setHistory(item, prior, nextState, checkedAt) {
  const history = Array.isArray(prior?.history) ? prior.history.slice(-5) : [];
  if (prior && prior.stockState !== nextState) history.push({ from: prior.stockState || 'UNKNOWN', to: nextState, at: checkedAt });
  return history.slice(-6);
}
function notifyCandidate(prior, current) {
  const currentAvailable = ['IN_STOCK', 'PREORDER'].includes(current.stockState);
  if (!currentAvailable) return false;
  if (!prior) return true;
  return !['IN_STOCK', 'PREORDER'].includes(prior.stockState);
}
async function mapLimit(items, limit, task) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) { const current = items[index++]; try { await task(current); } catch (error) { console.warn(error?.message || error); } }
  }));
}
async function sendDiscord(alerts) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || !alerts.length) return { sent: false, count: 0, reason: webhook ? 'No new restock transitions' : 'DISCORD_WEBHOOK_URL secret is not configured' };
  let url;
  try { url = new URL(webhook); } catch { throw new Error('DISCORD_WEBHOOK_URL is not a valid URL'); }
  if (url.protocol !== 'https:' || !/(^|\.)discord\.com$/i.test(url.hostname) || !url.pathname.includes('/api/webhooks/')) throw new Error('DISCORD_WEBHOOK_URL must be a Discord webhook URL');
  const messages = [];
  for (let i = 0; i < alerts.length; i += 6) messages.push(alerts.slice(i, i + 6));
  let sent = 0;
  for (const group of messages) {
    const content = ['**PokeDrop stock alert**', ...group.map((item) => `• **${item.retailer}: ${item.name}** — **${item.stockState === 'PREORDER' ? 'PREORDER' : 'IN STOCK'}**${item.price ? ` · ${item.price}` : ''}\n${item.productUrl}`)].join('\n');
    const response = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
    sent += group.length;
  }
  return { sent: true, count: sent };
}

async function run() {
  const oldProducts = readJson(PRODUCT_FILE, []);
  const previous = oldMap(Array.isArray(oldProducts) ? oldProducts : []);
  const status = {
    state: 'running', lastScanAt: new Date().toISOString(), retailersChecked: RETAILERS.length, retailersReached: 0,
    productsFound: 0, productsChecked: 0, productsVerified: 0, alertsSent: 0, sources: [], errors: [],
    search: SEARCH_STATS, note: 'Only pages with product-specific Pokémon TCG identity and readable stock signals can generate availability alerts.'
  };
  const discovered = new Map();
  const searchResults = await Promise.all(RETAILERS.map(async (retailer) => ({ retailer, ...(await searchRetailer(retailer)) })));
  const candidateByKey = new Map();
  for (const result of searchResults) {
    const found = result.results || [];
    for (const candidate of found.slice(0, MAX_NEW_PER_RETAILER)) {
      const key = productKey(candidate.url);
      if (!candidateByKey.has(key)) candidateByKey.set(key, { ...candidate, retailer: result.retailer, prior: previous.get(key) || null });
    }
    status.sources.push({ retailer: result.retailer.name, ok: Boolean(result.ok), productsFound: found.length, pagesChecked: 0, error: result.error || '', engine: result.engine || '' });
  }
  // Recheck previously discovered URLs even when a search engine no longer shows them.
  for (const [key, prior] of previous) {
    const retailer = RETAILERS.find((item) => item.name === prior.retailer);
    if (!retailer || candidateByKey.has(key)) continue;
    candidateByKey.set(key, { url: prior.productUrl, title: prior.name, snippet: '', retailer, prior });
  }
  status.productsFound = candidateByKey.size;
  const checkedAt = new Date().toISOString();
  const alerts = [];
  await mapLimit([...candidateByKey.values()].slice(0, MAX_TRACKED_PRODUCTS), CONCURRENCY, async (candidate) => {
    status.productsChecked++;
    const sourceStatus = status.sources.find((item) => item.retailer === candidate.retailer.name);
    if (sourceStatus) sourceStatus.pagesChecked++;
    try {
      const page = await fetchProductPage(candidate.url);
      const canonical = canonicalPageUrl(page.html, page.url);
      if (!isProductUrl(canonical, candidate.retailer)) throw new Error('Final page is not a retailer product detail page');
      const checked = stockFromProductPage({ ...page, url: canonical }, candidate.retailer);
      if (!checked) throw new Error('Retailer page did not confirm a Pokémon TCG product identity');
      const key = productKey(canonical);
      const prior = previous.get(key) || candidate.prior;
      const item = {
        id: key, ...checked, productUrl: canonical, firstSeenAt: prior?.firstSeenAt || checkedAt,
        lastCheckedAt: checkedAt, lastError: '', history: setHistory({}, prior, checked.stockState, checkedAt)
      };
      discovered.set(key, item);
      if (checked.stockState !== 'UNKNOWN') status.productsVerified++;
      if (notifyCandidate(prior, item)) alerts.push(item);
    } catch (error) {
      const prior = candidate.prior || previous.get(productKey(candidate.url));
      const blocked = Boolean(error.blocked);
      const key = productKey(prior?.productUrl || candidate.url);
      if (prior) discovered.set(key, { ...prior, stockState: blocked ? 'BLOCKED' : 'UNKNOWN', lastCheckedAt: checkedAt, lastError: String(error?.message || error).slice(0, 140) });
      if (sourceStatus && blocked) sourceStatus.error = 'Some product pages blocked automated requests';
      console.log(`Retailer page skipped ${candidate.url}: ${error?.message || error}`);
      status.errors.push(`${candidate.retailer.name}: ${String(error?.message || error).slice(0, 120)}`);
    }
  });
  // Keep older known products that were outside this run's page-check budget.
  for (const [key, item] of previous) if (!discovered.has(key)) discovered.set(key, item);

  const products = [...discovered.values()]
    .filter((item) => Date.now() - (Date.parse(item.lastCheckedAt || item.firstSeenAt || 0) || 0) <= 90 * 86400000)
    .sort((a, b) => {
      const rank = { IN_STOCK: 0, PREORDER: 1, OUT_OF_STOCK: 2, UNKNOWN: 3, BLOCKED: 4 };
      return (rank[a.stockState] ?? 5) - (rank[b.stockState] ?? 5) || (Date.parse(b.lastCheckedAt) || 0) - (Date.parse(a.lastCheckedAt) || 0);
    }).slice(0, MAX_TRACKED_PRODUCTS);

  status.retailersReached = searchResults.filter((item) => item.ok).length;
  status.productsFound = products.length;
  status.search = { ...SEARCH_STATS };
  status.state = status.retailersReached ? 'ok' : 'limited';
  try {
    const delivery = await sendDiscord(alerts);
    status.alertsSent = delivery.count;
    status.discord = { configured: Boolean(process.env.DISCORD_WEBHOOK_URL), sent: delivery.sent, note: delivery.reason || '' };
  } catch (error) {
    status.discord = { configured: true, sent: false, note: String(error?.message || error) };
    status.errors.push(`Discord: ${status.discord.note}`);
  }
  status.errors = [...new Set(status.errors)].slice(0, 12);
  if (!status.retailersReached) status.note = 'No retailer search source responded. This is a source-access problem, not proof that stores are sold out.';
  else if (status.errors.length) status.note = 'Some product or retailer pages could not be checked. BLOCKED / UNKNOWN results are not treated as sold out.';

  writeJson(PRODUCT_FILE, products);
  writeJson(STATUS_FILE, status);
  console.log(`PokeDrop stock monitor: ${status.retailersReached}/${status.retailersChecked} searches reached; ${status.productsChecked} product pages checked; ${status.productsVerified} availability signals read; ${status.alertsSent} Discord alerts sent.`);
}

function selfTest() {
  const assert = (condition, message) => { if (!condition) throw new Error(`Self-test failed: ${message}`); };
  assert(classifyAvailability('https://schema.org/InStock', '') === 'IN_STOCK', 'InStock schema mapping');
  assert(classifyAvailability('https://schema.org/PreOrder', '') === 'PREORDER', 'PreOrder schema mapping');
  assert(classifyAvailability('https://schema.org/OutOfStock', '') === 'OUT_OF_STOCK', 'OutOfStock schema mapping');
  assert(classifyAvailability('', 'This item is sold out') === 'OUT_OF_STOCK', 'visible sold-out mapping');
  assert(classifyAvailability('', 'Add to cart') === 'IN_STOCK', 'visible cart signal');
  assert(classifyAvailability('', 'Item details and reviews') === 'UNKNOWN', 'unknown remains unknown');
  const target = RETAILERS.find((item) => item.name === 'Target');
  assert(isProductUrl('https://www.target.com/p/pokemon-tcg/-/A-12345678', target), 'retailer product route');
  assert(!isProductUrl('https://www.target.com/s?searchTerm=pokemon', target), 'search page is not product page');
  assert(!isProductUrl('https://example.com/pokemon', target), 'external domain rejected');
  assert(!notifyCandidate({ stockState: 'IN_STOCK' }, { stockState: 'IN_STOCK' }), 'no duplicate alert');
  assert(notifyCandidate({ stockState: 'OUT_OF_STOCK' }, { stockState: 'IN_STOCK' }), 'restock transition alerts');
  assert(notifyCandidate(null, { stockState: 'PREORDER' }), 'new preorder alerts');
  console.log('PokeDrop retailer monitor self-test passed.');
}

if (process.argv.includes('--self-test')) selfTest();
else run().catch((error) => { console.error(error); process.exitCode = 1; });
