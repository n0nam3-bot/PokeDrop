// Free Pokémon TCG news and deal radar.
// This collects public news headlines through Google News RSS; it does not verify live retailer inventory.
import { readFileSync, writeFileSync } from "node:fs";

const FEEDS = [
  ["Restock", 'pokemon (tcg OR cards OR "trading cards") (restock OR "back in stock" OR "in stock" OR "stock alert" OR "available now") when:14d'],
  ["Deals", 'pokemon (tcg OR cards OR "trading cards") (deal OR deals OR sale OR discount OR "price drop" OR clearance OR coupon) when:14d'],
  ["Rare Drop", 'pokemon (tcg OR cards OR "trading cards") (exclusive OR "limited edition" OR "special collection" OR "ultra premium" OR "rare promo" OR "pokemon center") when:30d'],
  ["Release", 'pokemon (tcg OR cards OR "trading cards") ("release date" OR "new set" OR expansion OR "card list" OR revealed OR announced) when:30d'],
  ["Promo", 'pokemon (tcg OR cards OR "trading cards") (promo OR "promotional card" OR collaboration OR collab OR "happy meal") when:30d']
];

const KEEP_DAYS = 45;
const MAX_POSTS = 120;
const MAX_SUMMARY_LENGTH = 280;

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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

// The bundled PKMN font is a limited bitmap face. Keep feed text readable in it.
function clean(value) {
  return stripMarkup(value)
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/pokemon/gi, "Pok\u00e9mon")
    .replace(/(\d)\s*%/g, "$1 PERCENT")
    .replace(/%/g, " PERCENT")
    .replace(/\+/g, " PLUS ")
    .replace(/#/g, "")
    .replace(/[^\x20-\x7E\u00e9]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function readTag(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

function categoryFor(title, fallback) {
  const text = String(title || "").toLowerCase();
  if (/\b(deal|deals|sale|sales|discount|discounts|price drop|price cut|clearance|coupon|record[- ]low|save \$|\d+% off)\b/.test(text)) return "Deals";
  if (/\b(restock|back in stock|in stock|stock alert|replenish(?:ed|ment)?|available now|queue)\b/.test(text)) return "Restock";
  if (/\b(exclusive|limited edition|special collection|ultra[- ]premium|rare promo|pok[eé]mon center|collector(?:'s|s)?)\b/.test(text)) return "Rare Drop";
  if (/\b(promo|promotional|collab|collaboration|happy meal)\b/.test(text)) return "Promo";
  if (/\b(release date|new set|expansion|card list|reveal(?:ed|s)?|announced)\b/.test(text)) return "Release";

  const legacy = String(fallback || "").toLowerCase();
  if (legacy === "collab" || legacy === "promo") return "Promo";
  if (legacy === "deal" || legacy === "deals") return "Deals";
  if (legacy === "rare drop") return "Rare Drop";
  if (["restock", "release"].includes(legacy)) return legacy[0].toUpperCase() + legacy.slice(1);
  return "Release";
}

function compactSummary(value) {
  const result = clean(value);
  if (!result) return "";
  return result.length > MAX_SUMMARY_LENGTH ? `${result.slice(0, MAX_SUMMARY_LENGTH - 3).trimEnd()}...` : result;
}

async function loadFeed([category, query]) {
  const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" + encodeURIComponent(query);
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 PokeDrop free community feed" },
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
  return items.map(([, item]) => {
    const rawTitle = readTag(item, "title");
    const title = clean(rawTitle);
    const date = new Date(readTag(item, "pubDate"));
    if (!title || Number.isNaN(date.getTime())) return null;

    let source = clean(readTag(item, "source"));
    let displayTitle = title;
    const suffix = title.match(/^(.*) - ([^-]+)$/);
    if (suffix) {
      displayTitle = suffix[1].trim();
      source ||= suffix[2].trim();
    }

    const link = readTag(item, "link");
    const description = compactSummary(readTag(item, "description"));
    const cat = categoryFor(`${displayTitle} ${description}`, category);
    return {
      date: date.toISOString(),
      cat,
      title: displayTitle,
      summary: description,
      source,
      url: link
    };
  }).filter((post) => post && /^https?:\/\//i.test(post.url));
}

let previousRaw = "";
let previousPosts = [];
try {
  previousRaw = readFileSync("posts.json", "utf8");
  const parsed = JSON.parse(previousRaw);
  if (Array.isArray(parsed)) previousPosts = parsed;
} catch (error) {
  console.log("No readable previous posts.json; a new feed will be created.");
}

const collected = [];
const failures = [];
for (const feed of FEEDS) {
  try {
    const posts = await loadFeed(feed);
    collected.push(...posts);
    console.log(`${feed[0]}: ${posts.length} headlines`);
  } catch (error) {
    failures.push(`${feed[0]}: ${error.message}`);
    console.error(`${feed[0]} feed failed:`, error.message);
  }
}

if (!collected.length) {
  console.error("No headlines fetched. Existing posts.json was left unchanged.");
  process.exit(1);
}

const cutoff = Date.now() - KEEP_DAYS * 864e5;
const candidates = [...collected, ...previousPosts].filter((post) => {
  const timestamp = Date.parse(post?.date || "");
  return post && post.title && timestamp && timestamp >= cutoff && timestamp <= Date.now() + 864e5;
});

// Normalize older items too, so old Restock/Promo/Collab mislabels do not linger indefinitely.
const unique = new Map();
for (const post of candidates) {
  const title = clean(post.title);
  const key = title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 100);
  if (!key) continue;
  const normalized = {
    date: new Date(post.date).toISOString(),
    cat: categoryFor(`${title} ${post.summary || post.text || ""}`, post.cat),
    title,
    summary: compactSummary(post.summary || (/^via\s+/i.test(post.text || "") ? "" : post.text || "")),
    source: clean(post.source || String(post.text || "").replace(/^via\s+/i, "")),
    url: String(post.url || "").trim()
  };
  if (!/^https?:\/\//i.test(normalized.url)) continue;

  const existing = unique.get(key);
  if (!existing || Date.parse(normalized.date) > Date.parse(existing.date)) unique.set(key, normalized);
}

const posts = [...unique.values()]
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, MAX_POSTS);

const output = `${JSON.stringify(posts, null, 1)}\n`;
if (output !== previousRaw) writeFileSync("posts.json", output);
console.log(`Saved ${posts.length} unique headlines${failures.length ? `; ${failures.length} source group(s) failed` : ""}.`);
