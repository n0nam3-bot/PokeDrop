// Pulls real Pokemon TCG headlines from Google News RSS and writes posts.json.
// Edit FEEDS to change what gets collected. Each entry is [category, search query].
import { readFileSync, writeFileSync } from "node:fs";

const FEEDS = [
  ["Restock", 'pokemon (tcg OR cards) (restock OR "back in stock" OR invites OR drop) when:14d'],
  ["Release", 'pokemon tcg ("release date" OR "new set" OR expansion OR reveal) when:30d'],
  ["Promo", 'pokemon cards (promo OR "happy meal" OR costco OR walmart OR target OR "best buy") when:14d'],
  ["Collab", 'pokemon (collab OR collaboration) (cards OR tcg OR "pokemon center") when:30d'],
];
const KEEP_DAYS = 45, MAX = 80;

const dec = s => s.replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/&(amp|lt|gt|quot|apos|#39|#x27);/g, (_, e) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#x27": "'" })[e])
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

// The PKMN font only has basic ASCII plus e-acute, and no % + #. Make text safe for it.
const clean = s => dec(s)
  .replace(/[\u2018\u2019\u02bc]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014]/g, "-").replace(/\u2026/g, "...")
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .replace(/pokemon/gi, "Pok\u00e9mon")
  .replace(/(\d)\s*%/g, "$1 PERCENT").replace(/%/g, " PERCENT")
  .replace(/\+/g, " PLUS ").replace(/#/g, "")
  .replace(/[^\x20-\x7E\u00e9]/g, "").replace(/\s+/g, " ").trim();

async function load([cat, q]) {
  const url = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 PokeDrop" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const xml = await res.text();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const get = t => (it.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [, ""])[1];
    const d = new Date(get("pubDate"));
    if (isNaN(d)) return null;
    let title = clean(get("title")), src = clean(get("source"));
    const m = title.match(/^(.*) - ([^-]+)$/);
    if (m) { title = m[1]; src = src || m[2]; }
    return { date: d.toISOString(), cat, title, text: src ? "Via " + src : "", url: dec(get("link")).trim() };
  }).filter(Boolean);
}

let prev = "";
try { prev = readFileSync("posts.json", "utf8"); } catch {}
let old = [];
try { old = JSON.parse(prev); } catch {}

const fresh = [];
for (const f of FEEDS) {
  try { fresh.push(...await load(f)); } catch (e) { console.error(f[0], "failed:", e.message); }
}
if (!fresh.length) { console.error("No headlines fetched."); process.exit(1); }

const seen = new Set(), cutoff = Date.now() - KEEP_DAYS * 864e5;
const posts = [...fresh, ...old]
  .filter(p => p && p.title && !p.title.startsWith("SAMPLE") && Date.parse(p.date) > cutoff)
  .filter(p => { const k = p.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60); return !seen.has(k) && seen.add(k); })
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, MAX);

const out = JSON.stringify(posts, null, 1) + "\n";
if (out !== prev) writeFileSync("posts.json", out);
console.log(posts.length + " posts");
