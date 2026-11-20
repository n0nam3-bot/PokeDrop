// Dedicated Pokémon TCG raffle/giveaway page resolver and metadata extractor.
// Free sources only: public publisher pages, embedded entry widgets, HTML metadata and JSON-LD.
import { readFileSync, writeFileSync } from "node:fs";

const RESOLVER_VERSION = 2;
const MAX_LOOKUPS_PER_RUN = 48;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 14000;

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}
function decodeEntities(value) {
  return String(value || "")
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
      const key = entity.toLowerCase();
      if (key === "amp") return "&";
      if (key === "lt") return "<";
      if (key === "gt") return ">";
      if (key === "quot") return '"';
      if (key === "apos") return "'";
      if (key === "nbsp") return " ";
      if (key.startsWith("#x")) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(parseInt(key.slice(1), 10));
      return whole;
    });
}
function stripMarkup(value) {
  return decodeEntities(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function attr(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes || "").match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : "";
}
function resolveUrl(raw, base) {
  try {
    const value = decodeEntities(String(raw || "").replace(/\\\//g, "/").trim());
    if (!value || /^(?:javascript|mailto|tel|data):/i.test(value)) return "";
    let parsed = new URL(value, base);
    if (/((^|\.)google\.[a-z.]+$)/i.test(parsed.hostname) && ["/url", "/redirect"].includes(parsed.pathname)) {
      const wrapped = parsed.searchParams.get("q") || parsed.searchParams.get("url") || parsed.searchParams.get("u") || parsed.searchParams.get("redirect_url") || parsed.searchParams.get("dest");
      if (wrapped) parsed = new URL(wrapped);
    }
    return /^https?:$/.test(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}
function canonicalUrl(html, fallback) {
  for (const [, raw] of String(html || "").matchAll(/<link\b([^>]*)>/gi)) {
    if (/\bcanonical\b/i.test(attr(raw, "rel"))) {
      const candidate = resolveUrl(attr(raw, "href"), fallback);
      if (candidate) return candidate;
    }
  }
  for (const [, raw] of String(html || "").matchAll(/<meta\b([^>]*)>/gi)) {
    const key = attr(raw, "property") || attr(raw, "name");
    if (/^(?:og:url|twitter:url)$/i.test(key)) {
      const candidate = resolveUrl(attr(raw, "content"), fallback);
      if (candidate) return candidate;
    }
  }
  return fallback;
}
function isGoogleHost(host) {
  return /(^|\.)google\.[a-z.]+$/i.test(String(host || "")) || /(^|\.)news\.google\.com$/i.test(String(host || ""));
}
function isEntryPlatform(host) {
  return /(^|\.)(gleam\.io|sweepwidget\.com|rafflecopter\.com|raffall\.com|rafflepress\.com|rafflebox\.us|rafflecreator\.com|viral-sweep\.com|viralsweep\.com|sweeppea\.com|easypromosapp\.com|woobox\.com|shortstack\.com|kingsumo\.com|giveawaytools\.com|promosimple\.com|typeform\.com|jotform\.com)$/i.test(String(host || ""));
}
function metaValue(html, names) {
  const wanted = new Set(names.map((item) => item.toLowerCase()));
  for (const [, raw] of String(html || "").matchAll(/<meta\b([^>]*)>/gi)) {
    const key = (attr(raw, "property") || attr(raw, "name") || attr(raw, "itemprop")).toLowerCase();
    if (wanted.has(key)) {
      const value = attr(raw, "content");
      if (value) return value;
    }
  }
  return "";
}
function titleTag(html) {
  const match = String(html || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripMarkup(match[1]) : "";
}
function pageText(html) {
  return stripMarkup(String(html || "").replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ").replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " "));
}
function flattenJsonLd(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
  } else if (value && typeof value === "object") {
    out.push(value);
    if (value["@graph"]) flattenJsonLd(value["@graph"], out);
    for (const [key, nested] of Object.entries(value)) {
      if (key !== "@graph" && nested && typeof nested === "object") flattenJsonLd(nested, out);
    }
  }
  return out;
}
function jsonLdNodes(html) {
  const nodes = [];
  for (const [, attributes, raw] of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(attr(attributes, "type"))) continue;
    const content = decodeEntities(raw.replace(/^\s*<!--|-->\s*$/g, "").trim());
    try { flattenJsonLd(JSON.parse(content), nodes); } catch { /* invalid publisher JSON-LD is ignored */ }
  }
  return nodes;
}
function typeIncludes(node, type) {
  const value = node?.["@type"];
  return (Array.isArray(value) ? value : [value]).some((item) => String(item || "").toLowerCase().includes(type.toLowerCase()));
}
function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return stripMarkup(value).slice(0, 260);
    if (Array.isArray(value)) {
      const inner = firstText(...value);
      if (inner) return inner;
    }
    if (value && typeof value === "object") {
      const inner = firstText(value.name, value.text, value.description, value.url);
      if (inner) return inner;
    }
  }
  return "";
}
function imageValue(value, base) {
  if (Array.isArray(value)) {
    for (const item of value) { const found = imageValue(item, base); if (found) return found; }
    return "";
  }
  if (value && typeof value === "object") return imageValue(value.url || value.contentUrl || value.thumbnailUrl, base);
  return resolveUrl(value, base);
}
function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function dateFromText(text, kind) {
  const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const date = `(${month}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)`;
  const patterns = kind === "end"
    ? [`(?:entries? close|entry closes?|closes?|ends?|ending|deadline|draw date|through|until)\\s*(?:on|by|at)?\\s*${date}`, `${date}\\s*(?:is the )?(?:deadline|last day to enter)`]
    : [`(?:entries? open|registration opens?|opens?|starts?|begins?)\\s*(?:on|at)?\\s*${date}`];
  for (const pattern of patterns) {
    const match = String(text || "").match(new RegExp(pattern, "i"));
    if (!match) continue;
    let raw = (match[1] || match[0]).replace(/(\d)(st|nd|rd|th)\b/i, "$1");
    const hasYear = /\b\d{4}\b/.test(raw) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(raw);
    if (!hasYear) raw += ` ${new Date().getFullYear()}`;
    const parsed = normalizeDate(raw);
    if (parsed) return parsed;
  }
  return "";
}
function extractPageMetadata(html, pageUrl) {
  const nodes = jsonLdNodes(html);
  const event = nodes.find((node) => typeIncludes(node, "Event") || typeIncludes(node, "Contest")) || {};
  const product = nodes.find((node) => typeIncludes(node, "Product")) || {};
  const website = nodes.find((node) => typeIncludes(node, "WebSite")) || {};
  const organization = nodes.find((node) => typeIncludes(node, "Organization")) || {};
  const publisher = nodes.find((node) => node?.publisher) || {};
  const text = pageText(html);
  let origin = "";
  try { origin = new URL(pageUrl).origin; } catch { /* keep empty */ }

  const pageTitle = firstText(metaValue(html, ["og:title", "twitter:title"]), titleTag(html), event.name, product.name, nodes.find((node) => node.headline)?.headline);
  const pageDescription = firstText(metaValue(html, ["og:description", "description", "twitter:description"]), event.description, product.description, nodes.find((node) => node.description)?.description);
  const siteName = firstText(metaValue(html, ["og:site_name", "application-name"]), website.name, organization.name, publisher.publisher?.name, new URL(pageUrl).hostname.replace(/^www\./, ""));
  const startDate = normalizeDate(event.startDate || event.doorTime || metaValue(html, ["event:start_time", "startDate"])) || dateFromText(text, "start");
  const endDate = normalizeDate(event.endDate || event.offers?.validThrough || metaValue(html, ["event:end_time", "endDate", "expires"])) || dateFromText(text, "end");

  let prize = firstText(event.award, event.prize, event.offers?.name, product.name);
  if (!prize) {
    const prizePatterns = [
      /(?:grand prize|prize package|the prize|prizes include|winner receives|winner will receive|giveaway prize)\s*(?:is|includes|:|-)?\s*([^.!?]{8,180})/i,
      /(?:enter to win|win)\s+(?:a|an|the)?\s*([^.!?]{8,160})/i
    ];
    for (const pattern of prizePatterns) {
      const match = text.match(pattern);
      if (match?.[1]) { prize = match[1].trim().slice(0, 180); break; }
    }
  }

  const productImage = imageValue(product.image, pageUrl);
  const eventImage = imageValue(event.image, pageUrl);
  const featuredImage = resolveUrl(metaValue(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]), pageUrl);
  const altImage = (() => {
    for (const [, raw] of String(html || "").matchAll(/<img\b([^>]*)>/gi)) {
      const altText = attr(raw, "alt");
      if (/pokemon|pok[e\u00e9]mon|prize|giveaway|booster|trainer box|collection/i.test(altText)) {
        const found = resolveUrl(attr(raw, "src") || attr(raw, "data-src"), pageUrl);
        if (found) return found;
      }
    }
    return "";
  })();
  const imageUrl = productImage || eventImage || featuredImage || altImage;
  const imageType = productImage ? "prize" : (eventImage && prize ? "prize" : (imageUrl ? "featured" : ""));

  return {
    pageTitle,
    pageDescription,
    siteName,
    siteUrl: origin,
    startDate,
    endDate,
    prize: prize.replace(/\s+/g, " ").trim().slice(0, 180),
    imageUrl,
    imageType,
    structuredEvent: Boolean(Object.keys(event).length),
    structuredProduct: Boolean(Object.keys(product).length)
  };
}
function findEntryCandidates(html, pageUrl) {
  const candidates = [];
  const source = String(html || "");
  const pageHost = (() => { try { return new URL(pageUrl).hostname.toLowerCase(); } catch { return ""; } })();
  const pageContext = pageText(source).toLowerCase();
  const contestPage = /\b(raffle|giveaway|sweepstakes|contest|lottery|enter to win|prize draw)\b/i.test(pageContext)
    && /\b(pokemon|pok[e\u00e9]mon|tcg|trading cards?|booster|elite trainer box|etb)\b/i.test(pageContext);

  const addCandidate = (rawUrl, label, context, sourceKind = "anchor") => {
    const href = resolveUrl(rawUrl, pageUrl);
    if (!href) return;
    let parsed;
    try { parsed = new URL(href); } catch { return; }
    if (isGoogleHost(parsed.hostname) || /^(?:mailto|tel):/i.test(href)) return;
    const host = parsed.hostname.toLowerCase();
    const platform = isEntryPlatform(host);
    const external = host !== pageHost;
    const labelText = String(label || "").toLowerCase();
    const around = String(context || "").toLowerCase();
    const allContext = `${labelText} ${around}`;
    const entryAction = /\b(enter(?: now| here| to win)?|enter (?:the|this|our) (?:raffle|giveaway|contest|sweepstakes|lottery)|submit (?:your )?entr(?:y|ies)|register(?: now)?|join (?:the )?(?:giveaway|raffle|contest)|participate|sign up|claim (?:your )?entry|start entry|click (?:here|to enter)|entry form|apply now|complete (?:the )?entry)\b/.test(labelText);
    const contestUrl = /(?:raffle|giveaway|sweepstakes|contest|lottery|(?:^|\/)(?:entry|enter)(?:\/|$)|enter-to-win)/i.test(`${parsed.pathname} ${parsed.search}`);
    const contextProof = /\b(raffle|giveaway|sweepstakes|contest|lottery|pokemon|pok[e\u00e9]mon|tcg|trading cards?)\b/.test(allContext);
    const rulesOnly = /\b(official rules|rules and regulations|terms and conditions|privacy policy)\b/.test(labelText) && !entryAction;
    let score = (platform ? 9 : 0) + (entryAction ? 8 : 0) + (contestUrl ? 6 : 0) + (contextProof ? 3 : 0) + (external ? 1 : 0) + (sourceKind === "iframe" ? 3 : 0);
    if (rulesOnly) score -= 12;
    if (/\/(?:news|article|articles|blog|press-release)\//i.test(parsed.pathname) && !platform) score -= 7;
    const samePagePath = (() => {
      try { return parsed.pathname !== new URL(pageUrl).pathname; } catch { return false; }
    })();
    const valid = !rulesOnly && ((platform && contestPage) || (entryAction && contextProof && external) || (contestUrl && contextProof && (external || samePagePath)));
    if (valid) candidates.push({ url: parsed.href, label: String(label || (sourceKind === "iframe" ? "Embedded entry form" : "Entry link")).slice(0, 100), score });
  };

  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const label = stripMarkup(match[2]) || attr(attrs, "aria-label") || attr(attrs, "title");
    const near = stripMarkup(source.slice(Math.max(0, match.index - 450), Math.min(source.length, match.index + match[0].length + 450)));
    addCandidate(attr(attrs, "href") || attr(attrs, "data-href") || attr(attrs, "data-url") || attr(attrs, "data-link"), label, near);
    const onclick = attr(attrs, "onclick");
    const jsUrl = onclick.match(/(?:location\.href|window\.open|href)\s*[:=(]\s*["']([^"']+)["']/i)?.[1];
    if (jsUrl) addCandidate(jsUrl, label, near);
  }
  for (const match of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attrs = match[1];
    const label = stripMarkup(match[2]) || attr(attrs, "aria-label") || attr(attrs, "title") || "Entry button";
    const target = attr(attrs, "formaction") || attr(attrs, "data-href") || attr(attrs, "data-url");
    if (target) addCandidate(target, label, pageContext, "button");
  }
  for (const match of source.matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = match[1];
    const action = attr(attrs, "action");
    if (action) addCandidate(action, "Entry form", pageContext, "form");
  }
  for (const match of source.matchAll(/<iframe\b([^>]*)>/gi)) {
    const attrs = match[1];
    addCandidate(attr(attrs, "src") || attr(attrs, "data-src"), attr(attrs, "title") || "Embedded entry form", pageContext, "iframe");
  }
  // Contest platforms are often embedded inside script/config JSON rather than visible anchors.
  for (const match of source.matchAll(/(?:https?:\\?\/\\?\/|https?:\/\/)[^\s"'<>\\]+/gi)) {
    const raw = match[0].replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/[),;]+$/, "");
    if (/gleam\.io|sweepwidget\.com|rafflecopter\.com|raffall\.com|viralsweep\.com|viral-sweep\.com|woobox\.com|easypromosapp\.com|shortstack\.com|kingsumo\.com|promosimple\.com/i.test(raw)) {
      addCandidate(raw, "Embedded giveaway platform", pageContext, "script");
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}
function findPublisherArticleInGooglePage(html, googleUrl, publisherUrl) {
  let publisherHost = "";
  try { publisherHost = new URL(publisherUrl).hostname.toLowerCase(); } catch { return ""; }
  for (const [, attributes, inner] of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = resolveUrl(attr(attributes, "href") || attr(attributes, "data-href"), googleUrl);
    if (!href) continue;
    try {
      const parsed = new URL(href);
      if (parsed.hostname.toLowerCase() !== publisherHost) continue;
      if (parsed.pathname === "/" || /\/(?:search|author|category|tag|feed)(?:\/|$)/i.test(parsed.pathname)) continue;
      if (stripMarkup(inner).length || parsed.pathname.split("/").filter(Boolean).length >= 1) return parsed.href;
    } catch { /* ignore malformed wrapper links */ }
  }
  return "";
}

function isDirectEntryPage(url, html) {
  try {
    const parsed = new URL(url);
    if (isEntryPlatform(parsed.hostname)) return true;
    const text = pageText(html);
    const contestContext = /\b(raffle|giveaway|sweepstakes|contest|lottery|entry)\b/i.test(text);
    if (!contestContext) return false;
    return [...String(html || "").matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].some(([, attrs, body]) => {
      const bodyText = stripMarkup(`${attr(attrs, "action")} ${body}`);
      return /\b(enter|submit|register|participate|join|sweepstakes|giveaway|raffle)\b/i.test(bodyText)
        && /<input|<button|type\s*=\s*["']?submit/i.test(body);
    });
  } catch { return false; }
}
async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; PokeDropRaffleRadar/2.0; +https://github.com/n0nam3-bot/PokeDrop)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) throw new Error(`Not an HTML page (${contentType})`);
  return { html: (await response.text()).slice(0, 3000000), url: response.url || url };
}
function storeFromText(text, fallback) {
  const haystack = String(text || "");
  const patterns = [
    ["Pokémon Center", /pok[e\u00e9]mon\s*center|pokemon\.com/i], ["Target", /\btarget\b/i],
    ["Walmart", /\bwalmart\b/i], ["Costco", /\bcostco\b/i], ["GameStop", /game\s*stop/i],
    ["Best Buy", /best\s*buy/i], ["Amazon", /\bamazon\b/i], ["Sam's Club", /sam'?s\s*club/i],
    ["TCGplayer", /tcgplayer/i], ["Local Card Shop", /card\s*shop|game\s*store|\bLGS\b/i]
  ];
  return patterns.find(([, regex]) => regex.test(haystack))?.[0] || fallback || "Other";
}
function inferStatus(raffle, metadata, bodyText) {
  const now = Date.now();
  const start = Date.parse(metadata.startDate || raffle.startDate || "");
  const end = Date.parse(metadata.endDate || raffle.endDate || "");
  if (Number.isFinite(end) && end < now) return { status: "Closed", statusDate: metadata.endDate || raffle.endDate, statusNote: "The event page lists an entry deadline that has passed." };
  if (Number.isFinite(start) && start > now) return { status: "Upcoming", statusDate: metadata.startDate || raffle.startDate, statusNote: "The event page lists a future opening date." };
  if (Number.isFinite(end)) return { status: "Open", statusDate: metadata.endDate || raffle.endDate, statusNote: "The event page lists a future entry deadline. Confirm the official rules and eligibility." };
  if (/\b(entries? (?:are )?closed|no longer accepting entries|winners? (?:were )?(?:announced|selected|drawn)|giveaway ended|raffle ended|deadline (?:has )?passed)\b/i.test(bodyText)) {
    return { status: "Closed", statusDate: "", statusNote: "The source page indicates that entries have closed or winners were selected." };
  }
  if (/\b(enter now|entries? (?:are )?open|giveaway is live|raffle is live|register now|registration is open)\b/i.test(bodyText) && isDirectEntryPage(raffle.entryUrl || raffle.sourceUrl, bodyText)) {
    return { status: "Open", statusDate: "", statusNote: "The official entry page appears to be accepting entries; confirm the rules before entering." };
  }
  return { status: "Verify", statusDate: "", statusNote: "The page was checked, but current entry status or dates were not explicit." };
}
async function resolveRaffle(raffle) {
  const sourceUrl = String(raffle.sourceUrl || raffle.url || "").trim();
  const publisherUrl = String(raffle.publisherUrl || "").trim();
  if (!/^https?:\/\//i.test(sourceUrl)) return { status: "error", error: "No publisher/article URL was available." };

  let sourcePage;
  let usedPublisherFallback = false;
  try {
    sourcePage = await fetchHtml(sourceUrl);
  } catch (firstError) {
    if (!/^https?:\/\//i.test(publisherUrl)) throw firstError;
    sourcePage = await fetchHtml(publisherUrl);
    usedPublisherFallback = true;
  }

  if (isGoogleHost(new URL(sourcePage.url).hostname)) {
    const articleUrl = findPublisherArticleInGooglePage(sourcePage.html, sourcePage.url, publisherUrl);
    if (articleUrl) sourcePage = await fetchHtml(articleUrl);
    else if (/^https?:\/\//i.test(publisherUrl)) {
      sourcePage = await fetchHtml(publisherUrl);
      usedPublisherFallback = true;
    }
  }
  if (isGoogleHost(new URL(sourcePage.url).hostname)) return { status: "error", error: "Could not resolve the Google News redirect to a publisher page." };

  const sourceCanonical = canonicalUrl(sourcePage.html, sourcePage.url);
  const sourceMetadata = extractPageMetadata(sourcePage.html, sourceCanonical);
  const sourceText = pageText(sourcePage.html);
  let entryUrl = "";
  let entryLinkLabel = "";
  let finalMetadata = { ...sourceMetadata };

  if (isDirectEntryPage(sourcePage.url, sourcePage.html) || isDirectEntryPage(sourceCanonical, sourcePage.html)) {
    entryUrl = sourcePage.url;
    entryLinkLabel = "Official entry page";
  } else {
    const candidate = findEntryCandidates(sourcePage.html, sourcePage.url)[0];
    if (candidate) {
      entryUrl = candidate.url;
      entryLinkLabel = candidate.label || "Entry page";
      try {
        const entryPage = await fetchHtml(entryUrl);
        const entryMetadata = extractPageMetadata(entryPage.html, entryPage.url);
        finalMetadata = {
          ...sourceMetadata,
          pageTitle: entryMetadata.pageTitle || sourceMetadata.pageTitle,
          pageDescription: entryMetadata.pageDescription || sourceMetadata.pageDescription,
          startDate: entryMetadata.startDate || sourceMetadata.startDate,
          endDate: entryMetadata.endDate || sourceMetadata.endDate,
          prize: entryMetadata.prize || sourceMetadata.prize,
          imageUrl: entryMetadata.imageUrl || sourceMetadata.imageUrl,
          imageType: entryMetadata.imageUrl ? entryMetadata.imageType : sourceMetadata.imageType,
          structuredEvent: sourceMetadata.structuredEvent || entryMetadata.structuredEvent,
          structuredProduct: sourceMetadata.structuredProduct || entryMetadata.structuredProduct
        };
      } catch {
        // The link itself remains a valid candidate; blocked entry-platform pages do not erase source-page metadata.
      }
    }
  }

  const host = (() => { try { return new URL(sourceCanonical).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  const publisherOrigin = (() => { try { return new URL(publisherUrl).origin; } catch { return ""; } })();
  const siteName = sourceMetadata.siteName || raffle.siteName || raffle.source || host;
  const metadata = {
    ...finalMetadata,
    siteName,
    siteUrl: publisherOrigin || sourceMetadata.siteUrl || (() => { try { return new URL(sourceCanonical).origin; } catch { return ""; } })()
  };
  const status = inferStatus({ ...raffle, entryUrl }, metadata, sourceText);
  return {
    status: entryUrl ? "found" : "not-found",
    sourceUrl: usedPublisherFallback ? sourceUrl : sourceCanonical,
    entryUrl,
    entryLinkLabel,
    metadata,
    inferredStatus: status,
    sourceTextLength: sourceText.length
  };
}
async function mapWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try { await worker(items[index], index); }
      catch (error) { console.error("Raffle enrichment worker error:", error?.message || error); }
    }
  });
  await Promise.all(workers);
}

const raffles = readJson("raffles.json", []);
if (!Array.isArray(raffles) || !raffles.length) {
  console.log("Raffle discovery: no raffle leads to enrich.");
} else {
  const now = Date.now();
  const needsMetadata = (item) => !item.siteName || !item.siteUrl || !item.prize || !item.imageUrl || !item.startDate || !item.endDate;
  const candidates = raffles.filter((item) => {
    if (Number(item.entryLookupVersion || 0) < RESOLVER_VERSION) return true;
    if (item.entryUrl && !needsMetadata(item)) return false;
    const last = Date.parse(item.entryLookupAt || "");
    if (!Number.isFinite(last)) return true;
    const retryAfter = item.entryLookupStatus === "error" ? 864e5 : 7 * 864e5;
    return now - last >= retryAfter;
  }).slice(0, MAX_LOOKUPS_PER_RUN);

  let lookupErrors = 0;
  let publisherPagesResolved = 0;
  await mapWithConcurrency(candidates, CONCURRENCY, async (raffle) => {
    const checkedAt = new Date().toISOString();
    try {
      const resolved = await resolveRaffle(raffle);
      raffle.sourceUrl = resolved.sourceUrl || raffle.sourceUrl || raffle.url;
      raffle.publisherUrl = raffle.publisherUrl || (resolved.metadata?.siteUrl || "");
      raffle.entryUrl = resolved.entryUrl || raffle.entryUrl || "";
      raffle.entryLinkLabel = resolved.entryLinkLabel || raffle.entryLinkLabel || "";
      raffle.entryLookupStatus = resolved.status;
      raffle.entryLookupAt = checkedAt;
      raffle.entryLookupVersion = RESOLVER_VERSION;
      raffle.lastVerifiedAt = checkedAt;
      if (resolved.metadata) {
        for (const field of ["siteName", "siteUrl", "pageTitle", "pageDescription", "startDate", "endDate", "prize", "imageUrl", "imageType"]) {
          if (resolved.metadata[field]) raffle[field] = resolved.metadata[field];
        }
        if (resolved.inferredStatus) {
          raffle.status = resolved.inferredStatus.status;
          raffle.statusDate = resolved.inferredStatus.statusDate || null;
          raffle.statusNote = resolved.inferredStatus.statusNote;
        }
        raffle.store = storeFromText(`${raffle.title} ${raffle.source} ${raffle.siteName} ${raffle.siteUrl}`, raffle.store);
      }
      publisherPagesResolved += 1;
      console.log(`Raffle checked (${resolved.status}): ${raffle.title}`);
    } catch (error) {
      raffle.entryLookupStatus = "error";
      raffle.entryLookupAt = checkedAt;
      raffle.entryLookupVersion = RESOLVER_VERSION;
      raffle.lastVerifiedAt = checkedAt;
      raffle.entryLookupError = String(error?.message || error).slice(0, 180);
      lookupErrors += 1;
      console.warn(`Raffle page check failed: ${raffle.title} // ${raffle.entryLookupError}`);
    }
  });

  const raffleOutput = `${JSON.stringify(raffles, null, 1)}\n`;
  writeFileSync("raffles.json", raffleOutput);

  const diagnostics = readJson("feed-status.json", {});
  diagnostics.raffles ||= {};
  diagnostics.raffles.directEntryLinksFound = raffles.filter((item) => /^https?:\/\//i.test(item.entryUrl || "")).length;
  diagnostics.raffles.directEntryLinksMissing = raffles.filter((item) => !/^https?:\/\//i.test(item.entryUrl || "")).length;
  diagnostics.raffles.entryLookupsThisRun = candidates.length;
  diagnostics.raffles.entryLookupErrors = lookupErrors;
  diagnostics.raffles.discoveryEngine = {
    version: RESOLVER_VERSION,
    publisherPagesChecked: publisherPagesResolved,
    prizeDetailsFound: raffles.filter((item) => item.prize).length,
    startDatesFound: raffles.filter((item) => item.startDate).length,
    endDatesFound: raffles.filter((item) => item.endDate).length,
    prizeImagesFound: raffles.filter((item) => item.imageUrl && item.imageType === "prize").length,
    featuredImagesFound: raffles.filter((item) => item.imageUrl && item.imageType !== "prize").length,
    structuredEventsFound: raffles.filter((item) => item.pageTitle && item.startDate && item.endDate).length
  };
  writeFileSync("feed-status.json", `${JSON.stringify(diagnostics, null, 1)}\n`);

  console.log(`Raffle discovery v${RESOLVER_VERSION}: checked ${candidates.length}/${raffles.length}; ${diagnostics.raffles.directEntryLinksFound} direct entry URLs; ${diagnostics.raffles.discoveryEngine.prizeDetailsFound} prize details; ${diagnostics.raffles.discoveryEngine.endDatesFound} end dates; ${lookupErrors} page errors.`);
}
