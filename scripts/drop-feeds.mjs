// PokeDrop drop-alert reader.
// Reads public archives of Pokemon TCG drop-alert newsletters, keeps only real drawings / raffles /
// invites / queues, takes the direct entry link from each post, works out the entry window and status,
// finds a product image, and publishes everything into raffles.json. Runs on GitHub Actions (free).
import { readFileSync, writeFileSync } from "node:fs";

// Add another alert source by adding a line. `archive` is a public page that lists posts and
// `post` matches the path of a post link on that page.
const SOURCES = [
  { name: "TCG Drop Radar", archive: "https://buttondown.com/tcgdropradar/archive/", post: /\/tcgdropradar\/archive\/[a-z0-9-]+\/?$/i }
];
const MAX_NEW_PER_RUN = 25, KEEP_DAYS = 45, IMAGE_FILLS_PER_RUN = 30;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const EVENT_RE = /\b(draw(?:ing|ings)?|raffles?|lotter(?:y|ies)|invites?|invitations?|queue|giveaways?|sweepstakes)\b/i;

const STORES = [
  ["Pokémon Center", /pok[eé]mon center/i, /(^|\.)pokemoncenter\.com$/, (q) => `https://www.pokemoncenter.com/search/${encodeURIComponent(q)}`],
  ["Target", /\btarget\b/i, /(^|\.)target\.com$/, (q) => `https://www.target.com/s?searchTerm=${encodeURIComponent(q)}`],
  ["Walmart", /walmart/i, /(^|\.)walmart\.com$/, (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`],
  ["Best Buy", /best ?buy/i, /(^|\.)bestbuy\.com$/, (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(q)}`],
  ["GameStop", /gamestop/i, /(^|\.)gamestop\.com$/, (q) => `https://www.gamestop.com/search/?q=${encodeURIComponent(q)}`],
  ["Amazon", /amazon/i, /(^|\.)amazon\.com$/, (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`],
  ["Costco", /costco/i, /(^|\.)costco\.com$/, (q) => `https://www.costco.com/CatalogSearch?keyword=${encodeURIComponent(q)}`],
  ["Sam's Club", /sam'?s club/i, /(^|\.)samsclub\.com$/, (q) => `https://www.samsclub.com/s/${encodeURIComponent(q)}`],
  ["Barnes & Noble", /barnes (&|and) noble/i, /(^|\.)barnesandnoble\.com$/, (q) => `https://www.barnesandnoble.com/s/${encodeURIComponent(q)}`]
];

// ---------- small helpers ----------
const decode = (s) => String(s)
  .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " })[e])
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const textOf = (html) => decode(String(html).replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (attrs, name) => { const m = String(attrs).match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")); return m ? (m[1] ?? m[2] ?? "") : ""; };
function metaOf(html, key) {
  for (const [, attrs] of String(html).matchAll(/<meta\b([^>]*)>/gi)) {
    if ([attr(attrs, "property"), attr(attrs, "name")].some((v) => v.toLowerCase() === key)) return decode(attr(attrs, "content"));
  }
  return "";
}
const abs = (href, base) => { try { const u = new URL(decode(href), base); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; } };
const TRACK = /^(utm_|tag$|linkcode$|ref_?$|camp$|creative|aff|irclickid|clickid|cjevent|cmpid|sid$|subid|a$|mpid|ranmid|raneaid|ransiteid|sourceid|veh$|publisherid|sscid)/i;
function tidy(href) {
  try { const u = new URL(href); for (const k of [...u.searchParams.keys()]) if (TRACK.test(k)) u.searchParams.delete(k); u.hash = ""; return u.href; } catch { return ""; }
}
// The PKMN font cannot draw # % * + < = > @ \ ^ ` { | }, so keep display text inside what it can draw.
export const fontSafe = (s) => String(s || "")
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/pokemon/gi, "Pok\u00e9mon")
  .replace(/(\d)\s*%/g, "$1 percent").replace(/%/g, " percent").replace(/\+/g, " plus ").replace(/\|/g, " - ")
  .replace(/[#*<>=\\^`{}@]/g, "").replace(/[^\x20-\x7E\u00e9]/g, "").replace(/\s+/g, " ").trim();
async function get(url) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/json" }, signal: AbortSignal.timeout(20000) });
      if (res.ok) return await res.text();
    } catch {}
  }
  return "";
}

// ---------- times (US Eastern unless a zone is given) ----------
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEK_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function usDst(y, m, d) {
  const nthSunday = (mo, n) => { let c = 0; for (let x = 1; x <= 31; x += 1) { const t = new Date(Date.UTC(y, mo, x)); if (t.getUTCMonth() !== mo) break; if (t.getUTCDay() === 0 && ++c === n) return x; } return 0; };
  return (m > 2 && m < 10) || (m === 2 && d >= nthSunday(2, 2)) || (m === 10 && d < nthSunday(10, 1));
}
function zonedIso(y, m, d, h, mi, zone = "ET", s = 0) {
  const z = String(zone || "ET").toLowerCase();
  const base = { et: -5, ct: -6, mt: -7, pt: -8 }[z.length === 2 ? z : `${z[0]}t`] ?? -5;
  const dst = z.length === 3 ? z[1] === "d" : usDst(y, m, d);
  return new Date(Date.UTC(y, m, d, h - base - (dst ? 1 : 0), mi, s)).toISOString();
}
function etParts(iso) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month) - 1, d: Number(p.day) };
}
const fmtEt = (iso) => `${new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/\u202f/g, " ")} ET`;

const DAYS = "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DAYSPEC = `(?:(?:${DAYS})\\b\\.?,?\\s+)?(?<day>today|tonight|tomorrow|(?:${DAYS})\\b|(?:${MONTHS})\\b\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?)`;
const ZONE = "(?:\\s*(?<tz>E[SD]?T|C[SD]?T|M[SD]?T|P[SD]?T)\\b)?";
const CLOCK = "(?<h>\\d{1,2})(?::(?<mi>\\d{2}))?\\s*(?<ap>[ap])\\.?m\\b\\.?";
const RANGE = new RegExp(`(?:${DAYSPEC}[,\\s]+)?(?:(?:at|from|between)\\s+)?(?<sh>\\d{1,2})(?::(?<smi>\\d{2}))?(?:\\s*(?<sap>[ap])\\.?m\\b\\.?)?\\s*(?:-|\u2013|\u2014|to)\\s*(?<h>\\d{1,2})(?::(?<mi>\\d{2}))?\\s*(?<ap>[ap])\\.?m\\b\\.?${ZONE}`, "i");
const CLOSE = new RegExp(`(?:clos(?:e|es|ed|ing)|until|ends?|ending|deadline|by)\\s+(?:at\\s+)?(?:${DAYSPEC}[,\\s]+(?:at\\s+)?)?${CLOCK}${ZONE}`, "i");
const START = new RegExp(`(?:${DAYSPEC}[,\\s]+)?(?:at|@)\\s+${CLOCK}${ZONE}`, "i");
const hour24 = (h, ap) => (Number(h) % 12) + (/p/i.test(ap) ? 12 : 0);

function resolveDay(token, pub) {
  const t = String(token || "today").toLowerCase();
  const base = Date.UTC(pub.y, pub.m, pub.d);
  const parts = (ms) => { const x = new Date(ms); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate() }; };
  if (t === "today" || t === "tonight") return pub;
  if (t === "tomorrow") return parts(base + 864e5);
  const wd = /^[a-z]+$/.test(t) ? WEEK_KEYS.indexOf(t.slice(0, 3)) : -1;
  if (wd >= 0) return parts(base + ((wd - new Date(base).getUTCDay() + 7) % 7) * 864e5);
  const md = t.match(new RegExp(`^(${MONTHS})\\b\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`));
  if (md) {
    const mo = MONTH_KEYS.indexOf(md[1].slice(0, 3));
    let y = md[3] ? Number(md[3]) : pub.y;
    if (!md[3] && Date.UTC(y, mo, Number(md[2])) < base - 30 * 864e5) y += 1;
    return { y, m: mo, d: Number(md[2]) };
  }
  return pub;
}

// Reads windows written the way alert posts write them: "closes 6pm ET", "Wednesday 5-6pm ET",
// "entries close Wednesday, Nov 4 at 11:00am", "have until Sunday 10am ET", "Sept 23 at 5pm ET".
export function parseWindow(text, pubIso) {
  const pub = etParts(pubIso);
  const at = (day, h, mi, tz) => { const d = resolveDay(day, pub); return zonedIso(d.y, d.m, d.d, h, Number(mi || 0), tz || "ET"); };
  let m = String(text).match(RANGE);
  if (m) {
    const g = m.groups, endH = hour24(g.h, g.ap);
    let startH = hour24(g.sh, g.sap || g.ap);
    if (!g.sap && startH > endH) startH -= 12;
    return { startDate: at(g.day, startH, g.smi, g.tz), endDate: at(g.day, endH, g.mi, g.tz) };
  }
  if ((m = String(text).match(CLOSE))) return { endDate: at(m.groups.day, hour24(m.groups.h, m.groups.ap), m.groups.mi, m.groups.tz) };
  if ((m = String(text).match(START))) {
    const startDate = at(m.groups.day, hour24(m.groups.h, m.groups.ap), m.groups.mi, m.groups.tz);
    return /\b(?:one|1)[- ]hour\b|for an hour/i.test(text) ? { startDate, endDate: new Date(Date.parse(startDate) + 36e5).toISOString() } : { startDate };
  }
  return {};
}

// Status is worked out from the published window, never guessed from the age of a headline alone.
export function statusFor(e, now = Date.now()) {
  const start = Date.parse(e.startDate), end = Date.parse(e.endDate);
  const age = (now - Date.parse(e.date)) / 864e5;
  if (start > now) return ["Upcoming", `Opens ${fmtEt(e.startDate)}.`];
  if (end) return now <= end ? ["Open", `Closes ${fmtEt(e.endDate)}.`] : ["Closed", `Closed ${fmtEt(e.endDate)}.`];
  if (e.hint === "closed") return ["Closed", "The alert says this one has closed."];
  if (start) return now - start < 2 * 36e5 ? ["Open", `Started ${fmtEt(e.startDate)}. No end time was published.`] : age > 1 ? ["Closed", "No end time was published and it started over a day ago."] : ["Verify", "No end time was published. Check the entry page."];
  if (e.hint === "live") {
    const p = etParts(e.date);
    return now <= Date.parse(zonedIso(p.y, p.m, p.d, 23, 59, "ET", 59)) ? ["Open", "Reported live today. No end time was published."] : ["Closed", "Reported live on the day it was posted."];
  }
  if (e.hint === "still-open") return age <= 7 ? ["Verify", "Reported open when posted. No deadline was published, so check the entry page."] : ["Closed", "Reported open over a week ago with no deadline."];
  return age <= 3 ? ["Verify", "No entry window was published. Check the entry page."] : ["Closed", "Posted several days ago with no deadline."];
}

// ---------- entry link ----------
const BAD_HOST = /(^|\.)(buttondown\.(?:com|email)|whop\.com|tcgdropradar\.com|ebay\.com|facebook\.com|x\.com|twitter\.com|instagram\.com|discord\.(?:gg|com)|youtube\.com|google\.com)$/i;
const ENTRY_TEXT = /\b(enter|entry|drawing|raffle|invite|queue|register|sign ?up|request|join|check your account|lottery)\b/i;
const NOISE_TEXT = /\b(alerts?|premium|subscribe|discord|unsubscribe)\b|every .* product|our .* page/i;
export function pickEntry(links, store) {
  let best = null;
  for (const link of links) {
    let u; try { u = new URL(link.href); } catch { continue; }
    const host = u.hostname.toLowerCase();
    const shop = STORES.find((s) => s[2].test(host));
    if (BAD_HOST.test(host) || !shop) continue;
    let score = 0;
    if (ENTRY_TEXT.test(link.text)) score += 10;
    if (/draw|raffle|invite|lottery|queue|collectibles/i.test(u.pathname)) score += 6;
    if (store && shop[0] === store) score += 5;
    if (/\/(p|ip|dp|site)\//.test(u.pathname)) score += 2;
    if (NOISE_TEXT.test(link.text)) score -= 20;
    if (!best || score > best.score) best = { url: tidy(u.href), label: link.text.slice(0, 60), score, store: shop[0], product: /\/(p|ip|dp|site)\//.test(u.pathname) };
  }
  return best && best.score >= 5 ? best : null;
}

// ---------- product image (free tcgcsv.com mirror of TCGplayer's catalog) ----------
const TCGCSV = "https://tcgcsv.com/tcgplayer/3";
let groupsCache = null;
const productsCache = new Map();
const setKey = (name) => String(name).toLowerCase()
  .replace(/^[a-z]{1,5}\d{0,3}(?:\.\d)?[a-z]?\s*:\s*/, "")
  .replace(/^(scarlet\s*&\s*violet|sword\s*&\s*shield|sun\s*&\s*moon|mega evolution|black\s*&\s*white)\s*[-:]\s*/, "")
  .replace(/[^a-z0-9]+/g, " ").trim();
async function groups() {
  if (!groupsCache) { try { groupsCache = JSON.parse(await get(`${TCGCSV}/groups`)).results || []; } catch { groupsCache = []; } }
  return groupsCache;
}
async function productsOf(id) {
  if (!productsCache.has(id)) { try { productsCache.set(id, JSON.parse(await get(`${TCGCSV}/${id}/products`)).results || []); } catch { productsCache.set(id, []); } }
  return productsCache.get(id);
}
const KINDS = [
  [/ultra[- ]premium|\bupcs?\b/i, /ultra[- ]premium/i], [/elite trainer box|\betbs?\b/i, /elite trainer box/i],
  [/booster bundle/i, /booster bundle/i], [/booster (?:box|display)/i, /booster (?:box|display)/i],
  [/blister/i, /blister/i], [/build\s*&\s*battle/i, /build\s*&\s*battle/i], [/binder/i, /binder/i], [/\btin\b/i, /\btin\b/i], [/collection/i, /collection/i]
];
export async function imageFor(text) {
  const raw = String(text || "");
  const hay = ` ${raw.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let best = null;
  for (const g of await groups()) {
    const key = setKey(g.name);
    if (key.length < 6 || /miscellaneous|promo|prize pack|world championship|classic|deck/.test(key)) continue;
    const at = hay.indexOf(` ${key} `);
    if (at >= 0 && (!best || at < best.at || (at === best.at && key.length > best.key.length))) best = { g, key, at };
  }
  if (!best) return null;
  const sealed = (await productsOf(best.g.groupId)).filter((p) => p.imageUrl && !(p.extendedData || []).some((d) => /^(number|rarity)$/i.test(d.name)) && !/ - \d+\/\d+/.test(p.name));
  const asked = KINDS.map(([ask, pick]) => ({ at: raw.search(ask), pick })).filter((k) => k.at >= 0).sort((a, b) => a.at - b.at);
  const product = asked.map((k) => sealed.find((p) => k.pick.test(p.name))).find(Boolean)
    || sealed.find((p) => /elite trainer box/i.test(p.name)) || sealed.find((p) => /booster/i.test(p.name));
  return product ? { url: product.imageUrl, name: fontSafe(product.name).replace(/^Pok\u00e9mon TCG:?\s*/i, "") } : null;
}

// ---------- one alert post -> one raffle event ----------
// The store is the one named first in the title (a Walmart post can mention Target further down).
function storeIn(text) {
  let best = null;
  for (const s of STORES) { const at = String(text).search(s[1]); if (at >= 0 && (!best || at < best.at)) best = { name: s[0], at }; }
  return best?.name || "";
}
export async function buildEvent(source, url, html, now = Date.now()) {
  const title = (metaOf(html, "og:title") || textOf((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "")).replace(/\s*[•|]\s*Buttondown$/i, "").trim();
  if (!title || !EVENT_RE.test(title)) return null;
  const summary = metaOf(html, "og:description");
  const full = textOf(html);
  const dm = full.match(new RegExp(`\\b(${MONTHS})\\b\\.?\\s+(\\d{1,2}),\\s+(\\d{4})\\b`, "i"));
  if (!dm) return null;
  const date = zonedIso(Number(dm[3]), MONTH_KEYS.indexOf(dm[1].slice(0, 3).toLowerCase()), Number(dm[2]), 12, 0, "ET");
  if (now - Date.parse(date) > KEEP_DAYS * 864e5) return null;
  const from = full.indexOf(title);
  let body = from >= 0 ? full.slice(from + title.length) : full;
  body = body.split(/Don't miss what's next|You're getting this because/i)[0].trim();
  const head = `${title}. ${summary}. ${body.slice(0, 700)}`;
  const window = { ...parseWindow(head, date) };
  if (!window.startDate && !window.endDate) Object.assign(window, parseWindow(`${title}. ${summary}. ${body.slice(0, 2500)}`, date));
  const claims = `${title}. ${summary}`;
  const hint = /\b(just closed|now closed|has closed|have closed|has ended)\b/i.test(claims) ? "closed"
    : /\b(live right now|live now|queue (?:is )?(?:live|open)|just (?:opened|started)|open now|now open|are live|is live)\b/i.test(claims) ? "live"
    : /\bstill open\b/i.test(claims) ? "still-open" : "";
  const links = [...String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(([, a, inner]) => ({ href: abs(attr(a, "href"), url), text: textOf(inner) })).filter((l) => l.href);
  const named = storeIn(title) || storeIn(claims);
  const entry = pickEntry(links, named);
  const store = named || entry?.store || "";
  const image = await imageFor(`${title}. ${summary}. ${body.slice(0, 900)}`);
  const query = image?.name || fontSafe(title).replace(/\b(drawings?|raffles?|invites?|queue|live|open|now|closes?|just|started|still)\b/gi, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const shop = STORES.find((s) => s[0] === store);
  const event = {
    origin: "drop-feed", id: `drop-${url.replace(/\/+$/, "").split("/").pop()}`,
    title: fontSafe(title), date, url, sourceUrl: url, source: source.name, siteName: source.name, siteUrl: url, store, retailer: store,
    summary: fontSafe(summary), prize: image?.name || fontSafe(summary).slice(0, 140),
    startDate: window.startDate || "", endDate: window.endDate || "", hint,
    entryUrl: entry?.url || "", entryLinkLabel: entry ? fontSafe(entry.label) || "Entry link" : "", entryLookupStatus: "alert-feed",
    entrySearchUrl: !entry && shop ? shop[3](query) : "",
    productUrl: entry?.product ? entry.url : "", productRetailer: store, productName: image?.name || "",
    productSearchUrl: shop ? shop[3](query) : "", productSearchRetailer: store,
    imageUrls: image ? [{ url: image.url, label: "PRODUCT IMAGE", kind: "product", alt: image.name }] : [], imageType: image ? "prize" : ""
  };
  return refresh(event, now);
}
function refresh(event, now) {
  const [status, statusNote] = statusFor(event, now);
  return { ...event, status, statusNote, statusDate: event.endDate || event.startDate || event.date, lastVerifiedAt: new Date(now).toISOString() };
}

// ---------- run ----------
const canon = (u) => { try { const x = new URL(u); return `${x.origin}${x.pathname.replace(/\/+$/, "")}`.toLowerCase(); } catch { return ""; } };
async function collectNew(known, now) {
  const out = [], report = []; let seen = 0;
  for (const src of SOURCES) {
    const listing = await get(src.archive);
    const urls = [];
    for (const [, a, inner] of listing.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = abs(attr(a, "href"), src.archive);
      if (href && src.post.test(new URL(href).pathname) && EVENT_RE.test(textOf(inner)) && !urls.includes(href)) urls.push(href);
    }
    report.push({ name: `Drop alerts: ${src.name}`, ok: urls.length > 0, results: urls.length, ...(listing ? {} : { error: "Archive page could not be read" }) });
    for (const url of urls.slice(0, 40)) {
      seen += 1;
      if (known.has(canon(url)) || out.length >= MAX_NEW_PER_RUN) continue;
      const html = await get(url);
      const event = html ? await buildEvent(src, url, html, now) : null;
      if (event) out.push(event);
    }
  }
  return { out, seen, report };
}
const readList = (file) => { try { const v = JSON.parse(readFileSync(file, "utf8")); return Array.isArray(v) ? v : []; } catch { return []; } };
export const stashDropEvents = () => readList("raffles.json").filter((r) => r?.origin === "drop-feed");

export async function publishDropEvents(previous = [], now = Date.now()) {
  let fresh = [], seen = 0, report = [];
  try { ({ out: fresh, seen, report } = await collectNew(new Set(previous.map((e) => canon(e.url))), now)); }
  catch (error) { console.error(`Drop alerts failed: ${error.message}`); }
  const byId = new Map();
  for (const e of [...fresh, ...previous]) if (e?.id && !byId.has(e.id)) byId.set(e.id, e);
  const events = [...byId.values()].filter((e) => now - Date.parse(e.date) < KEEP_DAYS * 864e5).map((e) => refresh(e, now))
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  // Keep only real entry opportunities: alert events, plus older leads whose entry link was verified.
  const verified = readList("raffles.json").filter((r) => r && r.origin !== "drop-feed" && r.entryUrl);
  writeFileSync("raffles.json", `${JSON.stringify([...events, ...verified], null, 1)}\n`);
  // Plain news stays in the news feed, and products without a picture get one when the set can be matched.
  const posts = readList("posts.json");
  let filled = 0;
  for (const p of posts) {
    if (p.cat === "Raffle" && !p.entryUrl) p.cat = "Rare Drop";
    if (filled < IMAGE_FILLS_PER_RUN && !(p.imageUrls || []).length && !p.imageUrl) {
      const image = await imageFor(`${p.title} ${p.summary || ""}`);
      if (image) { p.imageUrls = [{ url: image.url, label: "PRODUCT IMAGE", kind: "product", alt: image.name }]; filled += 1; }
    }
  }
  if (posts.length) writeFileSync("posts.json", `${JSON.stringify(posts, null, 1)}\n`);
  try {
    const status = JSON.parse(readFileSync("feed-status.json", "utf8"));
    status.dropFeeds = { checkedAt: new Date(now).toISOString(), sources: SOURCES.map((s) => s.name), alertPostsSeen: seen, newEvents: fresh.length, events: events.length,
      open: events.filter((e) => e.status === "Open").length, upcoming: events.filter((e) => e.status === "Upcoming").length,
      withEntryLink: events.filter((e) => e.entryUrl).length, withImage: events.filter((e) => e.imageUrls.length).length, newsImagesAdded: filled };
    const raffles = (status.raffles ||= {});
    const total = events.length + verified.length, found = events.filter((e) => e.entryUrl).length + verified.length;
    Object.assign(raffles, { savedLeads: total, directEntryLinksFound: found, directEntryLinksMissing: total - found });
    raffles.sources = [...(raffles.sources || []).filter((x) => !String(x.name).startsWith("Drop alerts:")), ...report];
    writeFileSync("feed-status.json", `${JSON.stringify(status, null, 2)}\n`);
  } catch {}
  console.log(`Drop alerts: ${events.length} events (${fresh.length} new), ${events.filter((e) => e.entryUrl).length} with entry links; ${filled} news images added.`);
  return events;
}
