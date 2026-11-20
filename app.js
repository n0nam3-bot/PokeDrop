const $ = s => document.querySelector(s);
const cats = ["All", "Restock", "Release", "Promo", "Collab"];
let posts = [], cat = "All", q = "";

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

const nav = $("nav");
for (const c of cats) {
  const b = el("button", "", c);
  b.type = "button";
  b.setAttribute("aria-pressed", c === cat);
  b.onclick = () => {
    cat = c;
    for (const x of nav.children) x.setAttribute("aria-pressed", x === b);
    draw();
  };
  nav.append(b);
}
$("input").oninput = e => { q = e.target.value.toLowerCase(); draw(); };

function draw() {
  const feed = $("#feed");
  feed.replaceChildren();
  const list = posts.filter(p =>
    (cat === "All" || p.cat === cat) && (p.title + " " + p.text).toLowerCase().includes(q));
  if (!list.length) {
    feed.append(el("p", "box", "NO POSTS FOUND. CHANGE THE FILTER OR SEARCH."));
    return;
  }
  for (const p of list) {
    const a = el("article", "box");
    a.dataset.c = p.cat;
    const d = new Date(p.date + "T12:00:00");
    a.append(
      el("span", "tag", p.cat),
      el("time", "", d.toLocaleDateString("en-US", { month: "short", day: "numeric" })),
      el("h2", "", p.title),
      el("p", "", p.text)
    );
    if (/^https?:\/\//.test(p.url || "")) {
      const l = el("a", "go", "OPEN");
      l.href = p.url;
      l.target = "_blank";
      l.rel = "noopener noreferrer sponsored";
      a.append(l);
    }
    feed.append(a);
  }
}

fetch("posts.json")
  .then(r => r.json())
  .then(j => { posts = j.sort((a, b) => b.date.localeCompare(a.date)); draw(); })
  .catch(() => $("#feed").append(el("p", "box", "COULD NOT LOAD posts.json. DEPLOY TO GITHUB PAGES OR USE A LOCAL SERVER.")));
