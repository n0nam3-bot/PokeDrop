import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = process.cwd();
const PRODUCT_FILE = `${ROOT}/products.json`;
const STATUS_FILE = `${ROOT}/product-status.json`;
const REQUEST_TIMEOUT_MS = 9000;
const MAX_NEW_PER_RETAILER = 3;
const MAX_TRACKED_PRODUCTS = 60;
const CONCURRENCY = 4;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 PokeDropCloudRadar/2.0';

const RETAILERS = [
  { name: 'Pokémon Center', domain: 'pokemoncenter.com', path: /\/product\//i, searchUrl: 'https://www.pokemoncenter.com/search?q=Pokemon%20TCG' },
  { name: 'Target', domain: 'target.com', path: /\/p\//i, searchUrl: 'https://www.target.com/s?searchTerm=Pokemon%20trading%20card%20game' },
  { name: 'Walmart', domain: 'walmart.com', path: /\/ip\//i, searchUrl: 'https://www.walmart.com/search?q=Pokemon%20trading%20cards' },
  { name: 'Best Buy', domain: 'bestbuy.com', path: /\/site\/[^/]+\/\d{5,}/i, searchUrl: 'https://www.bestbuy.com/site/searchpage.jsp?st=Pokemon%20trading%20cards' },
  { name: 'GameStop', domain: 'gamestop.com', path: /\/product\//i, searchUrl: 'https://www.gamestop.com/search/?q=Pokemon%20trading%20cards' },
  { name: 'Amazon', domain: 'amazon.com', path: /\/(?:dp|gp\/product)\/[a-z0-9]{8,}/i, searchUrl: 'https://www.amazon.com/s?k=Pokemon+trading+card+game' },
  { name: 'Costco', domain: 'costco.com', path: /\/(?:p|product)\//i, searchUrl: 'https://www.costco.com/CatalogSearch?keyword=Pokemon%20trading%20cards' },
  { name: 'TCGplayer', domain: 'tcgplayer.com', path: /\/product\//i, searchUrl: 'https://www.tcgplayer.com/search/pokemon/product?q=Pokemon%20TCG' },
  { name: 'Barnes & Noble', domain: 'barnesandnoble.com', path: /\/w\//i, searchUrl: 'https://www.barnesandnoble.com/s/Pokemon%20trading%20cards' },
  { name: 'Meijer', domain: 'meijer.com', path: /\/(?:shopping\/)?product\//i, searchUrl: 'https://www.meijer.com/shopping/search.html?query=Pokemon%20trading%20cards' }
];

const POKEMON_RE = /pok[eé]mon/i;
const PRODUCT_TERMS = /\b(tcg|trading cards?|pok[eé]mon cards?|card game|booster(?: box| packs?| bundle)?|elite trainer boxes?|\betb\b|collection boxes?|mini tins?|collector chests?|ultra[- ]premium|premium collection|build and battle|promo cards?|pokemon center collection)\b/i;
const BLOCKED_TEXT = /access denied|unusual traffic|verify you are human|are you a robot|robot check|captcha|automated requests|cloudflare ray id|request blocked|temporarily blocked|enable javascript and cookies to continue/i;
const SEARCH_STATS = {
  requests: 0,
  retailerSearchPages: 0,
  bingRssRequests: 0,
  bingHtmlRequests: 0,
  duckduckgoRequests: 0,
  successfulSearches: 0,
  resultLinks: 0,
  blockedResponses: 0,
  errors: 0
};

function readJson(path, fallback) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function decodeEntities(value) {
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, raw) => {
    const key = raw.toLowerCase();
    if (key === 'amp') return '&';
    if (key === 'lt') return '<';
    if (key === 'gt') return '>';
    if (key === 'quot') return '"';
    if (key === 'apos') return "'";
    if (key === 'nbsp') return ' ';
    try { return String.fromCodePoint(key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10)); }
    catch { return all; }
  });
}
function stripTags(value) {
  return decodeEntities(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function attribute(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(source || '').match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? '') : '';
}
function resolveUrl(raw, base) {
  try {
    const value = decodeEntities(String(raw || '').replace(/\\\//g, '/').trim());
    if (!value || /^(?:javascript|mailto|tel|data):/i.test(value)) return '';
    return new URL(value, base).href;
  } catch { return ''; }
}
function canonicalize(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return ''; }
}
function unwrapSearchUrl(raw, base) {
  const resolved = resolveUrl(raw, base);
  if (!resolved) return '';
  try {
    const url = new URL(resolved);
    if (/bing\.com$/i.test(url.hostname)) {
      const wrapped = url.searchParams.get('u');
      if (wrapped?.startsWith('a1')) {
        const decoded = Buffer.from(wrapped.slice(2), 'base64').toString('utf8');
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
    if (/duckduckgo\.com$/i.test(url.hostname)) {
      const wrapped = url.searchParams.get('uddg') || url.searchParams.get('url');
      if (wrapped) return new URL(wrapped).href;
    }
    return resolved;
  } catch { return resolved; }
}
function domainMatches(url, retailer) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host === retailer.domain || host.endsWith(`.${retailer.domain}`);
  } catch { return false; }
}
function isProductUrl(url, retailer) {
  try { return domainMatches(url, retailer) && retailer.path.test(new URL(url).pathname); }
  catch { return false; }
}
function productEvidence(text) {
  return POKEMON_RE.test(text) && PRODUCT_TERMS.test(text);
}
function extractProductLinksFromHtml(html, baseUrl, retailer) {
  const source = String(html || '');
  const results = [];
  const seen = new Set();
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const rawHref = attribute(attrs, 'href') || attribute(attrs, 'data-href') || attribute(attrs, 'data-url') || attribute(attrs, 'data-product-url');
    const url = canonicalize(resolveUrl(rawHref, baseUrl));
    if (!url || !isProductUrl(url, retailer)) continue;
    const label = stripTags(match[2]) || attribute(attrs, 'aria-label') || attribute(attrs, 'title') || attribute(attrs, 'data-title');
    const start = Math.max(0, match.index - 1400);
    const end = Math.min(source.length, match.index + match[0].length + 1400);
    const nearby = stripTags(source.slice(start, end));
    const evidence = `${label} ${attribute(attrs, 'title')} ${attribute(attrs, 'aria-label')} ${nearby} ${new URL(url).pathname}`;
    if (!productEvidence(evidence)) continue;
    const key = url.split(/[?#]/)[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const score = (POKEMON_RE.test(`${label} ${nearby}`) ? 5 : 0)
      + (PRODUCT_TERMS.test(`${label} ${nearby}`) ? 4 : 0)
      + (label.length > 10 ? 1 : 0);
    results.push({ url, title: label || stripTags(new URL(url).pathname.replace(/[-_/]+/g, ' ')), snippet: nearby.slice(0, 500), score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 12);
}
function xmlValue(source, tag) {
  const match = String(source || '').match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  return decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim());
}
function extractBingRssLinks(xml, baseUrl, retailer) {
  const results = [];
  const seen = new Set();
  for (const [, item] of String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = stripTags(xmlValue(item, 'title'));
    const rawLink = xmlValue(item, 'link') || xmlValue(item, 'guid');
    const url = canonicalize(unwrapSearchUrl(rawLink, baseUrl));
    const snippet = stripTags(xmlValue(item, 'description'));
    if (!url || !isProductUrl(url, retailer) || !productEvidence(`${title} ${snippet}`)) continue;
    const key = url.split(/[?#]/)[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ url, title, snippet, score: 10 });
  }
  return results;
}
function extractSearchEngineLinks(html, baseUrl, retailer) {
  const source = String(html || '');
  const results = [];
  const seen = new Set();
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const rawHref = attribute(attrs, 'href');
    const url = canonicalize(unwrapSearchUrl(rawHref, baseUrl));
    if (!url || !isProductUrl(url, retailer)) continue;
    const title = stripTags(match[2]) || attribute(attrs, 'aria-label') || attribute(attrs, 'title');
    const start = Math.max(0, match.index - 1100);
    const end = Math.min(source.length, match.index + match[0].length + 1100);
    const snippet = stripTags(source.slice(start, end));
    if (!productEvidence(`${title} ${snippet}`)) continue;
    const key = url.split(/[?#]/)[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ url, title, snippet: snippet.slice(0, 500), score: 8 });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 12);
}
async function fetchText(url, accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8') {
  SEARCH_STATS.requests++;
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const body = (await response.text()).slice(0, 2200000);
  if ([403, 429, 503].includes(response.status)) {
    SEARCH_STATS.blockedResponses++;
    const error = new Error(`HTTP ${response.status}`);
    error.blocked = true;
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (BLOCKED_TEXT.test(stripTags(body).slice(0, 26000))) {
    SEARCH_STATS.blockedResponses++;
    const error = new Error('Anti-bot / access-block response');
    error.blocked = true;
    throw error;
  }
  if (body.length < 120) throw new Error('Empty or incomplete response');
  return { body, url: response.url || url, contentType: response.headers.get('content-type') || '' };
}
async function searchRetailer(retailer) {
  const errors = [];
  let responded = false;
  // Search the retailer's own public catalogue first. This avoids depending on a
  // third-party search engine's private HTML selectors to discover product URLs.
  try {
    SEARCH_STATS.retailerSearchPages++;
    const page = await fetchText(retailer.searchUrl);
    responded = true;
    const found = extractProductLinksFromHtml(page.body, page.url, retailer);
    SEARCH_STATS.resultLinks += found.length;
    if (found.length) {
      SEARCH_STATS.successfulSearches++;
      return { ok: true, responded: true, results: found, method: 'retailer-search', error: '' };
    }
    errors.push('Retailer search page loaded but did not expose matching product-detail links in its HTML');
  } catch (error) {
    errors.push(`Retailer search: ${error.message}`);
    SEARCH_STATS.errors++;
  }

  const query = `site:${retailer.domain} (Pokemon OR Pokémon) ("trading card" OR TCG OR booster OR "elite trainer box" OR collection box OR mini tin)`;
  const engines = [
    { method: 'bing-rss', url: `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, accept: 'application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8' },
    { method: 'bing-html', url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=us`, accept: 'text/html,application/xhtml+xml' },
    { method: 'duckduckgo-html', url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, accept: 'text/html,application/xhtml+xml' }
  ];
  for (const engine of engines) {
    try {
      if (engine.method === 'bing-rss') SEARCH_STATS.bingRssRequests++;
      if (engine.method === 'bing-html') SEARCH_STATS.bingHtmlRequests++;
      if (engine.method === 'duckduckgo-html') SEARCH_STATS.duckduckgoRequests++;
      const page = await fetchText(engine.url, engine.accept);
      responded = true;
      const found = engine.method === 'bing-rss'
        ? extractBingRssLinks(page.body, page.url, retailer)
        : extractSearchEngineLinks(page.body, page.url, retailer);
      SEARCH_STATS.resultLinks += found.length;
      if (found.length) {
        SEARCH_STATS.successfulSearches++;
        return { ok: true, responded: true, results: found, method: engine.method, error: '' };
      }
      errors.push(`${engine.method}: response contained no matching product-detail links`);
    } catch (error) {
      errors.push(`${engine.method}: ${error.message}`);
      SEARCH_STATS.errors++;
    }
  }
  return {
    ok: responded,
    responded,
    results: [],
    method: 'none',
    error: errors.join(' | ').slice(0, 240) || 'No public retailer product links found'
  };
}
async function fetchProductPage(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/ld+json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  const html = (await response.text()).slice(0, 2800000);
  const finalUrl = response.url || url;
  if ([403, 429, 503].includes(response.status)) {
    const error = new Error(`HTTP ${response.status}`);
    error.blocked = true;
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (BLOCKED_TEXT.test(stripTags(html).slice(0, 30000))) {
    const error = new Error('Anti-bot or access-block page');
    error.blocked = true;
    throw error;
  }
  if (html.length < 250) throw new Error('Empty or incomplete retailer page');
  return { html, url: finalUrl };
}
function metaContent(html, names) {
  const target = new Set(names.map((name) => name.toLowerCase()));
  for (const [, attrs] of String(html || '').matchAll(/<meta\b([^>]*)>/gi)) {
    const key = (attribute(attrs, 'property') || attribute(attrs, 'name') || attribute(attrs, 'itemprop')).toLowerCase();
    if (target.has(key)) {
      const value = attribute(attrs, 'content');
      if (value) return value;
    }
  }
  return '';
}
function pageTitle(html) {
  const match = String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripTags(match[1]) : '';
}
function canonicalPageUrl(html, fallback) {
  for (const [, attrs] of String(html || '').matchAll(/<link\b([^>]*)>/gi)) {
    if (/canonical/i.test(attribute(attrs, 'rel'))) {
      try { return new URL(attribute(attrs, 'href'), fallback).href; } catch { /* fallback */ }
    }
  }
  return fallback;
}
function flatten(value, target = []) {
  if (Array.isArray(value)) value.forEach((item) => flatten(item, target));
  else if (value && typeof value === 'object') {
    target.push(value);
    Object.values(value).forEach((child) => { if (child && typeof child === 'object') flatten(child, target); });
  }
  return target;
}
function schemaNodes(html) {
  const nodes = [];
  for (const [, attrs, raw] of String(html || '').matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(attribute(attrs, 'type'))) continue;
    try { nodes.push(...flatten(JSON.parse(raw.replace(/^\s*<!--|-->\s*$/g, '').trim()))); }
    catch { /* malformed structured data */ }
  }
  return nodes;
}
function isProductNode(node) {
  const type = node?.['@type'];
  return (Array.isArray(type) ? type : [type]).some((value) => String(value || '').toLowerCase() === 'product');
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
  if (!value) return '';
  try {
    const url = new URL(value, base);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch { return ''; }
}
function stockFromProductPage(page, retailer) {
  const nodes = schemaNodes(page.html);
  const pageName = pageTitle(page.html);
  const metaName = metaContent(page.html, ['og:title', 'twitter:title']);
  const products = nodes.filter(isProductNode);
  const product = products.find((item) => productEvidence(`${item.name || ''} ${item.description || ''}`))
    || products.find((item) => POKEMON_RE.test(item.name || '') && PRODUCT_TERMS.test(item.name || ''))
    || null;
  const name = String(product?.name || metaName || pageName)
    .replace(/\s*[|—-]\s*(Target|Walmart|Best Buy|GameStop|Amazon|Pokémon Center).*$/i, '').trim();
  const identity = `${name} ${product?.description || ''} ${metaContent(page.html, ['og:description', 'description'])}`;
  if (!productEvidence(identity)) return null;
  const body = stripTags(page.html).slice(0, 500000);
  const offer = offerFor(product);
  const availabilityRaw = offer.availability || product?.offers?.availability || metaContent(page.html, ['product:availability', 'availability']);
  const stockState = classifyAvailability(availabilityRaw, body);
  const price = offer.price ?? offer.lowPrice ?? metaContent(page.html, ['product:price:amount', 'og:price:amount']) ?? '';
  const currency = offer.priceCurrency || metaContent(page.html, ['product:price:currency']) || 'USD';
  const priceText = price !== '' ? `${currency === 'USD' ? '$' : `${currency} `}${price}` : '';
  return {
    name: name.slice(0, 180),
    retailer: retailer.name,
    productUrl: canonicalPageUrl(page.html, page.url),
    imageUrl: firstImage(product, page.html, page.url),
    price: priceText,
    stockState,
    availabilitySource: availabilityRaw ? 'structured-data' : (stockState === 'UNKNOWN' ? 'none' : 'page-text')
  };
}
function productKey(url) { return canonicalize(url).split(/[?#]/)[0].toLowerCase(); }
function oldMap(items) {
  return new Map((Array.isArray(items) ? items : []).filter((item) => item?.productUrl)
    .map((item) => [productKey(item.productUrl), item]));
}
function setHistory(prior, nextState, checkedAt) {
  const history = Array.isArray(prior?.history) ? prior.history.slice(-5) : [];
  if (prior && prior.stockState !== nextState) history.push({ from: prior.stockState || 'UNKNOWN', to: nextState, at: checkedAt });
  return history.slice(-6);
}
function notifyCandidate(prior, current) {
  const available = ['IN_STOCK', 'PREORDER'].includes(current.stockState);
  if (!available) return false;
  if (!prior) return true;
  return !['IN_STOCK', 'PREORDER'].includes(prior.stockState);
}
async function mapLimit(items, limit, task) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      try { await task(current); } catch (error) { console.warn(error?.message || error); }
    }
  }));
}
async function sendDiscord(alerts) {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook || !alerts.length) return { sent: false, count: 0, reason: webhook ? 'No new restock transitions' : 'DISCORD_WEBHOOK_URL secret is not configured' };
  let url;
  try { url = new URL(webhook); } catch { throw new Error('DISCORD_WEBHOOK_URL is not a valid URL'); }
  if (url.protocol !== 'https:' || !/(^|\.)discord\.com$/i.test(url.hostname) || !url.pathname.includes('/api/webhooks/')) {
    throw new Error('DISCORD_WEBHOOK_URL must be a Discord webhook URL');
  }
  const messages = [];
  for (let i = 0; i < alerts.length; i += 6) messages.push(alerts.slice(i, i + 6));
  let sent = 0;
  for (const group of messages) {
    const content = ['**PokeDrop stock alert**', ...group.map((item) =>
      `• **${item.retailer}: ${item.name}** — **${item.stockState === 'PREORDER' ? 'PREORDER' : 'IN STOCK'}**${item.price ? ` · ${item.price}` : ''}\n${item.productUrl}`
    )].join('\n');
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
    sent += group.length;
  }
  return { sent: true, count: sent };
}

async function run() {
  const existingProducts = readJson(PRODUCT_FILE, []);
  const previous = oldMap(existingProducts);
  const status = {
    state: 'running',
    lastScanAt: new Date().toISOString(),
    retailersChecked: RETAILERS.length,
    retailersReached: 0,
    retailersWithProducts: 0,
    productsFound: 0,
    productsChecked: 0,
    productsVerified: 0,
    alertsSent: 0,
    sources: [],
    errors: [],
    search: SEARCH_STATS,
    note: 'A successful search response is not a stock check. Stock is reported only after a product detail page is fetched and validated.'
  };

  const searches = await Promise.all(RETAILERS.map(async (retailer) => ({ retailer, ...(await searchRetailer(retailer)) })));
  const candidates = new Map();
  for (const result of searches) {
    const found = result.results || [];
    for (const item of found.slice(0, MAX_NEW_PER_RETAILER)) {
      const key = productKey(item.url);
      if (key && !candidates.has(key)) candidates.set(key, { ...item, retailer: result.retailer, prior: previous.get(key) || null });
    }
    status.sources.push({
      retailer: result.retailer.name,
      ok: Boolean(result.ok),
      responded: Boolean(result.responded),
      productsFound: found.length,
      pagesChecked: 0,
      method: result.method || 'none',
      error: result.error || ''
    });
  }

  // A product already discovered once stays tracked even when search engines stop indexing it.
  for (const [key, prior] of previous) {
    const retailer = RETAILERS.find((item) => item.name === prior.retailer);
    if (!retailer || candidates.has(key)) continue;
    candidates.set(key, { url: prior.productUrl, title: prior.name, snippet: '', retailer, prior });
  }

  status.retailersReached = searches.filter((item) => item.responded).length;
  status.retailersWithProducts = searches.filter((item) => (item.results || []).length > 0).length;
  status.productsFound = candidates.size;
  const checkedAt = new Date().toISOString();
  const discovered = new Map();
  const alerts = [];

  await mapLimit([...candidates.values()].slice(0, MAX_TRACKED_PRODUCTS), CONCURRENCY, async (candidate) => {
    status.productsChecked++;
    const source = status.sources.find((item) => item.retailer === candidate.retailer.name);
    if (source) source.pagesChecked++;
    try {
      const page = await fetchProductPage(candidate.url);
      const canonical = canonicalPageUrl(page.html, page.url);
      if (!isProductUrl(canonical, candidate.retailer)) throw new Error('Final destination is not a retailer product-detail page');
      const checked = stockFromProductPage({ ...page, url: canonical }, candidate.retailer);
      if (!checked) throw new Error('Product detail page did not confirm a Pokémon TCG item');
      const key = productKey(canonical);
      const prior = previous.get(key) || candidate.prior;
      const item = {
        id: key,
        ...checked,
        productUrl: canonical,
        firstSeenAt: prior?.firstSeenAt || checkedAt,
        lastCheckedAt: checkedAt,
        lastCheckStatus: 'OK',
        lastError: '',
        history: setHistory(prior, checked.stockState, checkedAt)
      };
      discovered.set(key, item);
      if (checked.stockState !== 'UNKNOWN') status.productsVerified++;
      if (notifyCandidate(prior, item)) alerts.push(item);
    } catch (error) {
      const prior = candidate.prior || previous.get(productKey(candidate.url));
      const key = productKey(prior?.productUrl || candidate.url);
      if (prior) {
        // Preserve the last verified stock state if a later scan is blocked. BLOCKED is a
        // check result, not a claim that the item went out of stock.
        discovered.set(key, { ...prior, lastCheckedAt: checkedAt, lastCheckStatus: error.blocked ? 'BLOCKED' : 'ERROR', lastError: String(error?.message || error).slice(0, 150) });
      }
      if (source) source.error = String(error?.message || error).slice(0, 150);
      status.errors.push(`${candidate.retailer.name}: ${String(error?.message || error).slice(0, 130)}`);
      console.log(`Product detail check skipped: ${candidate.url} // ${error?.message || error}`);
    }
  });

  // Keep known listings that were not within this run's check budget.
  for (const [key, item] of previous) if (!discovered.has(key)) discovered.set(key, item);

  const products = [...discovered.values()]
    .filter((item) => Date.now() - (Date.parse(item.lastCheckedAt || item.firstSeenAt || 0) || 0) <= 90 * 86400000)
    .sort((a, b) => {
      const rank = { IN_STOCK: 0, PREORDER: 1, OUT_OF_STOCK: 2, UNKNOWN: 3 };
      return (rank[a.stockState] ?? 4) - (rank[b.stockState] ?? 4)
        || (Date.parse(b.lastCheckedAt) || 0) - (Date.parse(a.lastCheckedAt) || 0);
    }).slice(0, MAX_TRACKED_PRODUCTS);

  status.productsFound = products.length;
  status.state = status.productsChecked > 0 && status.productsVerified > 0 ? 'ok' : 'limited';
  status.search = { ...SEARCH_STATS };
  if (status.productsChecked === 0) {
    status.note = 'No retailer product detail pages were checked. Retailer/search pages may be blocking or hiding product links; this is not evidence that products are sold out.';
  } else if (status.productsVerified === 0) {
    status.note = 'Product pages were reached, but none exposed a readable stock signal. Listings remain unconfirmed; do not interpret this as sold out.';
  } else if (status.productsVerified > 0) {
    status.note = 'Stock states come from validated product pages. A page that cannot be reached retains its last verified stock state and is marked with a failed check.';
  }

  try {
    const delivery = await sendDiscord(alerts);
    status.alertsSent = delivery.count;
    status.discord = { configured: Boolean(process.env.DISCORD_WEBHOOK_URL), sent: delivery.sent, note: delivery.reason || '' };
  } catch (error) {
    status.discord = { configured: true, sent: false, note: String(error?.message || error) };
    status.errors.push(`Discord: ${status.discord.note}`);
  }
  status.errors = [...new Set(status.errors)].slice(0, 16);
  writeJson(PRODUCT_FILE, products);
  writeJson(STATUS_FILE, status);
  console.log(`PokeDrop cloud stock scan: ${status.retailersReached}/${status.retailersChecked} retailer search pages responded; ${status.retailersWithProducts} returned product links; ${status.productsChecked} product detail pages checked; ${status.productsVerified} stock signals read; ${status.alertsSent} Discord alerts sent.`);
}

function selfTest() {
  const assert = (condition, message) => { if (!condition) throw new Error(`Self-test failed: ${message}`); };
  assert(classifyAvailability('https://schema.org/InStock', '') === 'IN_STOCK', 'InStock structured-data signal');
  assert(classifyAvailability('https://schema.org/PreOrder', '') === 'PREORDER', 'PreOrder structured-data signal');
  assert(classifyAvailability('https://schema.org/OutOfStock', '') === 'OUT_OF_STOCK', 'OutOfStock structured-data signal');
  assert(classifyAvailability('', 'This item is sold out') === 'OUT_OF_STOCK', 'visible sold-out signal');
  assert(classifyAvailability('', 'Add to cart') === 'IN_STOCK', 'visible add-to-cart signal');
  assert(classifyAvailability('', 'Item details and reviews') === 'UNKNOWN', 'missing signal remains unknown');

  const target = RETAILERS.find((item) => item.name === 'Target');
  assert(isProductUrl('https://www.target.com/p/pokemon-tcg-elite-trainer-box/-/A-12345678', target), 'Target product route accepted');
  assert(!isProductUrl('https://www.target.com/s?searchTerm=pokemon', target), 'Target search URL rejected as a product');
  assert(!isProductUrl('https://example.com/pokemon-tcg', target), 'unrelated host rejected');
  const searchFixture = '<div><a href="/p/pokemon-tcg-elite-trainer-box/-/A-12345678">Pokemon TCG Elite Trainer Box</a><span>In stock</span></div>';
  const parsed = extractProductLinksFromHtml(searchFixture, 'https://www.target.com/s?searchTerm=pokemon', target);
  assert(parsed.length === 1 && parsed[0].url.includes('/p/'), 'retailer page links parsed without search-engine CSS selectors');

  const rssFixture = `<rss><channel><item><title>Pokemon TCG Booster Box</title><link>https://www.target.com/p/pokemon-tcg-box/-/A-12345678</link><description>Pokemon Trading Card Game booster box</description></item></channel></rss>`;
  const rss = extractBingRssLinks(rssFixture, 'https://www.bing.com/search?format=rss', target);
  assert(rss.length === 1, 'Bing RSS result parsed');

  const schemaFixture = `<html><head><title>Pokemon TCG Booster Box</title><script type="application/ld+json">{"@type":"Product","name":"Pokemon TCG Booster Box","offers":{"price":"49.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script></head><body>Add to cart</body></html>`;
  const stock = stockFromProductPage({ html: schemaFixture, url: 'https://www.target.com/p/pokemon-tcg-box/-/A-12345678' }, target);
  assert(stock?.stockState === 'IN_STOCK' && stock.price === '$49.99', 'product page schema identity, price and stock extracted');
  assert(!notifyCandidate({ stockState: 'IN_STOCK' }, { stockState: 'IN_STOCK' }), 'no duplicate alert');
  assert(notifyCandidate({ stockState: 'OUT_OF_STOCK' }, { stockState: 'IN_STOCK' }), 'restock transition alerts');
  assert(notifyCandidate(null, { stockState: 'PREORDER' }), 'new preorder alerts');
  console.log('PokeDrop cloud retailer monitor self-test passed.');
}

if (process.argv.includes('--self-test')) selfTest();
else run().catch((error) => { console.error(error); process.exitCode = 1; });
