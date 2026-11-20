// Free Pokémon TCG headlines and raffle/giveaway radar.
// Sources are public Google News RSS results; raffle status is inferred from article text and is not retailer-verified.
import { readFileSync, writeFileSync } from "node:fs";

const FEEDS = [
  ["Restock", 'pokemon (tcg OR cards OR "trading cards") (restock OR "back in stock" OR "in stock" OR "stock alert" OR "available now") when:14d'],
  ["Deals", 'pokemon (tcg OR cards OR "trading cards") (deal OR deals OR sale OR discount OR "price drop" OR clearance OR coupon) when:14d'],
  ["Rare Drop", 'pokemon (tcg OR cards OR "trading cards") (exclusive OR "limited edition" OR "special collection" OR "ultra premium" OR "rare promo" OR "pokemon center") when:30d'],
  ["Release", 'pokemon (tcg OR cards OR "trading cards") ("release date" OR "new set" OR expansion OR "card list" OR revealed OR announced) when:30d'],
  ["Promo", 'pokemon (tcg OR cards OR "trading cards") (promo OR "promotional card" OR collaboration OR collab OR "happy meal") when:30d']
];

const RAFFLE_FEEDS = [
  ["All stores", '("pokemon tcg" OR "pokemon cards" OR "pokemon trading cards") (raffle OR giveaway OR sweepstakes OR "enter to win" OR "win a booster box" OR drawing) when:30d'],
  ["Pokémon Center", '("pokemon tcg" OR "pokemon cards") (raffle OR giveaway OR sweepstakes OR "enter to win") ("pokemon center" OR pokemon.com) when:30d'],
  ["Big-box retailers", '("pokemon tcg" OR "pokemon cards") (raffle OR giveaway OR sweepstakes OR "enter to win") (Target OR Walmart OR "Best Buy") when:30d'],
  ["Game and club stores", '("pokemon tcg" OR "pokemon cards") (raffle OR giveaway OR sweepstakes OR "enter to win") (GameStop OR Costco OR "Sam\'s Club" OR Amazon) when:30d'],
  ["Local card shops", '("pokemon tcg" OR "pokemon cards") (raffle OR giveaway OR sweepstakes OR "enter to win") ("card shop" OR "game store" OR LGS) when:30d']
];

const KEEP_DAYS = 45;
const MAX_POSTS = 120;
const MAX_RAFFLES = 100;
const MAX_SUMMARY_LENGTH = 280;
const STORE_PATTERNS = [
  ["Pokémon Center", /pok[eé]mon\s*center|pokemon\.com/i],
  ["Target", /\btarget\b/i],
  ["Walmart", /\bwalmart\b/i],
  ["Costco", /\bcostco\b/i],
  ["GameStop", /game\s*stop/i],
  ["Best Buy", /best\s*buy/i],
  ["Amazon", /\bamazon\b/i],
  ["Sam's Club", /sam'?s\s*club/i],
  ["TCGplayer", /tcgplayer/i],
  ["Local Card Shop", /card\s*shop|game\s*store|\bLGS\b/i]
];

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

function splitFeedItem(item) {
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

  const description = compactSummary(readTag(item, "description"));
  return {
    date: date.toISOString(),
    title: displayTitle,
    summary: description,
    source,
    url: readTag(item, "link")
  };
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
    const parsed = splitFeedItem(item);
    if (!parsed) return null;
    return {
      date: parsed.date,
      cat: categoryFor(`${parsed.title} ${parsed.summary}`, category),
      title: parsed.title,
      summary: parsed.summary,
      source: parsed.source,
      url: parsed.url
    };
  }).filter((post) => post && /^https?:\/\//i.test(post.url));
}

function extractEventDate(text, keywordPattern) {
  const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const datePattern = `(${month}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)`;
  const match = String(text || "").match(new RegExp(`(?:${keywordPattern})\\s+(?:on\\s+)?${datePattern}`, "i"));
  if (!match) return null;

  let dateText = match[1].replace(/(\d)(st|nd|rd|th)\b/i, "$1");
  const hasYear = /\b\d{4}\b/.test(dateText) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(dateText);
  if (!hasYear) dateText += ` ${new Date().getFullYear()}`;
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return null;
  if (!hasYear && date.getTime() < Date.now() - 86400000 && /^(?:opens?|starts?|begins?)/i.test(match[0])) {
    date.setFullYear(date.getFullYear() + 1);
  }
  return date.toISOString();
}

function raffleStatus(title, summary) {
  const text = `${title || ""} ${summary || ""}`.toLowerCase();
  const closingDate = extractEventDate(text, "(?:closes?|ends?|ending|deadline|entries close|entry closes?|through|until|by)");
  const openingDate = extractEventDate(text, "(?:opens?|opening|starts?|begins?|registration opens?|entries open)");
  const now = Date.now();

  if (/\b(entries? (?:are )?closed|raffle closed|giveaway closed|sweepstakes closed|no longer accepting entries|winners? (?:were )?(?:announced|selected|drawn)|winner announced|giveaway ended|raffle ended|sweepstakes ended|deadline (?:has )?passed)\b/.test(text)) {
    return { status: "Closed", statusDate: closingDate, statusNote: "The source indicates entries have closed or winners were announced." };
  }
  if (closingDate && Date.parse(closingDate) < now) {
    return { status: "Closed", statusDate: closingDate, statusNote: "The listed entry deadline appears to have passed." };
  }
  if (openingDate && Date.parse(openingDate) > now) {
    return { status: "Upcoming", statusDate: openingDate, statusNote: "The source indicates entries open or the event starts on this date." };
  }
  if (/\b(coming soon|upcoming raffle|upcoming giveaway|will launch|will open|registration opens soon|entries open soon|starts soon|pre[- ]?registration)\b/.test(text)) {
    return { status: "Upcoming", statusDate: openingDate, statusNote: "The source describes a future entry window; confirm the opening date." };
  }
  if (/\b(enter now|entries? (?:are )?open|raffle is open|giveaway is open|sweepstakes is open|now open|open now|enter here|enter to win now|giveaway is live|raffle is live)\b/.test(text)) {
    return { status: "Open", statusDate: closingDate, statusNote: "The source indicates entries are currently open; confirm the deadline on the official page." };
  }
  if (/\b(enter to win|raffle|giveaway|sweepstakes|drawing)\b/.test(text)) {
    return { status: "Verify", statusDate: closingDate || openingDate, statusNote: "Entry status was not clear in the headline or available snippet. Check the source before entering." };
  }
  return { status: "Verify", statusDate: null, statusNote: "Check the source for current entry status and rules." };
}

function raffleStore(post) {
  const haystack = `${post.title || ""} ${post.summary || ""} ${post.source || ""}`;
  const match = STORE_PATTERNS.find(([, pattern]) => pattern.test(haystack));
  return match ? match[0] : "Other";
}

function loadPrevious(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const previousPostsRaw = (() => {
  try { return readFileSync("posts.json", "utf8"); } catch { return ""; }
})();
const previousPosts = loadPrevious("posts.json");
const previousRafflesRaw = (() => {
  try { return readFileSync("raffles.json", "utf8"); } catch { return ""; }
})();
const previousRaffles = loadPrevious("raffles.json");

const collected = [];
const raffleCollected = [];
const failures = [];
for (const feedSpec of FEEDS) {
  try {
    const posts = await loadFeed(feedSpec);
    collected.push(...posts);
    console.log(`${feedSpec[0]}: ${posts.length} headlines`);
  } catch (error) {
    failures.push(`${feedSpec[0]}: ${error.message}`);
    console.error(`${feedSpec[0]} feed failed:`, error.message);
  }
}
for (const feedSpec of RAFFLE_FEEDS) {
  try {
    const posts = await loadFeed(feedSpec);
    const rafflePosts = posts.filter((post) => /\b(raffle|giveaway|sweepstakes|enter to win|win a .*?(?:box|pack|card)|drawing)\b/i.test(`${post.title} ${post.summary}`));
    raffleCollected.push(...rafflePosts);
    console.log(`Raffles / ${feedSpec[0]}: ${rafflePosts.length} results`);
  } catch (error) {
    failures.push(`Raffles / ${feedSpec[0]}: ${error.message}`);
    console.error(`Raffles / ${feedSpec[0]} feed failed:`, error.message);
  }
}

if (!collected.length && !raffleCollected.length) {
  console.error("No headlines or raffle results fetched. Existing JSON feed files were left unchanged.");
  process.exit(1);
}

const cutoff = Date.now() - KEEP_DAYS * 864e5;
const validRecent = (post) => {
  const timestamp = Date.parse(post?.date || "");
  return post && post.title && timestamp && timestamp >= cutoff && timestamp <= Date.now() + 864e5;
};

// Keep the news feed's current rolling history and normalize category labels.
const postCandidates = [...collected, ...previousPosts].filter(validRecent);
const uniquePosts = new Map();
for (const post of postCandidates) {
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
  const existing = uniquePosts.get(key);
  if (!existing || Date.parse(normalized.date) > Date.parse(existing.date)) uniquePosts.set(key, normalized);
}
const posts = [...uniquePosts.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_POSTS);

// Raffle entries are separate from general news. Ambiguous dates are marked Verify rather than guessed Open.
const raffleCandidates = [...raffleCollected, ...previousRaffles].filter(validRecent);
const uniqueRaffles = new Map();
for (const post of raffleCandidates) {
  const title = clean(post.title);
  const summary = compactSummary(post.summary || post.text || "");
  if (!/\b(raffle|giveaway|sweepstakes|enter to win|win a .*?(?:box|pack|card)|drawing)\b/i.test(`${title} ${summary}`)) continue;
  const url = String(post.url || "").trim();
  if (!/^https?:\/\//i.test(url)) continue;
  const key = url.toLowerCase().split("?")[0] || title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const status = raffleStatus(title, summary);
  const normalized = {
    date: new Date(post.date).toISOString(),
    title,
    summary,
    source: clean(post.source || String(post.text || "").replace(/^via\s+/i, "")),
    store: raffleStore({ ...post, title, summary }),
    status: status.status,
    statusDate: status.statusDate,
    statusNote: status.statusNote,
    url
  };
  const existing = uniqueRaffles.get(key);
  if (!existing || Date.parse(normalized.date) > Date.parse(existing.date)) uniqueRaffles.set(key, normalized);
}
const raffles = [...uniqueRaffles.values()].sort((a, b) => {
  const rank = { Open: 0, Upcoming: 1, Verify: 2, Closed: 3 };
  return (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || b.date.localeCompare(a.date);
}).slice(0, MAX_RAFFLES);

const postsOutput = `${JSON.stringify(posts, null, 1)}\n`;
const rafflesOutput = `${JSON.stringify(raffles, null, 1)}\n`;
if (postsOutput !== previousPostsRaw) writeFileSync("posts.json", postsOutput);
if (rafflesOutput !== previousRafflesRaw) writeFileSync("raffles.json", rafflesOutput);
console.log(`Saved ${posts.length} headlines and ${raffles.length} raffles/giveaways${failures.length ? `; ${failures.length} source group(s) failed` : ""}.`);
