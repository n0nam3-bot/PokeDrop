// PokeDrop v5 discovery/enrichment: verified retailer product pages and giveaway entry destinations.
// Entry URLs are saved only after the destination itself is fetched and verified as a
// Pokémon TCG giveaway page. Generic platform links, favicons and unrelated article images
// are never treated as prize/item images.
import { readFileSync, writeFileSync } from "node:fs";

const RESOLVER_VERSION = 7;
const MAX_RAFFLE_CHECKS_PER_RUN = 40;
const MAX_POST_IMAGE_CHECKS_PER_RUN = 20;
const MAX_SEARCH_RESULT_CHECKS = 3;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 14000;
const MAX_IMAGES_PER_ITEM = 6;
const SEARCH_STATS = {
  requests: 0, successfulQueries: 0, resultLinks: 0, errors: 0,
  bingRequests: 0, duckDuckGoRequests: 0
};

// Bing News supplies a thumbnail of the article. Use it only when the page itself yields no image.
function thumbRecords(item) {
  return /^https?:\/\//i.test(item?.thumbUrl || "")
    ? [{ url: item.thumbUrl, label: "ARTICLE IMAGE", kind: "article", alt: item.title || "Pokémon TCG news" }]
    : [];
}
function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
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
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
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
  return stripMarkup(String(html || "")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " "));
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
function flattenJsonLd(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenJsonLd(item, out);
  } else if (value && typeof value === "object") {
    out.push(value);
    for (const [key, nested] of Object.entries(value)) {
      if (nested && typeof nested === "object") flattenJsonLd(nested, out);
    }
  }
  return out;
}
function jsonLdNodes(html) {
  const nodes = [];
  for (const [, attributes, raw] of String(html || "").matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(attr(attributes, "type"))) continue;
    const content = decodeEntities(raw.replace(/^\s*<!--|-->\s*$/g, "").trim());
    try { flattenJsonLd(JSON.parse(content), nodes); } catch { /* ignore malformed publisher data */ }
  }
  return nodes;
}
function typeIncludes(node, type) {
  const value = node?.["@type"];
  return (Array.isArray(value) ? value : [value]).some((item) => String(item || "").toLowerCase().includes(type.toLowerCase()));
}
function firstText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return stripMarkup(value).slice(0, 300);
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
function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
function dateFromTextLegacy(text, kind) {
  const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const date = `(${month}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)`;
  // Deliberately require giveaway/entry wording. Product release dates are NOT raffle dates.
  const patterns = kind === "end"
    ? [
        `(?:entries? (?:close|end)|entry (?:closes|ends)|(?:giveaway|raffle|sweepstakes|contest) (?:closes|ends)|entry deadline|last day to enter|deadline to enter)\\s*(?:on|by|at)?\\s*${date}`,
        `${date}\\s*(?:is the )?(?:entry deadline|last day to enter)`
      ]
    : [
        `(?:entries? open|registration opens?|(?:giveaway|raffle|sweepstakes|contest) (?:opens|starts|begins))\\s*(?:on|at)?\\s*${date}`
      ];
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

// Entry windows. Times are read in US Eastern unless the page names another US zone. A deadline with no
// time means the end of that day, and an opening with no time means the start of that day.
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_PATTERN = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
function usDst(year, month, day) {
  const nthSunday = (m, n) => {
    let count = 0;
    for (let d = 1; d <= 31; d += 1) {
      const t = new Date(Date.UTC(year, m, d));
      if (t.getUTCMonth() !== m) break;
      if (t.getUTCDay() === 0 && ++count === n) return d;
    }
    return 0;
  };
  return (month > 2 && month < 10) || (month === 2 && day >= nthSunday(2, 2)) || (month === 10 && day < nthSunday(10, 1));
}
function zonedIso(year, month, day, hour, minute, zone = "ET", second = 0) {
  const z = String(zone || "ET").toLowerCase();
  const base = { et: -5, ct: -6, mt: -7, pt: -8 }[z.length === 2 ? z : `${z[0]}t`] ?? -5;
  const dst = z.length === 3 ? z[1] === "d" : usDst(year, month, day);
  return new Date(Date.UTC(year, month, day, hour - base - (dst ? 1 : 0), minute, second)).toISOString();
}
function whenAt(monthName, dayText, yearText, tail, kind) {
  const month = MONTH_NAMES.indexOf(String(monthName).slice(0, 3).toLowerCase());
  const day = Number(dayText);
  if (month < 0 || day < 1 || day > 31) return "";
  let year = yearText ? Number(yearText) : new Date().getUTCFullYear();
  if (!yearText && Date.UTC(year, month, day) < Date.now() - 150 * 864e5) year += 1;
  const time = String(tail || "").match(/^[^.\n]{0,22}?\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?\s*(E[SD]?T|C[SD]?T|M[SD]?T|P[SD]?T)?/i);
  if (time) return zonedIso(year, month, day, (Number(time[1]) % 12) + (/p/i.test(time[3]) ? 12 : 0), Number(time[2] || 0), time[4] || "ET");
  return kind === "end" ? zonedIso(year, month, day, 23, 59, "ET", 59) : zonedIso(year, month, day, 0, 0, "ET");
}
function dateFromText(text, kind) {
  const src = String(text || "");
  const D = `(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`;
  const W = "(?:entries|entry|registration|sign[- ]?ups?|raffle|giveaway|sweepstakes|contest|lottery|drawing|invites?|queue)";
  const tailOf = (m) => src.slice(m.index + m[0].length, m.index + m[0].length + 40);
  const range = src.match(new RegExp(`${W}\\b[^.\\n]{0,60}?${D}\\s*(?:-|–|—|to|through|thru|until)\\s*(?:(${MONTH_PATTERN})\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i"));
  if (range) {
    return kind === "end"
      ? whenAt(range[4] || range[1], range[5], range[6] || range[3], tailOf(range), "end")
      : whenAt(range[1], range[2], range[3], "", "start");
  }
  const cues = kind === "end"
    ? [`${W}\\b[^.\\n]{0,40}?\\b(?:clos(?:e|es|ed|ing)|end(?:s|ed|ing)?|expires?|deadline)\\b[^.\\n]{0,18}?${D}`,
       `\\b(?:enter|register|sign up|submit)\\b[^.\\n]{0,30}?\\b(?:by|until|through|before)\\b\\s*${D}`,
       `${D}\\s*(?:is the )?(?:entry )?(?:deadline|last day to enter)`]
    : [`${W}\\b[^.\\n]{0,40}?\\b(?:opens?|opened|starts?|started|begins?|began|goes live|went live|launch(?:es|ed)?)\\b[^.\\n]{0,18}?${D}`];
  for (const cue of cues) {
    const m = src.match(new RegExp(cue, "i"));
    if (m) return whenAt(m[1], m[2], m[3], tailOf(m), kind);
  }
  const legacy = dateFromTextLegacy(src, kind);
  if (kind === "end" && /T00:00:00\.000Z$/.test(legacy)) { const d = new Date(legacy); return zonedIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, "ET", 59); }
  return legacy;
}
function dayBoundary(iso, kind) {
  if (!/T00:00:00\.000Z$/.test(iso || "")) return iso;
  const d = new Date(iso);
  return kind === "end" ? zonedIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, "ET", 59) : zonedIso(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, "ET");
}
const PROMOTION_RE = /\b(raffle|giveaway|give aways|give away|sweepstakes|enter to win|contest|drawing|lottery|prize draw)\b/i;
const POKEMON_RE = /\b(pok[eé]mon)\b/i;
const TCG_PRODUCT_RE = /\b(tcg|trading cards?|pok[eé]mon cards?|booster (?:box|packs?)|elite trainer boxes?|\betb\b|promo cards?|collector(?:'s)? boxes?|pok[eé]mon (?:collection|tins?)|sealed (?:pokemon|tcg))\b/i;
const CRIME_RE = /\b(theft|stolen|stealing|stole|shoplifting|robbery|robbed|arrested|arrest|suspect|charged with|police investigate|fraud case|burglar)\b/i;
const MONEY_PRIZE_RE = /\b(gift cards?|gift certificates?|cash prize|cash|money|store credit|prepaid cards?|visa gift|mastercard gift|paypal credit)\b/i;
const PHYSICAL_PRIZE_RE = /\b(pok[eé]mon cards?|trading cards?|booster|elite trainer|etb|promo cards?|collector box|sealed product|mini tins?|collection box)\b/i;
function isTcgGiveawayText(value) {
  const text = String(value || "");
  if (CRIME_RE.test(text)) return false;
  return POKEMON_RE.test(text) && TCG_PRODUCT_RE.test(text) && PROMOTION_RE.test(text);
}
function isMoneyOnlyPrize(prize) {
  const value = String(prize || "");
  return MONEY_PRIZE_RE.test(value) && !PHYSICAL_PRIZE_RE.test(value);
}
function prizeHintFromText(value) {
  const text = String(value || "");
  const patterns = [
    /(?:grand prize|prize package|the prize|prizes include|winner receives|winner will receive|giveaway prize|prize is|prize:|win(?:s|ning)?\s+(?:a|an|the)?)\s*([^.!?]{4,180})/i,
    /(?:winner gets|winner takes home)\s+([^.!?]{4,180})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].replace(/\b(enter now|register now|sign up|submit entry|official rules|read more)\b.*$/i, "").trim();
  }
  if (MONEY_PRIZE_RE.test(text) && !PHYSICAL_PRIZE_RE.test(text)) return text.slice(0, 180);
  return "";
}
function imageAllowed(url, alt = "") {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const path = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    const description = String(alt || "").toLowerCase();
    if (/favicon|apple-touch-icon|site[-_]?logo|logo[-_]?|[-_/]logo(?:[-_.?/]|$)|icon|avatar|profile|sprite|brandmark|placeholder|default[-_]?image|social[-_]?icon|badge|author/i.test(path)) return false;
    if (/\b(site logo|company logo|brand logo|favicon|site icon|author photo|profile picture|avatar)\b/i.test(description)) return false;
    if (/\.(?:ico|svg)(?:$|\?)/i.test(path)) return false;
    if (/^(?:data|blob):/i.test(url)) return false;
    return true;
  } catch { return false; }
}
function imageUrlFrom(value, base) {
  if (Array.isArray(value)) {
    for (const item of value) { const candidate = imageUrlFrom(item, base); if (candidate) return candidate; }
    return "";
  }
  if (value && typeof value === "object") return imageUrlFrom(value.url || value.contentUrl || value.thumbnailUrl, base);
  const url = resolveUrl(value, base);
  return url && imageAllowed(url) ? url : "";
}
function uniqueImages(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.url || !imageAllowed(item.url, item.alt || "")) return false;
    const key = item.url.split(/[?#]/)[0].toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_IMAGES_PER_ITEM);
}
function extractItemImages(html, pageUrl, subjectText, mode = "post", event = null, product = null, allowProductOg = false) {
  const candidates = [];
  const subject = String(subjectText || "").toLowerCase();
  const hasPokemonSubject = POKEMON_RE.test(subject);
  const add = (raw, label, kind, alt = "") => {
    const url = resolveUrl(raw, pageUrl);
    if (!url || !imageAllowed(url, alt)) return;
    candidates.push({ url, label, kind, alt: String(alt || "").slice(0, 180) });
  };

  const productText = `${product?.name || ""} ${product?.description || ""}`;
  const productMatchesTcg = product && TCG_PRODUCT_RE.test(productText)
    && (POKEMON_RE.test(productText) || (hasPokemonSubject && TCG_PRODUCT_RE.test(subject)));
  if (productMatchesTcg) {
    const raw = product.image;
    const urls = Array.isArray(raw) ? raw : [raw];
    for (const image of urls) add(image?.url || image?.contentUrl || image, "PRODUCT IMAGE", "product", product.name || "Pokémon TCG product");
  }
  if (event && mode === "raffle") {
    const raw = event.image;
    const urls = Array.isArray(raw) ? raw : [raw];
    for (const image of urls) add(image?.url || image?.contentUrl || image, "GIVEAWAY IMAGE", "event", event.name || "Pokémon TCG giveaway");
  }

  for (const match of String(html || "").matchAll(/<img\b([^>]*)>/gi)) {
    const raw = match[1];
    const alt = attr(raw, "alt") || attr(raw, "title");
    const width = Number(attr(raw, "width"));
    const height = Number(attr(raw, "height"));
    if ((width && width < 96) || (height && height < 96)) continue;
    const before = String(html || "").slice(Math.max(0, match.index - 1400), match.index);
    const after = String(html || "").slice(match.index + match[0].length, Math.min(String(html || "").length, match.index + match[0].length + 700));
    const figureStart = before.lastIndexOf("<figure");
    const figureEnd = after.indexOf("</figure>");
    const figureContext = figureStart >= 0 && figureEnd >= 0
      ? `${before.slice(figureStart)} ${after.slice(0, figureEnd)}`
      : `${before.slice(-500)} ${after.slice(0, 250)}`;
    const elementContext = `${alt} ${attr(raw, "data-caption")} ${attr(raw, "aria-label")} ${attr(raw, "data-product-title")} ${attr(raw, "class")} ${stripMarkup(figureContext)}`;
    const url = attr(raw, "data-zoom-image") || attr(raw, "data-product-image") || attr(raw, "data-src") || attr(raw, "data-lazy-src") || attr(raw, "data-original") || attr(raw, "src");
    const srcset = attr(raw, "srcset");
    const largestSrc = srcset.split(",").map((part) => {
      const bits = part.trim().split(/\s+/);
      const descriptor = bits[1] || "";
      const size = Number.parseInt(descriptor, 10) || 0;
      return { url: bits[0], size };
    }).filter((part) => part.url).sort((a, b) => b.size - a.size)[0]?.url;
    const chosen = largestSrc || url;
    const hasPhysicalItemClue = /pok[eé]mon cards?|trading cards?|booster|elite trainer|\betb\b|promo cards?|collection box|mini tin|sealed product|starter deck|tcg product/i.test(elementContext);
    const titleOverlap = subject.split(/[^a-z0-9]+/).filter((word) => word.length > 4 && !["pokemon", "pokémon", "giveaway", "raffle", "trading", "cards"].includes(word)).some((word) => elementContext.toLowerCase().includes(word));
    const urlLooksLikeItem = /pokemon|pok[eé]mon|trading.card|booster|elite.trainer|\betb\b|promo.card|collection.box|mini.tin|starter.deck/i.test(chosen);
    const relevant = mode === "raffle" ? (hasPhysicalItemClue || urlLooksLikeItem) : (hasPhysicalItemClue || titleOverlap || urlLooksLikeItem);
    if (relevant) add(chosen, "ITEM IMAGE", "product", alt || stripMarkup(figureContext).slice(0, 140) || "Pokémon TCG item");
  }

  // An OG preview is a last-resort editorial thumbnail for regular alerts only. It is
  // never passed off as a raffle prize image and never uses favicon/icon metadata.
  if (mode === "post" && !candidates.length) {
    const ogAlt = metaValue(html, ["og:image:alt", "twitter:image:alt"]);
    const ogUrl = metaValue(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
    const ogWidth = Number(metaValue(html, ["og:image:width", "twitter:image:width"]) || 0);
    const ogHeight = Number(metaValue(html, ["og:image:height", "twitter:image:height"]) || 0);
    const largeEnough = (!ogWidth || ogWidth >= 200) && (!ogHeight || ogHeight >= 160);
    if (ogUrl && largeEnough && imageAllowed(resolveUrl(ogUrl, pageUrl), ogAlt)) {
      const fileLooksRelevant = /pokemon|pok[eé]mon|tcg|card|booster|etb|collection|tin|promo/i.test(ogUrl);
      if (fileLooksRelevant || (hasPokemonSubject && /pokemon|pok[eé]mon|tcg|card|booster|etb|collection|tin|promo/i.test(ogAlt))) {
        add(ogUrl, "ARTICLE IMAGE", "article", ogAlt || "Related Pokémon TCG article image");
      }
    }
  }
  // A confirmed retailer/product page can use its large OG image as the product photo
  // when the publisher omits schema.org Product.image and image alt text.
  if (mode === "post" && allowProductOg && !candidates.length) {
    const productPageTitle = `${titleTag(html)} ${metaValue(html, ["og:title", "og:description", "description"])}`;
    const ogUrl = metaValue(html, ["og:image", "og:image:url", "twitter:image", "twitter:image:src"]);
    const ogAlt = metaValue(html, ["og:image:alt", "twitter:image:alt"]) || productPageTitle;
    const ogWidth = Number(metaValue(html, ["og:image:width", "twitter:image:width"]) || 0);
    const ogHeight = Number(metaValue(html, ["og:image:height", "twitter:image:height"]) || 0);
    if (ogUrl && (!ogWidth || ogWidth >= 200) && (!ogHeight || ogHeight >= 160)
      && imageAllowed(resolveUrl(ogUrl, pageUrl), ogAlt)) {
      add(ogUrl, "PRODUCT IMAGE", "product", ogAlt);
    }
  }
  return uniqueImages(candidates);
}
function extractPageMetadata(html, pageUrl, raffle) {
  const nodes = jsonLdNodes(html);
  const allEvents = nodes.filter((node) => typeIncludes(node, "Event") || typeIncludes(node, "Contest"));
  const event = allEvents.find((node) => PROMOTION_RE.test(`${node.name || ""} ${node.description || ""} ${node.award || ""} ${node.prize || ""}`)) || null;
  const products = nodes.filter((node) => typeIncludes(node, "Product"));
  const product = products.find((node) => TCG_PRODUCT_RE.test(`${node.name || ""} ${node.description || ""}`)
    && (POKEMON_RE.test(`${node.name || ""} ${node.description || ""}`)
      || (POKEMON_RE.test(`${raffle?.title || ""} ${raffle?.summary || ""} ${titleTag(html)}`)
        && TCG_PRODUCT_RE.test(`${raffle?.title || ""} ${raffle?.summary || ""} ${titleTag(html)}`)))) || null;
  const website = nodes.find((node) => typeIncludes(node, "WebSite")) || {};
  const organization = nodes.find((node) => typeIncludes(node, "Organization")) || {};
  const publisher = nodes.find((node) => node?.publisher) || {};
  const text = pageText(html);
  const pageTitle = firstText(metaValue(html, ["og:title", "twitter:title"]), titleTag(html), event?.name, product?.name, nodes.find((node) => node.headline)?.headline);
  const pageDescription = firstText(metaValue(html, ["og:description", "description", "twitter:description"]), event?.description, product?.description, nodes.find((node) => node.description)?.description);
  let host = "";
  let origin = "";
  try { const parsed = new URL(pageUrl); host = parsed.hostname.replace(/^www\./, ""); origin = parsed.origin; } catch { /* keep empty */ }
  const siteName = firstText(metaValue(html, ["og:site_name", "application-name"]), website.name, organization.name, publisher.publisher?.name, host);

  const allowedStructuredDates = Boolean(event);
  const startDate = dayBoundary((allowedStructuredDates ? normalizeDate(event.startDate) : "") || dateFromText(text, "start"), "start");
  const endDate = dayBoundary((allowedStructuredDates ? normalizeDate(event.endDate || event.offers?.validThrough) : "") || dateFromText(text, "end"), "end");

  let prize = "";
  if (event && isTcgGiveawayText(`${event.name || ""} ${event.description || ""} ${event.award || ""} ${event.prize || ""} ${raffle?.title || ""}`)) {
    prize = firstText(event.award, event.prize);
  }
  if (!prize && product && isTcgGiveawayText(`${pageTitle} ${pageDescription} ${text} ${raffle?.title || ""} ${raffle?.summary || ""}`)) {
    prize = firstText(product.name);
  }
  if (!prize) {
    const prizePatterns = [
      /(?:grand prize|prize package|the prize|prizes include|winner receives|winner will receive|giveaway prize|prize is|prize:|win(?:s|ning)?\s+(?:a|an|the)?)\s*([^.!?]{5,180})/i,
      /(?:winner gets|winner takes home)\s+([^.!?]{5,180})/i
    ];
    for (const pattern of prizePatterns) {
      const match = text.match(pattern);
      if (match?.[1]) { prize = match[1].replace(/\b(enter now|register now|sign up|submit entry|official rules|read more)\b.*$/i, "").replace(/\s+/g, " ").trim().slice(0, 180); break; }
    }
  }

  const isGiveawayContext = isTcgGiveawayText(`${raffle?.title || ""} ${raffle?.summary || ""} ${pageTitle} ${pageDescription} ${text}`);
  const images = extractItemImages(html, pageUrl, `${raffle?.title || ""} ${raffle?.summary || ""} ${pageTitle}`, "raffle", event, product);
  const prizeImages = images.filter((image) => image.kind === "product");
  const prizeImage = prizeImages[0] || null;
  const prizeTextHint = prizeHintFromText(text);
  const extractedPrize = prize || prizeTextHint;
  return {
    pageTitle,
    pageDescription,
    siteName,
    siteUrl: origin,
    startDate,
    endDate,
    prize: extractedPrize.replace(/\s+/g, " ").trim().slice(0, 180),
    imageUrl: isGiveawayContext ? prizeImage?.url || "" : "",
    imageType: prizeImage ? "prize" : "",
    imageUrls: isGiveawayContext ? prizeImages : [],
    structuredEvent: Boolean(event),
    structuredProduct: Boolean(product),
    relevant: isGiveawayContext && !CRIME_RE.test(`${pageTitle} ${pageDescription} ${text}`),
    cashOnlyPrize: isMoneyOnlyPrize(prizeTextHint) || isMoneyOnlyPrize(prize)
  };
}
function dateStatus(startDate, endDate, text, publishedDate) {
  const now = Date.now();
  const start = Date.parse(startDate || "");
  const end = Date.parse(endDate || "");
  if (Number.isFinite(end) && end < now) return { status: "Closed", statusDate: endDate, statusNote: "The verified entry deadline has passed." };
  if (Number.isFinite(start) && start > now) return { status: "Upcoming", statusDate: startDate, statusNote: "Entries have a verified future opening date." };
  if (Number.isFinite(end) && end >= now) return { status: "Open", statusDate: endDate, statusNote: "The verified deadline is still in the future." };
  const body = String(text || "");
  if (/\b(entries? (?:are )?closed|no longer accepting entries|winners? (?:were )?(?:announced|selected|drawn)|giveaway ended|raffle ended|sweepstakes ended|deadline (?:has )?passed)\b/i.test(body)) {
    return { status: "Closed", statusDate: "", statusNote: "The page says entries have closed or winners were selected." };
  }
  if (/\b(enter now|entries? (?:are )?open|giveaway is live|raffle is live|registration is open|register now|enter to win now)\b/i.test(body)) {
    return { status: "Open", statusDate: "", statusNote: "The page indicates entries are open, but does not publish a verified deadline." };
  }
  // A publication date or a product-release date must never make a giveaway Upcoming.
  return { status: "Verify", statusDate: "", statusNote: "The giveaway is relevant, but its entry window could not be verified." };
}
async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; PokeDropRaffleRadar/5.0; +https://github.com/n0nam3-bot/PokeDrop)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/(text\/html|application\/xhtml\+xml)/i.test(contentType)) throw new Error(`Not an HTML page (${contentType})`);
  return { html: (await response.text()).slice(0, 3000000), url: response.url || url };
}
function significantWords(value) {
  const ignored = new Set([
    "pokemon", "pokémon", "trading", "cards", "card", "tcg", "giveaway", "raffle", "contest",
    "sweepstakes", "restock", "restocks", "back", "stock", "deal", "deals", "sale", "sales",
    "release", "released", "new", "latest", "available", "today", "this", "that", "with", "from",
    "into", "your", "their", "the", "and", "for", "are", "was", "how", "what", "where", "when",
    "opens", "open", "soon", "enter", "entry", "entries", "starts", "start", "starting", "begins", "closes", "close",
    "ends", "ending", "before", "after", "winner", "winners", "live", "here", "know", "need", "guide", "announced",
    "announces", "reveals", "revealed", "details", "limited", "online", "store", "stores", "worked", "works"
  ]);
  return [...new Set(String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).filter((word) => word.length >= 4 && !ignored.has(word) && !/^20\d\d$/.test(word)))];
}
function unwrapSearchResultUrl(raw, baseUrl) {
  const resolved = resolveUrl(raw, baseUrl);
  if (!resolved) return "";
  try {
    const parsed = new URL(resolved);
    if (/duckduckgo\.com$/i.test(parsed.hostname)) {
      const wrapped = parsed.searchParams.get("uddg") || parsed.searchParams.get("url");
      if (wrapped) return resolveUrl(wrapped, baseUrl);
    }
    if (/bing\.com$/i.test(parsed.hostname)) {
      const wrapped = parsed.searchParams.get("u");
      if (wrapped?.startsWith("a1")) {
        const decoded = Buffer.from(wrapped.slice(2), "base64").toString("utf8");
        if (/^https?:\/\//i.test(decoded)) return decoded;
      }
    }
    return resolved;
  } catch { return resolved; }
}
function searchResultLinks(html, baseUrl) {
  const source = String(html || "");
  const blocks = [];
  for (const match of source.matchAll(/<li\b([^>]*)>[\s\S]*?<\/li>/gi)) {
    if (/\bb_algo\b/i.test(attr(match[1], "class"))) blocks.push(match[0]);
  }
  for (const match of source.matchAll(/<div\b([^>]*)>[\s\S]*?<\/div>/gi)) {
    if (/\bresult__body\b|\bresults_links_deep\b/i.test(attr(match[1], "class"))) blocks.push(match[0]);
  }
  const results = [];
  const seen = new Set();
  const candidates = blocks.length
    ? blocks
    : [...source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
        .filter((match) => /result__a|result-link|result__title/i.test(attr(match[1], "class")))
        .map((match) => match[0]);
  for (const block of candidates) {
    const anchor = block.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const attrs = anchor[1];
    const classes = attr(attrs, "class");
    if (blocks.length && !/b_algo|result__a|result-link|result__title/i.test(`${classes} ${block.slice(0, 260)}`)) continue;
    const url = unwrapSearchResultUrl(attr(attrs, "href"), baseUrl);
    if (!url) continue;
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (/^(?:bing\.com|duckduckgo\.com|google\.[a-z.]+|news\.google\.com|microsoft\.com)$/i.test(host)) continue;
    if (/youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|linkedin\.com|pinterest\.com/i.test(host)) continue;
    const title = stripMarkup(anchor[2]);
    const snippet = stripMarkup(block).slice(0, 900);
    const key = url.split(/[?#]/)[0].toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    results.push({ url, title, snippet });
  }
  return results;
}
async function searchWebResults(query, limit = 8) {
  const engines = [
    { name: "Bing", url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-US&cc=us` },
    { name: "DuckDuckGo", url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` }
  ];
  for (const engine of engines) {
    try {
      SEARCH_STATS.requests += 1;
      SEARCH_STATS[engine.name === "Bing" ? "bingRequests" : "duckDuckGoRequests"] += 1;
      const response = await fetch(engine.url, {
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36 PokeDrop/6.0",
          accept: "text/html,application/xhtml+xml"
        },
        signal: AbortSignal.timeout(9000)
      });
      if (!response.ok) {
        SEARCH_STATS.errors += 1;
        continue;
      }
      const html = (await response.text()).slice(0, 1800000);
      const results = searchResultLinks(html, response.url || engine.url);
      SEARCH_STATS.resultLinks += results.length;
      if (results.length) {
        SEARCH_STATS.successfulQueries += 1;
        return results.slice(0, limit);
      }
    } catch (error) {
      SEARCH_STATS.errors += 1;
      console.warn(`Search provider ${engine.name} unavailable: ${error?.message || error}`);
    }
  }
  return [];
}
const SOURCE_DOMAINS = {
  "pokebeach": "pokebeach.com", "pokeguardian": "pokeguardian.com", "pokecollector": "pokecollector.com",
  "mashable": "mashable.com", "sheknows": "sheknows.com", "screenrant": "screenrant.com",
  "gamerant": "gamerant.com", "yahoo": "yahoo.com", "ign": "ign.com", "kotaku": "kotaku.com",
  "dexerto": "dexerto.com", "essentialjapan": "essential-japan.com", "comicbookresources": "comicbook.com",
  "polygon": "polygon.com", "cnet": "cnet.com", "toms guide": "tomsguide.com", "wargamer": "wargamer.com"
};
function publisherHostFor(item) {
  try {
    const host = new URL(item?.publisherUrl || "").hostname.toLowerCase().replace(/^www\./, "");
    if (host && !isGoogleHost(host)) return host;
  } catch { /* use publisher-name map */ }
  const source = String(item?.source || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  for (const [name, host] of Object.entries(SOURCE_DOMAINS)) if (source.includes(name)) return host;
  return "";
}
function titleMatchCount(title, candidateText) {
  const wanted = significantWords(title);
  const haystack = String(candidateText || "").toLowerCase();
  return wanted.filter((word) => haystack.includes(word)).length;
}
async function searchPublisherArticle(item) {
  const title = String(item?.title || "").trim();
  if (!title) return null;
  const publisherHost = publisherHostFor(item);
  const queries = publisherHost
    ? [`site:${publisherHost} "${title}"`, `"${title}" ${String(item.source || "")}`]
    : [`"${title}" ${String(item.source || "")} Pokemon TCG article`, `"${title}" Pokemon TCG`];
  for (const query of queries) {
    const results = await searchWebResults(query, 8);
    const ranked = results.map((result) => {
      let host = "";
      try { host = new URL(result.url).hostname.toLowerCase().replace(/^www\./, ""); } catch { /* no-op */ }
      const domainMatch = !publisherHost || host === publisherHost || host.endsWith(`.${publisherHost}`);
      return { ...result, host, domainMatch, score: titleMatchCount(title, `${result.title} ${result.snippet} ${result.url}`) + (domainMatch ? 5 : -5) };
    }).filter((result) => result.domainMatch && result.score >= 7 && new URL(result.url).pathname !== "/")
      .sort((a, b) => b.score - a.score);
    for (const result of ranked.slice(0, 3)) {
      try {
        const page = await fetchHtml(result.url);
        if (isGoogleHost(new URL(page.url).hostname)) continue;
        const text = `${titleTag(page.html)} ${metaValue(page.html, ["og:title", "og:description", "description"]) } ${pageText(page.html)}`;
        if (titleMatchCount(title, text) < 2) continue;
        return page;
      } catch { /* try the next search result */ }
    }
  }
  return null;
}
function isPokemonTcgProductAlert(post) {
  const text = `${post?.title || ""} ${post?.summary || ""} ${post?.source || ""}`;
  if (!POKEMON_RE.test(text) || !TCG_PRODUCT_RE.test(text) || CRIME_RE.test(text)) return false;
  // Exclude mixed-category roundup headlines unless the alert itself names a Pokémon TCG product.
  if (/magic the gathering|yu-gi-oh|lego|playstation|xbox|nintendo switch|one piece card game/i.test(text)
    && !/pokemon (?:tcg )?(?:cards?|booster|elite trainer|collection|promo)|pok[eé]mon trading cards/i.test(text)) return false;
  return true;
}
function retailerSearchLinksFor(post, preferred = "Other") {
  if (!isPokemonTcgProductAlert(post)) return [];
  const itemTerms = productWords(post).slice(0, 7).join(" ");
  const query = ["Pokemon TCG", itemTerms].filter(Boolean).join(" ");
  const named = preferred && preferred !== "Other" ? [preferred] : [];
  const stores = [...new Set([...named, "TCGplayer", "Amazon", "Target"])].slice(0, 3);
  return stores.map((retailer) => ({ retailer, url: productSearchUrl(retailer, query) }))
    .filter((item) => /^https?:\/\//i.test(item.url));
}
async function searchGiveawayEntryPage(raffle) {
  const title = String(raffle?.title || "").trim();
  if (!title) return null;
  const queries = [
    `"${title}" Pokemon TCG giveaway enter`,
    `"${title}" (Gleam OR SweepWidget OR Rafflecopter OR Raffall) Pokemon cards`
  ];
  for (const query of queries) {
    const results = await searchWebResults(query, 8);
    for (const result of results.slice(0, MAX_SEARCH_RESULT_CHECKS)) {
      try {
        const page = await fetchHtml(result.url);
        if (!entryPageValid(page.url, page.html, raffle)) continue;
        return { page, label: result.title || "Verified giveaway entry page" };
      } catch { /* unverified destination */ }
    }
  }
  return null;
}

function findPublisherArticleInGooglePage(html, googleUrl, publisherUrl, articleTitle = "") {
  let publisherHost = "";
  try { publisherHost = new URL(publisherUrl).hostname.toLowerCase().replace(/^www\./, ""); } catch { /* title matching can still resolve the article */ }
  const canonical = canonicalUrl(html, googleUrl);
  try {
    const parsed = new URL(canonical);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (!isGoogleHost(host) && (!publisherHost || host === publisherHost || host.endsWith(`.${publisherHost}`))
      && parsed.pathname !== "/") return canonical;
  } catch { /* keep searching anchors */ }

  const wanted = significantWords(articleTitle);
  const candidates = [];
  for (const [, attributes, inner] of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = resolveUrl(attr(attributes, "href") || attr(attributes, "data-href"), googleUrl);
    if (!href) continue;
    try {
      const parsed = new URL(href);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
      if (isGoogleHost(host) || /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com)$/i.test(host)) continue;
      if (parsed.pathname === "/" || /\/(?:search|author|category|tag|feed|privacy|terms)(?:\/|$)/i.test(parsed.pathname)) continue;
      if (publisherHost && host !== publisherHost && !host.endsWith(`.${publisherHost}`)) continue;
      const anchorText = stripMarkup(inner) || attr(attributes, "aria-label") || attr(attributes, "title");
      const combined = `${anchorText} ${attr(attributes, "title")} ${parsed.pathname}`;
      const matches = wanted.filter((word) => combined.toLowerCase().includes(word));
      const score = (publisherHost ? 4 : 0) + matches.length * 3 + (anchorText.length > 20 ? 1 : 0) + (parsed.pathname.split("/").filter(Boolean).length > 1 ? 1 : 0);
      if ((!publisherHost && (matches.length < 2 || score < 7)) || (publisherHost && matches.length === 0 && !anchorText)) continue;
      candidates.push({ url: parsed.href, score });
    } catch { /* ignore non-http and malformed links */ }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.url || "";
}
async function fetchPublisherArticle(item) {
  const sourceUrl = String(item.sourceUrl || item.url || "").trim();
  const publisherUrl = String(item.publisherUrl || "").trim();
  let lastError = "No source article URL was available.";
  if (/^https?:\/\//i.test(sourceUrl)) {
    try {
      const page = await fetchHtml(sourceUrl);
      if (!isGoogleHost(new URL(page.url).hostname)) {
        const path = new URL(page.url).pathname;
        if (path !== "/") return page;
      } else {
        const articleUrl = findPublisherArticleInGooglePage(page.html, page.url, publisherUrl, item.title);
        if (articleUrl) {
          const article = await fetchHtml(articleUrl);
          if (!isGoogleHost(new URL(article.url).hostname) && new URL(article.url).pathname !== "/") return article;
        }
      }
    } catch (error) { lastError = error?.message || String(error); }
  }
  // Search by the exact headline and publisher host. The RSS <source url> is only a
  // homepage, not an article permalink, so it must never be treated as the article itself.
  const searched = await searchPublisherArticle(item);
  if (searched) return searched;
  if (/^https?:\/\//i.test(publisherUrl)) {
    try {
      const parsed = new URL(publisherUrl);
      if (parsed.pathname !== "/") {
        const page = await fetchHtml(publisherUrl);
        if (new URL(page.url).pathname !== "/") return page;
      }
    } catch (error) { lastError = error?.message || String(error); }
  }
  throw new Error(`Publisher article could not be resolved from RSS redirect or exact-title search (${lastError}).`);
}
function entryCandidates(html, pageUrl, raffle) {
  const source = String(html || "");
  const bodyText = pageText(source);
  const articleContext = `${raffle?.title || ""} ${raffle?.summary || ""} ${titleTag(source)} ${metaValue(source, ["og:description", "description"])} ${bodyText}`;
  if (!isTcgGiveawayText(articleContext)) return [];
  const pageHost = new URL(pageUrl).hostname.toLowerCase();
  const candidates = [];
  const add = (raw, label, context, kind = "anchor") => {
    const url = resolveUrl(raw, pageUrl);
    if (!url) return;
    let parsed;
    try { parsed = new URL(url); } catch { return; }
    if (isGoogleHost(parsed.hostname)) return;
    if (parsed.hostname.toLowerCase() === pageHost && parsed.pathname === new URL(pageUrl).pathname) return;
    const platform = isEntryPlatform(parsed.hostname);
    const combined = `${label || ""} ${context || ""} ${parsed.pathname}`.toLowerCase();
    const action = /\b(enter(?: now| here| to win)?|submit (?:your )?entr(?:y|ies)|register(?: now)?|join (?:the )?(?:giveaway|raffle|contest)|participate|sign up|entry form|apply now|click (?:here|to enter)|giveaway entry)\b/.test(String(label || "").toLowerCase());
    const contestPath = /raffle|giveaway|sweepstakes|contest|lottery|(?:^|\/)(?:entry|enter)(?:\/|$)|enter-to-win/i.test(combined);
    const rulesOnly = /official rules|terms and conditions|privacy policy|learn more about/i.test(String(label || "")) && !action;
    const pathLooksLikeArticle = /\/(?:news|article|articles|blog|press-release|stories)\//i.test(parsed.pathname);
    const samePage = parsed.hostname.toLowerCase() === pageHost && parsed.pathname === new URL(pageUrl).pathname;
    const validCandidate = !samePage && !rulesOnly && !pathLooksLikeArticle
      && ((platform && /giveaway|raffle|contest|entry|sweepstakes/i.test(`${label} ${context}`))
        || (action && /pokemon|pok[eé]mon|tcg|trading cards?/i.test(context))
        || (contestPath && /pokemon|pok[eé]mon|tcg|trading cards?/i.test(context))
        || ((kind === "iframe" || kind === "form") && /pokemon|pok[eé]mon|tcg|trading cards?/i.test(context)));
    if (validCandidate) candidates.push({ url: parsed.href, label: String(label || (platform ? "Giveaway platform" : "Entry link")).slice(0, 100), score: (platform ? 9 : 0) + (action ? 8 : 0) + (contestPath ? 5 : 0) + (kind === "iframe" ? 2 : 0) + (kind === "form" ? 3 : 0) });
  };
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1];
    const label = stripMarkup(match[2]) || attr(attrs, "aria-label") || attr(attrs, "title");
    const context = stripMarkup(source.slice(Math.max(0, match.index - 400), Math.min(source.length, match.index + match[0].length + 400)));
    add(attr(attrs, "href") || attr(attrs, "data-href") || attr(attrs, "data-url") || attr(attrs, "data-link"), label, context);
    const onclick = attr(attrs, "onclick");
    const jsUrl = onclick.match(/(?:location\.href|window\.open|href)\s*[:=(]\s*["']([^"']+)["']/i)?.[1];
    if (jsUrl) add(jsUrl, label, context);
  }
  for (const match of source.matchAll(/<iframe\b([^>]*)>/gi)) {
    const attrs = match[1];
    add(attr(attrs, "src") || attr(attrs, "data-src"), attr(attrs, "title") || "Embedded entry form", bodyText, "iframe");
  }
  for (const match of source.matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = match[1];
    add(attr(attrs, "action"), "Entry form", bodyText, "form");
  }
  // Entry platform URLs are frequently embedded in widget configuration rather than anchors.
  for (const match of source.matchAll(/https?:\\?\/\\?\/[^\s"'<>\\]+/gi)) {
    const raw = match[0].replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/[),;]+$/, "");
    if (/gleam\.io|sweepwidget\.com|rafflecopter\.com|raffall\.com|viralsweep\.com|viral-sweep\.com|woobox\.com|easypromosapp\.com|shortstack\.com|promosimple\.com/i.test(raw)) {
      add(raw, "Embedded giveaway platform", bodyText, "script");
    }
  }
  return candidates.sort((a, b) => b.score - a.score).filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index);
}
function entryPageValid(url, html, raffle) {
  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();
  const body = pageText(html);
  const headings = `${titleTag(html)} ${metaValue(html, ["og:title", "og:description", "description", "twitter:title", "twitter:description"] )}`;
  const visibleDetails = `${headings} ${body}`;
  if (body.length < 70 || CRIME_RE.test(visibleDetails)) return false;

  const raffleContext = `${raffle?.title || ""} ${raffle?.summary || ""} ${raffle?.prize || ""}`;
  const combined = `${visibleDetails} ${raffleContext}`;
  if (!isTcgGiveawayText(combined)) return false;
  const destinationHasTcgIdentity = isTcgGiveawayText(visibleDetails);
  const titleTokens = significantWords(raffle?.title || "").filter((word) => !["giveaway", "raffle", "contest", "pokemon", "pokémon", "trading", "cards", "tcg"].includes(word));
  const destinationMatchesTitle = titleTokens.filter((word) => visibleDetails.toLowerCase().includes(word)).length;
  const destinationHasEntryLanguage = PROMOTION_RE.test(visibleDetails)
    && /\b(enter|entry|submit|register|join|participate|winner|prize)\b/i.test(visibleDetails);
  // A generic form or an unrelated Gleam page is not an entry destination. The destination
  // itself must identify Pokémon TCG, or independently identify the named giveaway/prize.
  if (!destinationHasTcgIdentity && !(destinationHasEntryLanguage && destinationMatchesTitle >= 2)) return false;
  const prizeHint = prizeHintFromText(`${visibleDetails} ${raffle?.prize || ""}`);
  if (isMoneyOnlyPrize(raffle?.prize) || isMoneyOnlyPrize(prizeHint)) return false;

  const forms = [...String(html || "").matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
  const hasVerifiedEntryForm = forms.some(([, attributes, content]) => {
    const formText = `${attr(attributes, "action")} ${stripMarkup(content)}`;
    const hasEntryWords = /\b(enter|entry|submit|giveaway|raffle|sweepstakes|contest|participate|register|join)\b/i.test(formText);
    const hasControl = /<(?:input|button|select)\b|type\s*=\s*["']?submit/i.test(content);
    return hasEntryWords && hasControl;
  });
  const visibleEntryAction = /\b(enter now|enter here|enter to win|submit entry|register now|join giveaway|giveaway is live|raffle is live|start entry|complete (?:your )?entry|entries? (?:are )?open)\b/i.test(visibleDetails);
  const platformHasEntryAction = isEntryPlatform(host) && visibleEntryAction;
  // Do not accept a platform URL simply because its host is Gleam/SweepWidget/etc.
  return hasVerifiedEntryForm || platformHasEntryAction;
}
function storeFromText(text, fallback) {
  const haystack = String(text || "");
  const patterns = [
    ["Pokémon Center", /pok[eé]mon\s*center|pokemon\.com/i], ["Target", /\btarget\b/i],
    ["Walmart", /\bwalmart\b/i], ["Costco", /\bcostco\b/i], ["GameStop", /game\s*stop/i],
    ["Best Buy", /best\s*buy/i], ["Amazon", /\bamazon\b/i], ["Sam's Club", /sam'?s\s*club/i],
    ["TCGplayer", /tcgplayer/i], ["Local Card Shop", /card\s*shop|game\s*store|\bLGS\b/i]
  ];
  return patterns.find(([, regex]) => regex.test(haystack))?.[0] || fallback || "Other";
}
function inferStatus(startDate, endDate, bodyText, hasVerifiedEntry = false) {
  const now = Date.now();
  const start = Date.parse(startDate || "");
  const end = Date.parse(endDate || "");
  const body = String(bodyText || "");
  const explicitlyClosed = /\b(entries? (?:are )?closed|no longer accepting entries|winners? (?:were )?(?:announced|selected|drawn)|giveaway ended|raffle ended|sweepstakes ended|deadline (?:has )?passed)\b/i.test(body);
  const explicitlyOpen = /\b(enter now|entries? (?:are )?open|giveaway is live|raffle is live|registration is open|register now|enter to win now)\b/i.test(body);

  // The verified entry deadline is authoritative. A product release or article publish
  // date is never passed into this function as an entry-window date.
  if (Number.isFinite(end) && end < now) return { status: "Closed", statusDate: endDate, statusNote: "The verified entry deadline has passed." };
  if (explicitlyClosed) return { status: "Closed", statusDate: Number.isFinite(end) ? endDate : "", statusNote: "The page says entries have closed or winners were selected." };
  if (Number.isFinite(start) && start > now) return { status: "Upcoming", statusDate: startDate, statusNote: "Entries have a verified future opening date." };
  if (Number.isFinite(end) && end >= now) return { status: "Open", statusDate: endDate, statusNote: "The verified deadline has not passed. Entries should be open unless the official page says otherwise." };
  // Once a verified entry-opening date has passed, the draw is treated as Open until
  // an explicit close notice or a verified past deadline is found.
  if (Number.isFinite(start) && start <= now) return { status: "Open", statusDate: "", statusNote: "The verified entry start date has passed; no closing date was published, so the giveaway is treated as ongoing until the page says otherwise." };
  if (explicitlyOpen && hasVerifiedEntry) return { status: "Open", statusDate: "", statusNote: "The verified entry page indicates entries are open, but does not provide a deadline." };
  if (explicitlyOpen) return { status: "Verify", statusDate: "", statusNote: "The announcement says to enter, but no working entry destination was verified." };
  return { status: "Verify", statusDate: "", statusNote: "The giveaway is relevant, but its entry window could not be verified." };
}
async function resolveRaffle(raffle) {
  let page = null;
  let pageError = "";
  try { page = await fetchPublisherArticle(raffle); }
  catch (error) { pageError = error?.message || String(error); }

  let pageCanonical = "";
  let sourceText = "";
  let metadata = {};
  let entryUrl = "";
  let entryLinkLabel = "";
  if (page) {
    pageCanonical = canonicalUrl(page.html, page.url);
    sourceText = pageText(page.html);
    metadata = extractPageMetadata(page.html, pageCanonical, raffle);
    const combined = `${raffle.title || ""} ${raffle.summary || ""} ${metadata.pageTitle} ${metadata.pageDescription} ${sourceText}`;
    const relevant = isTcgGiveawayText(combined) && !CRIME_RE.test(combined) && !metadata.cashOnlyPrize;
    if (!relevant) return { relevant: false, sourceUrl: pageCanonical, metadata, bodyText: sourceText };

    if (entryPageValid(page.url, page.html, raffle) || entryPageValid(pageCanonical, page.html, raffle)) {
      entryUrl = page.url;
      entryLinkLabel = "Verified Pokémon TCG entry page";
    } else {
      const candidates = entryCandidates(page.html, page.url, raffle).slice(0, 5);
      for (const candidate of candidates) {
        try {
          const entryPage = await fetchHtml(candidate.url);
          if (!entryPageValid(entryPage.url, entryPage.html, raffle)) continue;
          entryUrl = entryPage.url;
          entryLinkLabel = candidate.label || "Verified giveaway entry";
          const entryMetadata = extractPageMetadata(entryPage.html, entryPage.url, raffle);
          for (const field of ["prize", "startDate", "endDate", "imageUrl", "imageType", "imageUrls"]) {
            if (entryMetadata[field]) metadata[field] = entryMetadata[field];
          }
          break;
        } catch { /* Failed or non-HTML destinations are not advertised as entry pages. */ }
      }
    }
  } else {
    // The Google News article redirect may not expose a publisher permalink. Search for
    // the exact giveaway and validate the destination itself before accepting it.
    const searchedEntry = await searchGiveawayEntryPage(raffle);
    if (searchedEntry) {
      page = searchedEntry.page;
      pageCanonical = canonicalUrl(page.html, page.url);
      sourceText = pageText(page.html);
      metadata = extractPageMetadata(page.html, pageCanonical, raffle);
      entryUrl = page.url;
      entryLinkLabel = "Verified Pokémon TCG entry page";
    } else {
      return {
        relevant: true,
        sourceUrl: String(raffle.sourceUrl || raffle.url || ""),
        entryUrl: "",
        entryLinkLabel: "",
        entrySearchUrl: `https://www.google.com/search?q=${encodeURIComponent(`"${raffle.title}" Pokémon TCG giveaway entry`)}`,
        metadata: { siteName: raffle.source || "Original publisher", siteUrl: raffle.publisherUrl || "" },
        inferredStatus: { status: "Verify", statusDate: "", statusNote: "No publisher or entry page could be verified. Search the exact giveaway title before entering." },
        bodyText: "",
        pageError
      };
    }
  }

  const status = inferStatus(metadata.startDate, metadata.endDate, sourceText, Boolean(entryUrl));
  const host = (() => { try { return new URL(pageCanonical).hostname.replace(/^www\./, ""); } catch { return ""; } })();
  return {
    relevant: true,
    sourceUrl: pageCanonical || String(raffle.sourceUrl || raffle.url || ""),
    entryUrl,
    entryLinkLabel,
    entrySearchUrl: entryUrl ? "" : `https://www.google.com/search?q=${encodeURIComponent(`"${raffle.title}" Pokémon TCG giveaway entry`)}`,
    metadata: { ...metadata, siteName: metadata.siteName || raffle.siteName || host || raffle.source || "Original publisher", siteUrl: metadata.siteUrl || (() => { try { return new URL(pageCanonical).origin; } catch { return raffle.publisherUrl || ""; } })() },
    inferredStatus: status,
    bodyText: sourceText
  };
}
const RETAILER_HOSTS = [
  ["Pokémon Center", /(^|\.)pokemoncenter\.com$/i],
  ["Target", /(^|\.)target\.com$/i],
  ["Walmart", /(^|\.)walmart\.com$/i],
  ["Amazon", /(^|\.)amazon\.com$/i],
  ["Best Buy", /(^|\.)bestbuy\.com$/i],
  ["GameStop", /(^|\.)gamestop\.com$/i],
  ["Costco", /(^|\.)costco\.com$/i],
  ["TCGplayer", /(^|\.)tcgplayer\.com$/i],
  ["Barnes & Noble", /(^|\.)barnesandnoble\.com$/i],
  ["Meijer", /(^|\.)meijer\.com$/i],
  ["Five Below", /(^|\.)fivebelow\.com$/i],
  ["Hot Topic", /(^|\.)hottopic\.com$/i],
  ["Fanatics", /(^|\.)fanatics\.com$/i],
  ["Dave & Adam's Card World", /(^|\.)dacardworld\.com$/i],
  ["Steel City Collectibles", /(^|\.)steelcitycollectibles\.com$/i],
  ["Game Nerdz", /(^|\.)gamenerdz\.com$/i],
  ["Forge and Fire Gaming", /(^|\.)forgeandfiregaming\.com$/i]
];
function retailerForUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return RETAILER_HOSTS.find(([, pattern]) => pattern.test(host))?.[0] || "";
  } catch { return ""; }
}
function isRetailerRedirectHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    return /(^|\.)(amzn\.to|bit\.ly|t\.co|linksynergy\.com|awin1\.com|impact\.com|go\.skimresources\.com|redirect\.viglink\.com|sovrn\.co|shop-links\.co|rstyle\.me|shareasale\.com|clickbank\.net)$/i.test(host);
  } catch { return false; }
}
function retailerProductPath(retailer, pathname) {
  const path = String(pathname || "").toLowerCase();
  if (retailer === "Amazon") return /\/(?:dp|gp\/product)\/[a-z0-9]{8,}/i.test(path);
  if (retailer === "Target") return /\/p\//i.test(path);
  if (retailer === "Walmart") return /\/ip\//i.test(path);
  if (retailer === "Best Buy") return /\/site\/[^/]+\/\d{5,}\.p/i.test(path) || /\/site\/[^/]+\/\d{5,}/i.test(path);
  if (retailer === "GameStop") return /\/product\//i.test(path);
  if (retailer === "Pokémon Center") return /\/product\//i.test(path);
  if (retailer === "Costco") return /\/(?:p|product)\//i.test(path);
  if (retailer === "TCGplayer") return /\/product\//i.test(path);
  return /\/(?:product|products|item|p)\//i.test(path);
}
function productSearchUrl(retailer, query) {
  const q = encodeURIComponent(String(query || "").replace(/\b(restock|restocks|back in stock|available now|deal|deals|price drop|discount|sale|release|revealed|announced)\b/ig, " ").replace(/\s+/g, " ").trim());
  if (!q) return "";
  const paths = {
    "Pokémon Center": `https://www.pokemoncenter.com/search?q=${q}`,
    "Amazon": `https://www.amazon.com/s?k=${q}`,
    "Target": `https://www.target.com/s?searchTerm=${q}`,
    "Walmart": `https://www.walmart.com/search?q=${q}`,
    "Best Buy": `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`,
    "GameStop": `https://www.gamestop.com/search/?q=${q}`,
    "Costco": `https://www.costco.com/CatalogSearch?keyword=${q}`,
    "TCGplayer": `https://www.tcgplayer.com/search/pokemon/product?q=${q}`
  };
  return paths[retailer] || "";
}
function productWords(post) {
  const ignored = new Set([
    "pokemon", "pokémon", "trading", "cards", "card", "tcg", "booster", "packs", "pack", "elite", "trainer", "box", "collection", "promo", "promos", "restock", "restocks", "back", "stock", "available", "deal", "deals", "sale", "price", "drop", "rare", "new", "release", "releases", "revealed", "announced", "preorder", "preorders", "best", "latest", "store", "retailer", "amazon", "target", "walmart", "costco", "gamestop", "buy", "shop", "check", "live", "updates", "update", "where", "find", "get", "today", "november", "december", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october"
  ]);
  return significantWords(`${post?.title || ""} ${post?.summary || ""}`).filter((word) => !ignored.has(word));
}
function extractOffer(product) {
  const offers = Array.isArray(product?.offers) ? product.offers[0] : product?.offers;
  if (!offers || typeof offers !== "object") return { price: "", availability: "" };
  const price = offers.price ?? offers.lowPrice ?? offers.highPrice ?? "";
  const currency = offers.priceCurrency || "USD";
  const availability = String(offers.availability || "").split(/[\/#]/).pop().replace(/([A-Z])/g, " $1").trim();
  return {
    price: price !== "" ? `${currency === "USD" ? "$" : `${currency} `}${price}` : "",
    availability
  };
}
function productPageCandidates(html, pageUrl, post) {
  const candidates = [];
  const seen = new Set();
  const wanted = productWords(post);
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1];
    const rawHref = attr(attributes, "href") || attr(attributes, "data-href") || attr(attributes, "data-url") || attr(attributes, "data-link");
    const href = resolveUrl(rawHref, pageUrl);
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href); } catch { continue; }
    if (isGoogleHost(parsed.hostname)) continue;
    const retailer = retailerForUrl(href);
    const redirectLink = isRetailerRedirectHost(href);
    if ((!retailer || !retailerProductPath(retailer, parsed.pathname)) && !redirectLink) continue;
    const label = stripMarkup(match[2]) || attr(attributes, "aria-label") || attr(attributes, "title");
    const nearby = stripMarkup(String(html).slice(Math.max(0, match.index - 700), Math.min(String(html).length, match.index + match[0].length + 700)));
    const context = `${label} ${nearby} ${parsed.pathname}`.toLowerCase();
    const action = /\b(shop now|buy now|view product|product details|check price|pre-?order|available at|add to cart|see product)\b/i.test(label);
    const matchedWords = wanted.filter((word) => context.includes(word));
    const hasPokemon = /pok[eé]mon/i.test(context);
    const hasTcgProduct = TCG_PRODUCT_RE.test(context);
    if (!hasPokemon || !hasTcgProduct || matchedWords.length < Math.min(2, Math.max(1, wanted.length))) continue;
    if (redirectLink && !action) continue;
    const key = parsed.href.split(/[?#]/)[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ url: parsed.href, retailer: retailer || "Redirect", label: label.slice(0, 100), score: matchedWords.length * 3 + (action ? 5 : 0) + 4 });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 5);
}
function validateProductPage(productPage, canonical, post) {
  const retailer = retailerForUrl(canonical);
  if (!retailer || !retailerProductPath(retailer, new URL(canonical).pathname)) return null;
  const nodes = jsonLdNodes(productPage.html);
  const products = nodes.filter((node) => typeIncludes(node, "Product"));
  const subject = `${post?.title || ""} ${post?.summary || ""}`;
  const itemWords = productWords(post);
  const detailsText = `${titleTag(productPage.html)} ${metaValue(productPage.html, ["og:title", "og:description", "description", "twitter:title"])} ${pageText(productPage.html)}`;
  const product = products.find((node) => {
    const productText = `${node.name || ""} ${node.description || ""}`;
    return /pok[eé]mon/i.test(productText) && TCG_PRODUCT_RE.test(productText)
      && itemWords.filter((word) => productText.toLowerCase().includes(word)).length >= Math.min(2, Math.max(1, itemWords.length));
  }) || products.find((node) => /pok[eé]mon/i.test(`${node.name || ""} ${node.description || ""}`) && TCG_PRODUCT_RE.test(`${node.name || ""} ${node.description || ""}`)) || null;
  const identityText = `${firstText(product?.name, metaValue(productPage.html, ["og:title"]), titleTag(productPage.html))} ${product?.description || ""}`;
  const combined = `${detailsText} ${identityText}`;
  if (!/pok[eé]mon/i.test(identityText) || !TCG_PRODUCT_RE.test(identityText)) return null;
  const matched = itemWords.filter((word) => identityText.toLowerCase().includes(word));
  if (itemWords.length >= 2 && matched.length < Math.min(2, itemWords.length)) return null;

  const hasPurchaseSignal = Boolean(product?.offers)
    || /\b(add to cart|add to bag|buy now|pre-?order|sold out|out of stock|notify me|check availability|choose options|available online)\b/i.test(detailsText);
  if (!product && !hasPurchaseSignal) return null;
  const offer = extractOffer(product);
  const images = extractItemImages(productPage.html, canonical, `${subject} ${combined}`, "post", null, product, true);
  return {
    url: canonical,
    retailer,
    name: firstText(product?.name, titleTag(productPage.html), metaValue(productPage.html, ["og:title"])),
    price: offer.price,
    availability: offer.availability || (/\bsold out|out of stock\b/i.test(detailsText) ? "Out Of Stock" : /\badd to cart|buy now\b/i.test(detailsText) ? "In Stock" : "Check retailer"),
    images
  };
}
async function resolvePostImages(post) {
  let page = null;
  let canonical = String(post.sourceUrl || post.url || "");
  const subject = `${post.title || ""} ${post.summary || ""} ${post.source || ""}`;
  const images = [];
  const verifiedProducts = [];
  let productPageChecks = 0;
  try {
    page = await fetchPublisherArticle(post);
    canonical = canonicalUrl(page.html, page.url);
    const nodes = jsonLdNodes(page.html);
    const structuredProduct = nodes.filter((node) => typeIncludes(node, "Product"))
      .find((node) => /pok[eé]mon/i.test(`${node.name || ""} ${node.description || ""}`) && TCG_PRODUCT_RE.test(`${node.name || ""} ${node.description || ""}`)) || null;
    images.push(...extractItemImages(page.html, canonical, subject, "post", null, structuredProduct));
  } catch (error) {
    console.warn(`Publisher article lookup skipped for ${post.title}: ${error?.message || error}`);
  }

  const verifyCandidates = async (candidateList, limit = 2) => {
    for (const candidate of candidateList.slice(0, limit)) {
      try {
        const productPage = await fetchHtml(candidate.url);
        productPageChecks += 1;
        const productCanonical = canonicalUrl(productPage.html, productPage.url);
        const verified = validateProductPage(productPage, productCanonical, post);
        if (!verified) continue;
        if (!verifiedProducts.some((item) => item.url === verified.url)) verifiedProducts.push(verified);
        images.push(...verified.images);
        if (verifiedProducts.length >= 3) break;
      } catch (error) {
        console.warn(`Retailer product check skipped: ${candidate.url} // ${error?.message || error}`);
      }
    }
  };

  let sourceProductLinks = [];
  if (page) {
    sourceProductLinks = productPageCandidates(page.html, canonical, post);
    await verifyCandidates(sourceProductLinks, 2);
  }

  const subjectRetailer = storeFromText(subject, "Other");
  const pageRetailer = page ? storeFromText(pageText(page.html), "Other") : "Other";
  const preferredRetailer = subjectRetailer !== "Other" ? subjectRetailer : pageRetailer;

  // Search indexed retailer product details when the article has no product URL or the
  // article itself could not be retrieved. Only validated product-detail pages become BUY links.
  if (!verifiedProducts.length) {
    const retailerOrder = preferredRetailer !== "Other"
      ? [preferredRetailer, "TCGplayer", "Amazon"]
      : ["TCGplayer", "Amazon", "Target"];
    const domainFor = {
      "Pokémon Center": "pokemoncenter.com", "TCGplayer": "tcgplayer.com", "Amazon": "amazon.com",
      "Target": "target.com", "Walmart": "walmart.com", "Best Buy": "bestbuy.com",
      "GameStop": "gamestop.com", "Costco": "costco.com", "Barnes & Noble": "barnesandnoble.com",
      "Meijer": "meijer.com", "Five Below": "fivebelow.com", "Hot Topic": "hottopic.com",
      "Fanatics": "fanatics.com", "Dave & Adam's Card World": "dacardworld.com",
      "Steel City Collectibles": "steelcitycollectibles.com", "Game Nerdz": "gamenerdz.com",
      "Forge and Fire Gaming": "forgeandfiregaming.com"
    };
    const queryTerms = productWords(post).slice(0, 7).join(" ") || "Pokemon TCG booster box cards";
    for (const retailer of [...new Set(retailerOrder)].slice(0, 3)) {
      const domain = domainFor[retailer];
      if (!domain) continue;
      const results = await searchWebResults(`site:${domain} "${queryTerms}" Pokemon TCG product buy`, 8);
      const candidates = results.filter((result) => {
        try {
          const host = new URL(result.url).hostname.toLowerCase().replace(/^www\./, "");
          return host === domain || host.endsWith(`.${domain}`);
        } catch { return false; }
      }).map((result) => ({ url: result.url, retailer, label: result.title, score: titleMatchCount(queryTerms, `${result.title} ${result.snippet}`) }));
      await verifyCandidates(candidates.sort((a, b) => b.score - a.score), 2);
      if (verifiedProducts.length) break;
    }
  }

  const finalProduct = verifiedProducts[0] || null;
  const fallbackLinks = finalProduct ? [] : retailerSearchLinksFor(post, preferredRetailer);
  const dedupedImages = uniqueImages(images);
  return {
    sourceUrl: canonical,
    siteUrl: finalProduct ? (() => { try { return new URL(finalProduct.url).origin; } catch { return ""; } })() : (page ? (() => { try { return new URL(canonical).origin; } catch { return ""; } })() : ""),
    images: dedupedImages,
    productUrl: finalProduct?.url || "",
    productRetailer: finalProduct?.retailer || "",
    productName: finalProduct?.name || "",
    productPrice: finalProduct?.price || "",
    productAvailability: finalProduct?.availability || "",
    productLinks: verifiedProducts.map(({ url, retailer, name, price, availability }) => ({ url, retailer, name, price, availability })),
    productSearchLinks: fallbackLinks,
    productSearchUrl: finalProduct ? "" : (fallbackLinks[0]?.url || ""),
    productSearchRetailer: finalProduct ? "" : (fallbackLinks[0]?.retailer || ""),
    productLookupStatus: finalProduct ? "verified" : (fallbackLinks.length ? "search-fallback" : "not-found"),
    productPageChecks
  };
}
async function mapWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try { await worker(items[index], index); }
      catch (error) { console.warn("PokeDrop discovery worker error:", error?.message || error); }
    }
  });
  await Promise.all(workers);
}
function normalizeImages(value) {
  if (!Array.isArray(value)) return [];
  return uniqueImages(value.map((item) => typeof item === "string" ? ({ url: item, label: "ITEM IMAGE", kind: "product", alt: "" }) : item));
}

// Enrich product/news alert images for the existing regular Drop Finder cards.
const posts = readJson("posts.json", []);
if (Array.isArray(posts) && posts.length) {
  const now = Date.now();
  const candidates = posts.filter((post) => {
    if (Number(post.productLookupVersion || 0) < RESOLVER_VERSION) return true;
    if (post.productLookupStatus === "verified" && /^https?:\/\//i.test(post.productUrl || "")) return false;
    const last = Date.parse(post.productLookupAt || post.imageLookupAt || "");
    return !Number.isFinite(last) || now - last >= ((post.productLookupStatus === "error" || post.imageLookupStatus === "error") ? 864e5 : 7 * 864e5);
  }).slice(0, MAX_POST_IMAGE_CHECKS_PER_RUN);
  let postImageErrors = 0;
  await mapWithConcurrency(candidates, CONCURRENCY, async (post) => {
    const checkedAt = new Date().toISOString();
    try {
      const resolved = await resolvePostImages(post);
      post.sourceUrl = resolved.sourceUrl || post.sourceUrl || post.url;
      post.siteUrl = resolved.siteUrl || post.siteUrl || "";
      post.imageUrls = resolved.images.length ? resolved.images : thumbRecords(post);
      post.imageLookupStatus = resolved.images.length ? "found" : "not-found";
      post.imageLookupAt = checkedAt;
      post.imageLookupVersion = RESOLVER_VERSION;
      post.productUrl = resolved.productUrl || "";
      post.productRetailer = resolved.productRetailer || "";
      post.productName = resolved.productName || "";
      post.productPrice = resolved.productPrice || "";
      post.productAvailability = resolved.productAvailability || "";
      post.productLinks = resolved.productLinks || [];
      post.productSearchLinks = resolved.productSearchLinks || [];
      post.productSearchUrl = resolved.productSearchUrl || "";
      post.productSearchRetailer = resolved.productSearchRetailer || "";
      post.productLookupStatus = resolved.productLookupStatus || "not-found";
      post.productLookupAt = checkedAt;
      post.productLookupVersion = RESOLVER_VERSION;
      post.productPageChecks = resolved.productPageChecks || 0;
      post.productVerifiedAt = resolved.productUrl ? checkedAt : "";
      console.log(`Item images (${resolved.images.length}): ${post.title}`);
    } catch (error) {
      post.imageUrls = normalizeImages(post.imageUrls);
      if (!post.imageUrls.length) post.imageUrls = thumbRecords(post);
      post.imageLookupStatus = "error";
      post.imageLookupAt = checkedAt;
      post.imageLookupVersion = RESOLVER_VERSION;
      post.imageLookupError = String(error?.message || error).slice(0, 160);
      post.productUrl = "";
      post.productLinks = [];
      const fallbackRetailer = storeFromText(`${post.title || ""} ${post.summary || ""} ${post.source || ""}`, "Other");
      post.productSearchLinks = retailerSearchLinksFor(post, fallbackRetailer);
      post.productSearchUrl = post.productSearchLinks[0]?.url || "";
      post.productSearchRetailer = post.productSearchLinks[0]?.retailer || "";
      post.productLookupStatus = post.productSearchUrl ? "search-fallback" : "error";
      post.productLookupError = String(error?.message || error).slice(0, 160);
      post.productLookupAt = checkedAt;
      post.productLookupVersion = RESOLVER_VERSION;
      postImageErrors += 1;
    }
  });
  writeJson("posts.json", posts);
  const feedStatus = readJson("feed-status.json", {});
  feedStatus.news ||= {};
  feedStatus.news.itemImageDiscovery = {
    version: RESOLVER_VERSION,
    pagesChecked: candidates.length,
    itemsWithImages: posts.filter((post) => normalizeImages(post.imageUrls).length).length,
    verifiedProductPages: posts.filter((post) => post.productUrl).length,
    retailerSearchFallbacks: posts.filter((post) => post.productSearchUrl).length,
    productSearchLinksAvailable: posts.filter((post) => Array.isArray(post.productSearchLinks) && post.productSearchLinks.length).length,
    productPagesMissing: posts.filter((post) => !post.productUrl && !post.productSearchUrl).length,
    productDetailPagesChecked: posts.reduce((total, post) => total + (Number(post.productPageChecks) || 0), 0),
    imageErrors: postImageErrors,
    search: { ...SEARCH_STATS }
  };
  writeJson("feed-status.json", feedStatus);
}

// Enrich, revalidate and prune giveaway leads. Old resolver results are not trusted in v6.
const raffles = readJson("raffles.json", []);
if (!Array.isArray(raffles) || !raffles.length) {
  console.log("Raffle discovery: no raffle leads to validate.");
} else {
  for (const raffle of raffles) {
    if (Number(raffle.entryLookupVersion || 0) < RESOLVER_VERSION) {
      raffle.entryUrl = "";
      raffle.entryLinkLabel = "";
      raffle.entrySearchUrl = "";
      raffle.startDate = "";
      raffle.endDate = "";
      raffle.prize = "";
      raffle.imageUrl = "";
      raffle.imageType = "";
      raffle.imageUrls = [];
      raffle.status = "Verify";
      raffle.statusDate = null;
      raffle.statusNote = "Waiting for v6 destination verification; old entry links and dates were not trusted.";
      raffle.qualificationStatus = "pending";
    }
    const brief = `${raffle.title || ""} ${raffle.summary || ""}`;
    if (CRIME_RE.test(brief) || !PROMOTION_RE.test(brief) || isMoneyOnlyPrize(prizeHintFromText(brief))) {
      raffle.qualificationStatus = "rejected";
      raffle.entryLookupStatus = "rejected";
      raffle.entryLookupVersion = RESOLVER_VERSION;
      raffle.entryUrl = "";
    }
  }
  const now = Date.now();
  const candidates = raffles.filter((raffle) => {
    if (Number(raffle.entryLookupVersion || 0) < RESOLVER_VERSION) return true;
    if (raffle.qualificationStatus === "rejected") return false;
    const last = Date.parse(raffle.entryLookupAt || "");
    return !Number.isFinite(last) || now - last >= (raffle.entryLookupStatus === "error" ? 864e5 : 7 * 864e5);
  }).slice(0, MAX_RAFFLE_CHECKS_PER_RUN);
  let lookupErrors = 0;
  let publisherPagesChecked = 0;

  await mapWithConcurrency(candidates, CONCURRENCY, async (raffle) => {
    const checkedAt = new Date().toISOString();
    // Quick rejection before network I/O avoids spending requests on theft reports and cash-only draws.
    const brief = `${raffle.title || ""} ${raffle.summary || ""}`;
    if (CRIME_RE.test(brief) || (!raffle.targetedSearch && !isTcgGiveawayText(brief)) || (!PROMOTION_RE.test(brief) && !raffle.targetedSearch)) {
      raffle.qualificationStatus = "rejected";
      raffle.entryLookupStatus = "rejected";
      raffle.entryLookupAt = checkedAt;
      raffle.entryLookupVersion = RESOLVER_VERSION;
      raffle.entryUrl = "";
      raffle.status = "Verify";
      return;
    }
    try {
      const resolved = await resolveRaffle(raffle);
      raffle.sourceUrl = resolved.sourceUrl || raffle.sourceUrl || raffle.url;
      raffle.entryUrl = resolved.entryUrl || ""; // never carry an unverified legacy URL forward
      raffle.entryLinkLabel = resolved.entryLinkLabel || "";
      raffle.entrySearchUrl = resolved.entrySearchUrl || "";
      raffle.entryLookupStatus = resolved.relevant ? (resolved.entryUrl ? "found" : "not-found") : "rejected";
      raffle.entryLookupAt = checkedAt;
      raffle.entryLookupVersion = RESOLVER_VERSION;
      raffle.lastVerifiedAt = checkedAt;
      raffle.qualificationStatus = resolved.relevant ? "confirmed" : "rejected";
      raffle.entryLookupError = "";
      if (!resolved.relevant) {
        raffle.status = "Verify";
        raffle.statusDate = null;
        raffle.statusNote = "Filtered out: the source page did not confirm a Pokémon TCG card giveaway or raffle.";
      } else {
        const metadata = resolved.metadata || {};
        for (const field of ["siteName", "siteUrl", "pageTitle", "pageDescription", "startDate", "endDate", "prize", "imageUrl", "imageType"]) {
          raffle[field] = metadata[field] || "";
        }
        raffle.imageUrls = normalizeImages(metadata.imageUrls || []);
        if (!raffle.imageUrls.length) raffle.imageUrls = thumbRecords(raffle);
        const status = resolved.inferredStatus || inferStatus(raffle.startDate, raffle.endDate, resolved.bodyText || "");
        raffle.status = status.status;
        raffle.statusDate = status.statusDate || null;
        raffle.statusNote = status.statusNote;
        raffle.store = storeFromText(`${raffle.title} ${raffle.source} ${raffle.siteName} ${raffle.siteUrl}`, raffle.store);
      }
      publisherPagesChecked += 1;
      console.log(`Giveaway ${raffle.qualificationStatus}: ${raffle.title}`);
    } catch (error) {
      if (!Array.isArray(raffle.imageUrls) || !raffle.imageUrls.length) raffle.imageUrls = thumbRecords(raffle);
      raffle.entryUrl = "";
      raffle.entryLinkLabel = "";
      raffle.entrySearchUrl = `https://www.google.com/search?q=${encodeURIComponent(`"${raffle.title}" Pokémon TCG giveaway entry`)}`;
      raffle.entryLookupStatus = "error";
      raffle.entryLookupAt = checkedAt;
      raffle.entryLookupVersion = RESOLVER_VERSION;
      raffle.lastVerifiedAt = checkedAt;
      raffle.qualificationStatus = isTcgGiveawayText(brief) ? "unverified" : "rejected";
      raffle.entryLookupError = String(error?.message || error).slice(0, 180);
      raffle.status = raffle.qualificationStatus === "unverified" ? "Verify" : "Verify";
      raffle.statusDate = null;
      raffle.statusNote = "The publisher page could not be verified. No entry URL or unverified prize image is shown.";
      if (raffle.qualificationStatus === "rejected") lookupErrors += 1;
      else lookupErrors += 1;
    }
  });

  const validRaffles = raffles.filter((raffle) => {
    if (raffle.qualificationStatus === "rejected" || raffle.entryLookupStatus === "rejected") return false;
    const brief = `${raffle.title || ""} ${raffle.summary || ""}`;
    if (CRIME_RE.test(brief)) return false;
    return raffle.qualificationStatus === "confirmed"
      || (raffle.qualificationStatus === "unverified" && isTcgGiveawayText(brief))
      || (raffle.qualificationStatus === "pending" && PROMOTION_RE.test(brief) && (raffle.targetedSearch || isTcgGiveawayText(brief)));
  });
  const rank = { Open: 0, Upcoming: 1, Verify: 2, Closed: 3 };
  validRaffles.sort((a, b) => (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || String(b.date || "").localeCompare(String(a.date || "")));
  writeJson("raffles.json", validRaffles);

  const feedStatus = readJson("feed-status.json", {});
  feedStatus.raffles ||= {};
  feedStatus.raffles.directEntryLinksFound = validRaffles.filter((item) => /^https?:\/\//i.test(item.entryUrl || "")).length;
  feedStatus.raffles.directEntryLinksMissing = validRaffles.filter((item) => !/^https?:\/\//i.test(item.entryUrl || "")).length;
  feedStatus.raffles.entryLookupsThisRun = candidates.length;
  feedStatus.raffles.entryLookupErrors = lookupErrors;
  feedStatus.raffles.entrySearchFallbacks = validRaffles.filter((item) => /^https?:\/\//i.test(item.entrySearchUrl || "")).length;
  feedStatus.raffles.qualifiedLeads = validRaffles.length;
  feedStatus.raffles.rejectedLeads = raffles.length - validRaffles.length;
  feedStatus.raffles.discoveryEngine = {
    version: RESOLVER_VERSION,
    publisherPagesChecked,
    prizeDetailsFound: validRaffles.filter((item) => item.prize).length,
    startDatesFound: validRaffles.filter((item) => item.startDate).length,
    endDatesFound: validRaffles.filter((item) => item.endDate).length,
    prizeImagesFound: validRaffles.filter((item) => item.imageUrl && item.imageType === "prize").length,
    rejectedFalsePositives: raffles.length - validRaffles.length,
    entryLinksValidated: validRaffles.filter((item) => item.entryUrl).length,
    search: { ...SEARCH_STATS }
  };
  writeJson("feed-status.json", feedStatus);
  console.log(`PokeDrop discovery v${RESOLVER_VERSION}: ${candidates.length} checked; ${validRaffles.length} qualified; ${feedStatus.raffles.directEntryLinksFound} verified entry URLs; ${lookupErrors} page errors.`);
}
