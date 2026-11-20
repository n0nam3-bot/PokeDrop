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
  if (/\b(raffle|giveaway|giveaways|give away|giving away|sweepstakes|enter to win|contest|lottery|prize draw)\b/.test(text)) return "Raffle";
  if (/\b(deal|deals|sale|sales|discount|discounts|price drop|price cut|clearance|coupon|record[- ]low|save \$|\d+% off)\b/.test(text)) return "Deals";
  if (/\b(restock|back in stock|in stock|stock alert|replenish(?:ed|ment)?|available now|queue)\b/.test(text)) return "Restock";
  if (/\b(exclusive|limited edition|special collection|ultra[- ]premium|rare promo|pok[eé]mon center|collector(?:'s|s)?)\b/.test(text)) return "Rare Drop";
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

function raffleStatus(title, summary, publishedDate) {
  const text = `${title || ""} ${summary || ""}`.toLowerCase();
  const publishedAt = Date.parse(publishedDate || "");
  const ageDays = Number.isFinite(publishedAt) ? (Date.now() - publishedAt) / 864e5 : 0;
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
  const saysOpen = /\b(enter now|entries? (?:are )?open|raffle is open|giveaway is open|sweepstakes is open|now open|open now|enter here|enter to win now|giveaway is live|raffle is live|register now|registration is open)\b/.test(text);
  const hasFutureClosingDate = closingDate && Date.parse(closingDate) > now;
  if (saysOpen && ageDays > 45 && !hasFutureClosingDate) {
    return { status: "Closed", statusDate: null, statusNote: "ARCHIVED LEAD: this announcement is more than 45 days old. Treat the entry window as likely closed unless the official page confirms otherwise." };
  }
  if (saysOpen) {
    return { status: "Open", statusDate: closingDate, statusNote: "The source indicates entries are currently open; confirm the deadline on the official page." };
  }
  if (ageDays > 45 && !hasFutureClosingDate) {
    return { status: "Closed", statusDate: null, statusNote: "ARCHIVED LEAD: this announcement is more than 45 days old. Its entry window has likely ended; verify the original source." };
  }
  if (/\b(enter to win|raffle|giveaway|sweepstakes|drawing|contest)\b/.test(text)) {
    return { status: "Verify", statusDate: closingDate || openingDate, statusNote: "Entry status was not clear in the headline or available snippet. Check the source before entering." };
  }
  return { status: "Verify", statusDate: null, statusNote: "Check the source for current entry status and rules." };
}

function raffleStore(post) {
  const haystack = `${post.title || ""} ${post.summary || ""} ${post.source || ""}`;
  const match = STORE_PATTERNS.find(([, pattern]) => pattern.test(haystack));
  return match ? match[0] : "Other";
}

function isGoogleHost(hostname) {
  return /(^|\.)google\.[a-z.]+$/i.test(String(hostname || "")) || /(^|\.)news\.google\.com$/i.test(String(hostname || ""));
}

function resolveHttpUrl(value, baseUrl) {
  try {
    let url = new URL(decodeEntities(String(value || "").trim()), baseUrl);
    if (/(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname === "/url") {
      const wrapped = url.searchParams.get("q") || url.searchParams.get("url") || url.searchParams.get("u");
      if (wrapped) url = new URL(wrapped);
    }
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function htmlAttribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(attributes || "").match(new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3] ?? "") : "";
}

function canonicalPageUrl(html, fallbackUrl) {
  const linkTags = [...String(html || "").matchAll(/<link\b([^>]*)>/gi)];
  for (const [, attributes] of linkTags) {
    if (/\bcanonical\b/i.test(htmlAttribute(attributes, "rel"))) {
      const candidate = resolveHttpUrl(htmlAttribute(attributes, "href"), fallbackUrl);
      if (candidate) return candidate;
    }
  }
  const metaTags = [...String(html || "").matchAll(/<meta\b([^>]*)>/gi)];
  for (const [, attributes] of metaTags) {
    const property = htmlAttribute(attributes, "property") || htmlAttribute(attributes, "name");
    if (/^(og:url|twitter:url)$/i.test(property)) {
      const candidate = resolveHttpUrl(htmlAttribute(attributes, "content"), fallbackUrl);
      if (candidate) return candidate;
    }
  }
  return fallbackUrl;
}

function isEntryPlatform(hostname) {
  return /(^|\.)(gleam\.io|sweepwidget\.com|rafflecopter\.com|raffall\.com|viral-sweep\.com|viralsweep\.com|sweeppea\.com|easypromosapp\.com|woobox\.com|shortstack\.com|kingsumo\.com|typeform\.com|jotform\.com)$/i.test(String(hostname || ""));
}

function looksLikeEntryPage(url, html) {
  try {
    const parsed = new URL(url);
    if (isEntryPlatform(parsed.hostname)) return true;
    const forms = [...String(html || "").matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)];
    return forms.some(([, attributes, body]) => {
      const formEvidence = `${htmlAttribute(attributes, "action")} ${body}`;
      const mentionsGiveaway = /\b(raffle|giveaway|sweepstakes|contest|lottery|enter to win|entry)\b/i.test(formEvidence);
      const hasSubmitAction = /\b(enter|submit|register|join|participate|send entry)\b|type\s*=\s*["']?submit/i.test(formEvidence);
      return mentionsGiveaway && hasSubmitAction;
    });
  } catch {
    return false;
  }
}

function findEntryCandidates(html, articleUrl) {
  const candidates = [];
  const articleHost = (() => {
    try { return new URL(articleUrl).hostname.toLowerCase(); } catch { return ""; }
  })();
  const source = String(html || "");
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of source.matchAll(anchorPattern)) {
    const attributes = match[1];
    const rawHref = htmlAttribute(attributes, "href") || htmlAttribute(attributes, "data-href");
    const href = resolveHttpUrl(rawHref, articleUrl);
    if (!href) continue;
    let parsed;
    try { parsed = new URL(href); } catch { continue; }
    if (isGoogleHost(parsed.hostname) || /^(?:mailto|tel):/i.test(href)) continue;

    const anchorText = stripMarkup(match[2]).toLowerCase();
    const start = Math.max(0, match.index - 360);
    const end = Math.min(source.length, match.index + match[0].length + 360);
    const context = stripMarkup(source.slice(start, end)).toLowerCase();
    const urlText = `${parsed.pathname} ${parsed.search}`.toLowerCase();
    const hasEntryAction = /\b(enter(?: now| here| to win)?|submit (?:your )?entr(?:y|ies)|register(?: now)?|join (?:the )?(?:giveaway|raffle|contest)|participate|fill out (?:the )?(?:form|entry)|entry form|click here to enter)\b/.test(anchorText)
      || (/\bclick here\b/.test(anchorText) && /\b(raffle|giveaway|sweepstakes|contest|pokemon|pokémon|tcg)\b/.test(context));
    const hasContestUrl = /raffle|giveaway|sweepstakes|contest|lottery|(?:^|\/)entry(?:\/|$)/i.test(urlText);
    const contestContext = /\b(raffle|giveaway|sweepstakes|contest|lottery|pokemon|pokémon|tcg)\b/.test(context);
    const platform = isEntryPlatform(parsed.hostname);
    const isExternal = !articleHost || parsed.hostname.toLowerCase() !== articleHost;
    const isRulesOnly = /\b(official rules|rules and regulations|terms and conditions)\b/.test(anchorText) && !hasEntryAction;
    let score = (hasEntryAction ? 10 : 0) + (hasContestUrl ? 5 : 0) + (contestContext ? 2 : 0) + (platform ? 5 : 0) + (isExternal ? 1 : 0);
    if (isRulesOnly) score -= 7;
    if (/\/(?:news|article|articles|blog|press-release)\//i.test(parsed.pathname) && !platform) score -= 3;

    const sufficientlySpecific = (hasEntryAction && contestContext) || (hasContestUrl && (platform || contestContext)) || (platform && contestContext);
    if (sufficientlySpecific && score >= 11) {
      candidates.push({ url: parsed.href, score, label: anchorText.slice(0, 100) });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

async function resolveRaffleEntryLink(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, {
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; PokeDropCommunityRadar/1.0)",
        accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return { status: "error", sourceUrl, entryUrl: "", error: `Article page HTTP ${response.status}` };

    const html = (await response.text()).slice(0, 2500000);
    const finalUrl = response.url || sourceUrl;
    const canonicalUrl = canonicalPageUrl(html, finalUrl);
    const articleUrl = !isGoogleHost(new URL(finalUrl).hostname)
      ? canonicalUrl
      : (!isGoogleHost(new URL(canonicalUrl).hostname) ? canonicalUrl : sourceUrl);

    if (looksLikeEntryPage(finalUrl, html)) {
      return { status: "found", sourceUrl: articleUrl, entryUrl: finalUrl, entryLinkLabel: "Direct giveaway page" };
    }
    if (looksLikeEntryPage(canonicalUrl, html)) {
      return { status: "found", sourceUrl: articleUrl, entryUrl: canonicalUrl, entryLinkLabel: "Direct giveaway page" };
    }

    const entry = findEntryCandidates(html, articleUrl)[0];
    return entry
      ? { status: "found", sourceUrl: articleUrl, entryUrl: entry.url, entryLinkLabel: entry.label || "Entry link" }
      : { status: "not-found", sourceUrl: articleUrl, entryUrl: "", error: "No direct entry link was identified on the source page." };
  } catch (error) {
    return { status: "error", sourceUrl, entryUrl: "", error: error?.message || String(error) };
  }
}

async function mapWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

function loadPrevious(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRaffleCandidate(post) {
  const text = `${post?.title || ""} ${post?.summary || ""} ${post?.text || ""}`;
  return /\b(raffle|giveaway|giveaways|give away|giving away|sweepstakes|enter to win|contest|drawing|lottery|prize draw|win (?:a|an|one|the))\b/i.test(text);
}

function isTcgRaffleCandidate(post) {
  const text = `${post?.title || ""} ${post?.summary || ""} ${post?.text || ""} ${post?.source || ""}`;
  return /\b(pokemon|pokémon)\b/i.test(text)
    && /\b(tcg|trading cards?|pokemon cards?|booster boxes?|elite trainer boxes?|\betb\b|card shops?|promo cards?)\b/i.test(text)
    && isRaffleCandidate(post);
}

function raffleIdentity(post) {
  return String(post?.url || "").trim().toLowerCase().split("?")[0].replace(/\/$/, "");
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

if (!collected.length && !raffleCollected.length) {
  console.error("No new headlines or raffle results were returned. Existing feed entries will be retained where they remain within their history windows.");
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

// Raffle leads are collected into their own data file but shown inside the same Drop Finder feed. Ambiguous dates are marked Verify.
const targetedRaffleUrls = new Set(raffleCollected.map(raffleIdentity).filter(Boolean));
const previousRaffleUrls = new Set(previousRaffles.map(raffleIdentity).filter(Boolean));
const raffleCutoff = Date.now() - RAFFLE_KEEP_DAYS * 864e5;
const validRaffleHistory = (post) => {
  const timestamp = Date.parse(post?.date || "");
  return post && post.title && Number.isFinite(timestamp) && timestamp >= raffleCutoff && timestamp <= Date.now() + 864e5;
};
const raffleCandidates = [...raffleCollected, ...collected.filter(isRaffleCandidate), ...previousRaffles].filter(validRaffleHistory);
const uniqueRaffles = new Map();
for (const post of raffleCandidates) {
  const title = clean(post.title);
  const summary = compactSummary(post.summary || post.text || "");
  const url = String(post.url || post.sourceUrl || "").trim();
  const identity = raffleIdentity({ ...post, url });
  const isTargetedResult = identity && targetedRaffleUrls.has(identity);
  const isRetainedLead = identity && previousRaffleUrls.has(identity);
  if (!isTargetedResult && !isRetainedLead && !isTcgRaffleCandidate({ ...post, title, summary })) continue;
  if (!/^https?:\/\//i.test(url)) continue;
  const key = url.toLowerCase().split("?")[0] || title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const status = raffleStatus(title, summary, post.date);
  const normalized = {
    date: new Date(post.date).toISOString(),
    title,
    summary,
    source: clean(post.source || String(post.text || "").replace(/^via\s+/i, "")),
    store: raffleStore({ ...post, title, summary }),
    status: status.status,
    statusDate: status.statusDate,
    statusNote: status.statusNote,
    url,
    sourceUrl: String(post.sourceUrl || post.resolvedArticleUrl || post.url || url).trim(),
    entryUrl: String(post.entryUrl || "").trim(),
    entryLinkLabel: String(post.entryLinkLabel || "").trim(),
    entryLookupAt: String(post.entryLookupAt || "").trim(),
    entryLookupStatus: String(post.entryLookupStatus || "").trim()
  };
  const existing = uniqueRaffles.get(key);
  if (!existing || Date.parse(normalized.date) > Date.parse(existing.date)) {
    normalized.entryUrl ||= existing?.entryUrl || "";
    normalized.entryLinkLabel ||= existing?.entryLinkLabel || "";
    normalized.sourceUrl ||= existing?.sourceUrl || existing?.url || "";
    normalized.entryLookupAt ||= existing?.entryLookupAt || "";
    normalized.entryLookupStatus ||= existing?.entryLookupStatus || "";
    uniqueRaffles.set(key, normalized);
  } else if (!existing.entryUrl && normalized.entryUrl) {
    existing.entryUrl = normalized.entryUrl;
    existing.entryLinkLabel = normalized.entryLinkLabel;
  }
}

const raffleList = [...uniqueRaffles.values()].sort((a, b) => {
  const rank = { Open: 0, Upcoming: 1, Verify: 2, Closed: 3 };
  return (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || b.date.localeCompare(a.date);
}).slice(0, MAX_RAFFLES);

// Google News links are discovery links, not entry pages. Resolve the publisher page and
// look for a clearly signposted entry form/platform. Unresolved leads keep the article
// only as a secondary source link and are never mislabeled as direct entry links.
const nowForLookup = Date.now();
const lookupCandidates = raffleList.filter((raffle) => {
  if (raffle.entryUrl || !raffle.url) return false;
  const lastLookup = Date.parse(raffle.entryLookupAt || "");
  if (!Number.isFinite(lastLookup)) return true;
  const retryAfter = raffle.entryLookupStatus === "error" ? 864e5 : 7 * 864e5;
  return nowForLookup - lastLookup >= retryAfter;
}).slice(0, 32);
let entryLookupErrors = 0;
await mapWithConcurrency(lookupCandidates, 4, async (raffle) => {
  const resolved = await resolveRaffleEntryLink(raffle.sourceUrl || raffle.url);
  raffle.sourceUrl = resolved.sourceUrl || raffle.sourceUrl || raffle.url;
  raffle.entryLookupAt = new Date().toISOString();
  raffle.entryLookupStatus = resolved.status;
  if (resolved.entryUrl) {
    raffle.entryUrl = resolved.entryUrl;
    raffle.entryLinkLabel = resolved.entryLinkLabel || "Entry page";
  }
  if (resolved.status === "error") entryLookupErrors += 1;
});

const raffles = raffleList;

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
    entryLookupsThisRun: lookupCandidates.length,
    entryLookupErrors,
    historyDays: RAFFLE_KEEP_DAYS,
    sources: raffleDiagnostics
  },
  failures
};
const feedStatusOutput = `${JSON.stringify(feedStatus, null, 1)}\n`;
if (postsOutput !== previousPostsRaw && (collected.length || !previousPosts.length)) writeFileSync("posts.json", postsOutput);
if (rafflesOutput !== previousRafflesRaw && (raffleSucceeded > 0 || newsSucceeded > 0 || !previousRaffles.length)) writeFileSync("raffles.json", rafflesOutput);
let oldFeedStatus = "";
try { oldFeedStatus = readFileSync("feed-status.json", "utf8"); } catch {}
if (feedStatusOutput !== oldFeedStatus) writeFileSync("feed-status.json", feedStatusOutput);
console.log(`Saved ${posts.length} headlines and ${raffles.length} raffles/giveaways.`);
console.log(`Raffle search health: ${raffleSucceeded}/${raffleDiagnostics.length} sources responded; ${raffleCollected.length} raw results; ${raffles.length} saved leads.`);
if (failures.length) console.log(`${failures.length} source request(s) failed; see feed-status.json for details.`);
