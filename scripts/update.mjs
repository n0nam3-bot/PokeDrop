// Free Pokémon TCG headlines and dedicated raffle/giveaway discovery.
// The raffle enrichment stage runs after the feed refresh and uses only public pages/RSS.
import { readFileSync, writeFileSync } from "node:fs";

const FEEDS = [
  ["Restock", 'pokemon (tcg OR cards OR "trading cards") (restock OR "back in stock" OR "in stock" OR "stock alert" OR "available now") when:14d'],
  ["Deals", 'pokemon (tcg OR cards OR "trading cards") (deal OR deals OR sale OR discount OR "price drop" OR clearance OR coupon) when:14d'],
  ["Rare Drop", 'pokemon (tcg OR cards OR "trading cards") (exclusive OR "limited edition" OR "special collection" OR "ultra premium" OR "rare promo" OR "pokemon center") when:30d'],
  ["Release", 'pokemon (tcg OR cards OR "trading cards") ("release date" OR "new set" OR expansion OR "card list" OR revealed OR announced) when:30d'],
  ["Promo", 'pokemon (tcg OR cards OR "trading cards") (promo OR "promotional card" OR collaboration OR collab OR "happy meal") when:30d']
];

const RAFFLE_FEEDS = [
  ["TCG giveaways", '"Pokemon TCG" giveaway when:365d'],
  ["TCG raffles", '"Pokemon TCG" raffle when:365d'],
  ["Pokémon card giveaways", '"Pokemon cards" giveaway when:365d'],
  ["Pokémon card raffles", '"Pokemon cards" raffle when:365d'],
  ["Booster box prizes", '"Pokemon booster box" giveaway when:365d'],
  ["Elite Trainer Box prizes", '"Pokemon Elite Trainer Box" giveaway when:365d'],
  ["TCG sweepstakes", '"Pokemon TCG" sweepstakes when:365d'],
  ["Card shop giveaways", '"Pokemon card shop" giveaway when:365d'],
  ["Card shop raffles", '"Pokemon card shop" raffle when:365d'],
  ["Target giveaways", 'Target "Pokemon TCG" (giveaway OR raffle) when:365d'],
  ["Walmart giveaways", 'Walmart "Pokemon TCG" (giveaway OR raffle) when:365d'],
  ["GameStop giveaways", 'GameStop "Pokemon TCG" (giveaway OR raffle) when:365d'],
  ["Best Buy giveaways", '"Best Buy" "Pokemon TCG" (giveaway OR raffle) when:365d'],
  ["Costco giveaways", 'Costco "Pokemon TCG" (giveaway OR raffle) when:365d'],
  ["Pokémon Center lotteries", '"Pokemon Center" (TCG OR cards) (lottery OR raffle OR giveaway) when:365d'],
  ["Local card shop contests", '"Pokemon TCG" (contest OR "enter to win" OR drawing) shop when:365d'],
  ["Community card giveaways", '"Pokemon cards" (giveaway OR "give away" OR contest) (Instagram OR Facebook OR X OR Twitter) when:365d']
];

const KEEP_DAYS = 45;
const RAFFLE_KEEP_DAYS = 365;
const MAX_POSTS = 120;
const MAX_RAFFLES = 250;
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
  const match = String(xml || "").match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

function readAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes || "").match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function categoryFor(title, fallback) {
  const text = String(title || "").toLowerCase();
  if (/\b(raffle|giveaway|giveaways|give away|giving away|sweepstakes|enter to win|contest|lottery|prize draw)\b/.test(text)) return "Raffle";
  if (/\b(deal|deals|sale|sales|discount|discounts|price drop|price cut|clearance|coupon|record[- ]low|save \$|\d+% off)\b/.test(text)) return "Deals";
  if (/\b(restock|back in stock|in stock|stock alert|replenish(?:ed|ment)?|available now|queue)\b/.test(text)) return "Restock";
  if (/\b(exclusive|limited edition|special collection|ultra[- ]premium|rare promo|pok[e\u00e9]mon center|collector(?:'s|s)?)\b/.test(text)) return "Rare Drop";
  if (/\b(promo|promotional|collab|collaboration|happy meal)\b/.test(text)) return "Promo";
  if (/\b(release date|new set|expansion|card list|reveal(?:ed|s)?|announced)\b/.test(text)) return "Release";
  const legacy = String(fallback || "").toLowerCase();
  if (["raffle", "raffles", "giveaway", "giveaways"].includes(legacy)) return "Raffle";
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

  const sourceTag = String(item || "").match(/<source\b([^>]*)>/i);
  const source = clean(readTag(item, "source"));
  const sourceUrl = sourceTag ? readAttribute(sourceTag[1], "url") : "";
  let displayTitle = title;
  const suffix = title.match(/^(.*) - ([^-]+)$/);
  let displaySource = source;
  if (suffix) {
    displayTitle = suffix[1].trim();
    displaySource ||= suffix[2].trim();
  }

  return {
    date: date.toISOString(),
    title: displayTitle,
    summary: compactSummary(readTag(item, "description")),
    source: displaySource,
    publisherUrl: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : "",
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
      publisherUrl: parsed.publisherUrl,
      url: parsed.url
    };
  }).filter((post) => post && /^https?:\/\//i.test(post.url));
}

function loadPrevious(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 140);
}

function raffleIdentity(post) {
  return String(post?.url || "").trim().toLowerCase().split("?")[0].replace(/\/$/, "");
}

function isRaffleCandidate(post) {
  const text = `${post?.title || ""} ${post?.summary || ""} ${post?.text || ""}`;
  return /\b(raffle|giveaway|giveaways|give away|giving away|sweepstakes|enter to win|contest|drawing|lottery|prize draw|win (?:a|an|one|the))\b/i.test(text);
}

function isTcgRaffleCandidate(post) {
  const text = `${post?.title || ""} ${post?.summary || ""} ${post?.text || ""} ${post?.source || ""}`;
  const hasPokemon = /\b(pokemon|pok\u00e9mon)\b/i.test(text);
  const hasCardContext = /\b(tcg|trading cards?|pokemon cards?|booster boxes?|elite trainer boxes?|\betb\b|card shops?|promo cards?|collector boxes?)\b/i.test(text);
  const hasPromotion = /\b(raffle|giveaway|giveaways|give away|sweepstakes|enter to win|contest|drawing|lottery|prize draw|win (?:a|an|one|the))\b/i.test(text);
  return hasPokemon && hasCardContext && hasPromotion;
}

function extractEventDate(text, keywordPattern) {
  const month = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
  const datePattern = `(${month}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?)`;
  const match = String(text || "").match(new RegExp(`(?:${keywordPattern})\\s+(?:on\\s+)?${datePattern}`, "i"));
  if (!match) return "";
  let dateText = match[1].replace(/(\d)(st|nd|rd|th)\b/i, "$1");
  const hasYear = /\b\d{4}\b/.test(dateText) || /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(dateText);
  if (!hasYear) dateText += ` ${new Date().getFullYear()}`;
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "";
  if (!hasYear && date.getTime() < Date.now() - 86400000 && /^(?:opens?|starts?|begins?)/i.test(match[0])) date.setFullYear(date.getFullYear() + 1);
  return date.toISOString();
}

function inferStatus(title, summary, publishedDate, startDate = "", endDate = "") {
  const now = Date.now();
  const start = Date.parse(startDate || "");
  const end = Date.parse(endDate || "");
  if (Number.isFinite(start) && start > now) return { status: "Upcoming", statusDate: startDate, statusNote: "The event page lists a future opening date." };
  if (Number.isFinite(end)) {
    if (end < now) return { status: "Closed", statusDate: endDate, statusNote: "The listed entry deadline has passed." };
    return { status: "Open", statusDate: endDate, statusNote: "The event page lists a future entry deadline; confirm eligibility and rules." };
  }

  const text = `${title || ""} ${summary || ""}`.toLowerCase();
  const publishedAt = Date.parse(publishedDate || "");
  const ageDays = Number.isFinite(publishedAt) ? (now - publishedAt) / 864e5 : 0;
  const closingDate = extractEventDate(text, "(?:closes?|ends?|ending|deadline|entries close|entry closes?|through|until|by)");
  const openingDate = extractEventDate(text, "(?:opens?|opening|starts?|begins?|registration opens?|entries open)");
  if (/\b(entries? (?:are )?closed|raffle closed|giveaway closed|sweepstakes closed|no longer accepting entries|winners? (?:were )?(?:announced|selected|drawn)|winner announced|giveaway ended|raffle ended|sweepstakes ended|deadline (?:has )?passed)\b/.test(text)) {
    return { status: "Closed", statusDate: closingDate, statusNote: "The source indicates entries have closed or winners were announced." };
  }
  if (closingDate && Date.parse(closingDate) < now) return { status: "Closed", statusDate: closingDate, statusNote: "The listed entry deadline appears to have passed." };
  if (Number.isFinite(start) && start <= now) return { status: "Open", statusDate: endDate || "", statusNote: "The verified entry start date has passed; no closing date was published, so the giveaway is treated as ongoing until the page says otherwise." };
  if (openingDate && Date.parse(openingDate) > now) return { status: "Upcoming", statusDate: openingDate, statusNote: "The source indicates a future entry window." };
  if (/\b(coming soon|upcoming raffle|upcoming giveaway|will launch|will open|registration opens soon|entries open soon|starts soon|pre[- ]?registration)\b/.test(text)) {
    return { status: "Upcoming", statusDate: openingDate, statusNote: "The source describes a future entry window; confirm its opening date." };
  }
  const saysOpen = /\b(enter now|entries? (?:are )?open|raffle is open|giveaway is open|sweepstakes is open|now open|open now|enter here|enter to win now|giveaway is live|raffle is live|register now|registration is open)\b/.test(text);
  const hasFutureClose = closingDate && Date.parse(closingDate) > now;
  if (saysOpen && ageDays > 45 && !hasFutureClose) return { status: "Closed", statusDate: "", statusNote: "ARCHIVED LEAD: this announcement is more than 45 days old. Verify the original source before entering." };
  if (saysOpen) return { status: "Open", statusDate: closingDate, statusNote: "The source indicates entries may be open; confirm the official deadline." };
  if (ageDays > 45 && !hasFutureClose) return { status: "Closed", statusDate: "", statusNote: "ARCHIVED LEAD: this announcement is more than 45 days old. Its entry window has likely ended." };
  return { status: "Verify", statusDate: closingDate || openingDate, statusNote: "Entry status could not be confirmed from the announcement. Check the official page." };
}

function raffleStore(post) {
  const haystack = `${post.title || ""} ${post.summary || ""} ${post.source || ""} ${post.siteName || ""} ${post.siteUrl || ""} ${post.sourceUrl || ""}`;
  const patterns = [
    ["Pokémon Center", /pok[e\u00e9]mon\s*center|pokemon\.com/i],
    ["Target", /\btarget\b/i], ["Walmart", /\bwalmart\b/i], ["Costco", /\bcostco\b/i],
    ["GameStop", /game\s*stop/i], ["Best Buy", /best\s*buy/i], ["Amazon", /\bamazon\b/i],
    ["Sam's Club", /sam'?s\s*club/i], ["TCGplayer", /tcgplayer/i],
    ["Local Card Shop", /card\s*shop|game\s*store|\bLGS\b/i]
  ];
  const match = patterns.find(([, pattern]) => pattern.test(haystack));
  return match ? match[0] : (post.store && post.store !== "Other" ? post.store : "Other");
}

const previousPostsRaw = (() => { try { return readFileSync("posts.json", "utf8"); } catch { return ""; } })();
const previousPosts = loadPrevious("posts.json");
const previousRafflesRaw = (() => { try { return readFileSync("raffles.json", "utf8"); } catch { return ""; } })();
const previousRaffles = loadPrevious("raffles.json");
const previousByIdentity = new Map(previousRaffles.map((item) => [raffleIdentity(item), item]).filter(([key]) => key));

const collected = [];
const raffleCollected = [];
const failures = [];
const newsDiagnostics = [];
const raffleDiagnostics = [];

for (const feedSpec of FEEDS) {
  try {
    const posts = await loadFeed(feedSpec);
    collected.push(...posts);
    newsDiagnostics.push({ name: feedSpec[0], ok: true, results: posts.length });
    console.log(`${feedSpec[0]}: ${posts.length} headlines`);
  } catch (error) {
    failures.push(`${feedSpec[0]}: ${error.message}`);
    newsDiagnostics.push({ name: feedSpec[0], ok: false, results: 0, error: error.message });
    console.error(`${feedSpec[0]} feed failed:`, error.message);
  }
}

for (const feedSpec of RAFFLE_FEEDS) {
  try {
    const posts = await loadFeed(feedSpec);
    raffleCollected.push(...posts);
    raffleDiagnostics.push({ name: feedSpec[0], ok: true, results: posts.length });
    console.log(`Raffles / ${feedSpec[0]}: ${posts.length} search results`);
  } catch (error) {
    failures.push(`Raffles / ${feedSpec[0]}: ${error.message}`);
    raffleDiagnostics.push({ name: feedSpec[0], ok: false, results: 0, error: error.message });
    console.error(`Raffles / ${feedSpec[0]} feed failed:`, error.message);
  }
}

const now = Date.now();
const cutoff = now - KEEP_DAYS * 864e5;
const validRecent = (post) => {
  const timestamp = Date.parse(post?.date || "");
  return post && post.title && Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now + 864e5;
};

const postCandidates = [...collected, ...previousPosts].filter(validRecent);
const uniquePosts = new Map();
const POST_ENRICHMENT_FIELDS = [
  "publisherUrl", "sourceUrl", "siteUrl", "imageUrls", "imageLookupAt", "imageLookupStatus", "imageLookupVersion", "imageLookupError",
  "productUrl", "productRetailer", "productName", "productPrice", "productAvailability", "productLinks", "productSearchLinks",
  "productSearchUrl", "productSearchRetailer", "productLookupStatus", "productLookupAt", "productLookupVersion", "productPageChecks",
  "productVerifiedAt", "productLookupError"
];
for (const post of postCandidates) {
  const title = clean(post.title);
  const key = normalizedKey(title);
  if (!key) continue;
  const normalized = {
    date: new Date(post.date).toISOString(),
    cat: categoryFor(`${title} ${post.summary || post.text || ""}`, post.cat),
    title,
    summary: compactSummary(post.summary || (/^via\s+/i.test(post.text || "") ? "" : post.text || "")),
    source: clean(post.source || String(post.text || "").replace(/^via\s+/i, "")),
    publisherUrl: String(post.publisherUrl || "").trim(),
    sourceUrl: String(post.sourceUrl || "").trim(),
    imageUrls: Array.isArray(post.imageUrls) ? post.imageUrls : [],
    imageLookupAt: String(post.imageLookupAt || "").trim(),
    imageLookupStatus: String(post.imageLookupStatus || "").trim(),
    imageLookupVersion: Number(post.imageLookupVersion || 0),
    url: String(post.url || "").trim()
  };
  for (const field of POST_ENRICHMENT_FIELDS) {
    if (field in post) {
      if (field === "imageUrls" || field === "productLinks" || field === "productSearchLinks") normalized[field] = Array.isArray(post[field]) ? post[field] : [];
      else if (field.endsWith("Version") || field === "productPageChecks") normalized[field] = Number(post[field] || 0);
      else normalized[field] = String(post[field] || "").trim();
    }
  }
  if (!/^https?:\/\//i.test(normalized.url)) continue;
  const existing = uniquePosts.get(key);
  if (existing) {
    for (const field of POST_ENRICHMENT_FIELDS) {
      const isArray = field === "imageUrls" || field === "productLinks" || field === "productSearchLinks";
      const isEmpty = (value) => isArray
        ? !Array.isArray(value) || value.length === 0
        : value === "" || value === 0 || value === undefined || value === null;
      if (isEmpty(normalized[field]) && !isEmpty(existing[field])) normalized[field] = existing[field];
      else if (isEmpty(existing[field]) && !isEmpty(normalized[field])) existing[field] = normalized[field];
    }
  }
  if (!existing || Date.parse(normalized.date) > Date.parse(existing.date)) uniquePosts.set(key, normalized);
}
const posts = [...uniquePosts.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_POSTS);

const raffleCutoff = now - RAFFLE_KEEP_DAYS * 864e5;
const validRaffleHistory = (post) => {
  const timestamp = Date.parse(post?.date || "");
  return post && post.title && Number.isFinite(timestamp) && timestamp >= raffleCutoff && timestamp <= now + 864e5;
};
const raffleCandidates = [...raffleCollected, ...collected.filter((post) => categoryFor(`${post.title} ${post.summary}`, post.cat) === "Raffle"), ...previousRaffles].filter(validRaffleHistory);
const targetedRaffleUrls = new Set(raffleCollected.map(raffleIdentity).filter(Boolean));
const previousRaffleUrls = new Set(previousRaffles.map(raffleIdentity).filter(Boolean));
const uniqueRaffles = new Map();

for (const post of raffleCandidates) {
  const title = clean(post.title);
  const summary = compactSummary(post.summary || post.text || "");
  const candidateIdentity = raffleIdentity(post);
  const isTargetedResult = candidateIdentity && targetedRaffleUrls.has(candidateIdentity);
  const isRetainedLead = candidateIdentity && previousRaffleUrls.has(candidateIdentity);
  if (!isTargetedResult && !isRetainedLead && !isTcgRaffleCandidate({ ...post, title, summary })) continue;
  const url = String(post.url || post.sourceUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) continue;
  const identity = raffleIdentity({ url });
  const titleKey = normalizedKey(title);
  const prior = previousByIdentity.get(identity) || null;
  const key = identity || titleKey;
  const status = inferStatus(title, summary, post.date, post.startDate || prior?.startDate, post.endDate || prior?.endDate);
  const normalized = {
    ...(prior || {}),
    date: new Date(post.date).toISOString(),
    title,
    summary: summary || prior?.summary || "",
    source: clean(post.source || prior?.source || String(post.text || "").replace(/^via\s+/i, "")),
    store: raffleStore({ ...prior, ...post, title, summary }),
    status: status.status,
    statusDate: status.statusDate || prior?.statusDate || null,
    statusNote: status.statusNote,
    url,
    sourceUrl: String(post.sourceUrl || prior?.sourceUrl || post.resolvedArticleUrl || url).trim(),
    publisherUrl: String(post.publisherUrl || prior?.publisherUrl || "").trim(),
    targetedSearch: Boolean(isTargetedResult || prior?.targetedSearch),
    entryUrl: String(post.entryUrl || prior?.entryUrl || "").trim(),
    entryLinkLabel: String(post.entryLinkLabel || prior?.entryLinkLabel || "").trim(),
    entrySearchUrl: String(post.entrySearchUrl || prior?.entrySearchUrl || "").trim(),
    qualificationStatus: String(post.qualificationStatus || prior?.qualificationStatus || "").trim(),
    entryLookupAt: String(post.entryLookupAt || prior?.entryLookupAt || "").trim(),
    entryLookupStatus: String(post.entryLookupStatus || prior?.entryLookupStatus || "").trim(),
    entryLookupVersion: Number(post.entryLookupVersion || prior?.entryLookupVersion || 0),
    siteName: String(post.siteName || prior?.siteName || "").trim(),
    siteUrl: String(post.siteUrl || prior?.siteUrl || "").trim(),
    pageTitle: String(post.pageTitle || prior?.pageTitle || "").trim(),
    pageDescription: String(post.pageDescription || prior?.pageDescription || "").trim(),
    startDate: String(post.startDate || prior?.startDate || "").trim(),
    endDate: String(post.endDate || prior?.endDate || "").trim(),
    prize: String(post.prize || prior?.prize || "").trim(),
    imageUrl: String(post.imageUrl || prior?.imageUrl || "").trim(),
    imageType: String(post.imageType || prior?.imageType || "").trim(),
    lastVerifiedAt: String(post.lastVerifiedAt || prior?.lastVerifiedAt || "").trim()
  };
  if (!normalized.sourceUrl) normalized.sourceUrl = url;
  const existing = uniqueRaffles.get(key);
  if (!existing || Date.parse(normalized.date) > Date.parse(existing.date)) {
    for (const field of ["entryUrl", "entryLinkLabel", "entrySearchUrl", "qualificationStatus", "entryLookupAt", "entryLookupStatus", "entryLookupVersion", "publisherUrl", "targetedSearch", "siteName", "siteUrl", "pageTitle", "pageDescription", "startDate", "endDate", "prize", "imageUrl", "imageType", "lastVerifiedAt"]) {
      if (!normalized[field] && existing?.[field]) normalized[field] = existing[field];
    }
    if (!post.sourceUrl && existing?.sourceUrl && isGoogleNewsUrl(normalized.sourceUrl)) normalized.sourceUrl = existing.sourceUrl;
    uniqueRaffles.set(key, normalized);
  }
}

function isGoogleNewsUrl(value) {
  try { return /(^|\.)news\.google\.com$/i.test(new URL(value).hostname); } catch { return false; }
}

const raffles = [...uniqueRaffles.values()].sort((a, b) => {
  const rank = { Open: 0, Upcoming: 1, Verify: 2, Closed: 3 };
  return (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || b.date.localeCompare(a.date);
}).slice(0, MAX_RAFFLES);

const postsOutput = `${JSON.stringify(posts, null, 1)}\n`;
const rafflesOutput = `${JSON.stringify(raffles, null, 1)}\n`;
const newsSucceeded = newsDiagnostics.filter((source) => source.ok).length;
const raffleSucceeded = raffleDiagnostics.filter((source) => source.ok).length;
const feedStatus = {
  schemaVersion: 1,
  state: failures.length === 0 ? "ok" : (newsSucceeded + raffleSucceeded > 0 ? "partial" : "error"),
  news: {
    sourceCount: newsDiagnostics.length,
    sourcesResponded: newsSucceeded,
    searchResults: collected.length,
    sources: newsDiagnostics
  },
  raffles: {
    sourceCount: raffleDiagnostics.length,
    sourcesResponded: raffleSucceeded,
    searchResults: raffleCollected.length,
    uniqueLeads: uniqueRaffles.size,
    savedLeads: raffles.length,
    directEntryLinksFound: raffles.filter((raffle) => raffle.entryUrl).length,
    directEntryLinksMissing: raffles.filter((raffle) => !raffle.entryUrl).length,
    entryLookupsThisRun: 0,
    entryLookupErrors: 0,
    historyDays: RAFFLE_KEEP_DAYS,
    sources: raffleDiagnostics
  },
  failures
};

if (postsOutput !== previousPostsRaw && (collected.length || !previousPosts.length)) writeFileSync("posts.json", postsOutput);
if (rafflesOutput !== previousRafflesRaw && (raffleSucceeded > 0 || newsSucceeded > 0 || !previousRaffles.length)) writeFileSync("raffles.json", rafflesOutput);
let oldFeedStatus = "";
try { oldFeedStatus = readFileSync("feed-status.json", "utf8"); } catch {}
const feedStatusOutput = `${JSON.stringify(feedStatus, null, 1)}\n`;
if (feedStatusOutput !== oldFeedStatus) writeFileSync("feed-status.json", feedStatusOutput);

console.log(`Saved ${posts.length} headlines and ${raffles.length} TCG raffle/giveaway leads.`);
console.log(`Raffle searches: ${raffleSucceeded}/${raffleDiagnostics.length} sources responded; ${raffleCollected.length} raw results.`);

// Run the strict, versioned giveaway validator and product-image carousel enrichment after feeds are saved.
// This helper owns its version so new validation rules can invalidate stale entry links and page-icon images.
await import("./raffle-discovery.mjs");
