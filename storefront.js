(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const state = { products: [], status: null, posts: [], raffles: [], tab: "all", community: "giveaways", query: "", retailer: "all" };
  const esc = (value) => String(value ?? "");
  const validUrl = (value) => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } };
  const dateValue = (value) => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date : null; };
  const ago = (value) => { const date = dateValue(value); if (!date) return "CHECK TIME UNKNOWN"; const mins = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000)); if (mins < 1) return "JUST CHECKED"; if (mins < 60) return `${mins}M AGO`; const hours = Math.floor(mins / 60); if (hours < 24) return `${hours}H AGO`; return `${Math.floor(hours / 24)}D AGO`; };
  const prettyDate = (value) => { const date = dateValue(value); return date ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not listed"; };
  const availability = (value) => ({ IN_STOCK: ["IN STOCK", "in-stock"], PREORDER: ["PREORDER", "preorder"], OUT_OF_STOCK: ["SOLD OUT", "out-of-stock"], BLOCKED: ["CHECK BLOCKED", "blocked"], UNKNOWN: ["UNCONFIRMED", "unknown"] }[String(value || "UNKNOWN").toUpperCase()] || ["UNCONFIRMED", "unknown"]);
  const make = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };

  function relevantPokemonPost(item) {
    const text = `${item?.title || ""} ${item?.summary || ""}`;
    return /pok[eé]mon/i.test(text) && /\b(tcg|trading card|cards?|booster|elite trainer|\betb\b|collection box|promo card|mini tin|lottery|giveaway|raffle|sweepstakes)\b/i.test(text);
  }

  function visibleProducts() {
    return state.products.filter((item) => {
      const stock = String(item.stockState || "UNKNOWN").toUpperCase();
      if (state.tab === "in-stock" && stock !== "IN_STOCK") return false;
      if (state.tab === "preorder" && stock !== "PREORDER") return false;
      if (state.tab === "out-of-stock" && stock !== "OUT_OF_STOCK") return false;
      const retailer = item.retailer || "Other";
      if (state.retailer !== "all" && retailer !== state.retailer) return false;
      const haystack = `${item.name || ""} ${item.retailer || ""} ${item.setName || ""} ${item.sku || ""}`.toLowerCase();
      return haystack.includes(state.query);
    }).sort((a, b) => {
      const rank = { IN_STOCK: 0, PREORDER: 1, OUT_OF_STOCK: 2, UNKNOWN: 3, BLOCKED: 4 };
      const diff = (rank[String(a.stockState || "UNKNOWN").toUpperCase()] ?? 5) - (rank[String(b.stockState || "UNKNOWN").toUpperCase()] ?? 5);
      return diff || (Date.parse(b.lastCheckedAt || "") || 0) - (Date.parse(a.lastCheckedAt || "") || 0);
    });
  }

  function productCard(item) {
    const card = make("article", "product-card");
    const imageWrap = make("div", "product-image");
    const imageUrl = validUrl(item.imageUrl);
    if (imageUrl) {
      const image = make("img"); image.src = imageUrl; image.alt = item.name || "Pokémon TCG product"; image.loading = "lazy"; image.decoding = "async";
      image.addEventListener("error", () => { image.replaceWith(make("div", "image-fallback", "✦")); }, { once: true }); imageWrap.append(image);
    } else imageWrap.append(make("div", "image-fallback", "✦"));

    const content = make("div", "product-content");
    const meta = make("div", "product-meta");
    meta.append(make("span", "retailer-name", esc(item.retailer || "RETAILER")));
    const [label, badgeClass] = availability(item.stockState);
    meta.append(make("span", `stock-badge ${badgeClass}`, label));
    const title = make("h3", "product-title", esc(item.name || "Pokémon TCG product"));
    const details = make("div", "product-details");
    details.append(make("span", "product-price", esc(item.price || "Price not listed")));
    details.append(make("span", "product-check", `CHECKED ${ago(item.lastCheckedAt)}`));
    const link = make("a", `product-action${validUrl(item.productUrl) ? "" : " disabled"}`, validUrl(item.productUrl) ? "OPEN RETAILER PRODUCT" : "PRODUCT LINK UNAVAILABLE");
    if (validUrl(item.productUrl)) { link.href = validUrl(item.productUrl); link.target = "_blank"; link.rel = "noopener noreferrer"; }
    else { link.href = "#"; link.setAttribute("aria-disabled", "true"); }
    content.append(meta, title, details, link);
    card.append(imageWrap, content);
    return card;
  }

  function renderProducts() {
    const grid = $("#product-grid"); grid.replaceChildren();
    const filtered = visibleProducts();
    $("#stat-total").textContent = state.products.length;
    $("#stat-stock").textContent = state.products.filter((item) => item.stockState === "IN_STOCK").length;
    $("#stat-preorder").textContent = state.products.filter((item) => item.stockState === "PREORDER").length;
    const reached = Number(state.status?.retailersReached || 0);
    const total = Number(state.status?.retailersChecked || 0);
    $("#stat-retailers").textContent = `${reached}/${total || 0}`;
    $("#stat-health").textContent = total ? "Retailer searches responding" : "No cloud scan published";
    $("#count-all").textContent = state.products.length;
    $("#count-stock").textContent = state.products.filter((item) => item.stockState === "IN_STOCK").length;
    $("#count-preorder").textContent = state.products.filter((item) => item.stockState === "PREORDER").length;
    $("#count-sold").textContent = state.products.filter((item) => item.stockState === "OUT_OF_STOCK").length;
    if (!filtered.length) {
      const empty = make("div", "empty-state");
      empty.append(make("div", "empty-icon", "✦"));
      empty.append(make("strong", "", state.products.length ? "NO LISTINGS MATCH THIS FILTER" : "NO VERIFIED STOCK LISTINGS YET"));
      empty.append(make("p", "", state.products.length ? "Try another stock filter, retailer or search term." : "The hosted checker has not published a verified retailer product page yet. This area will not fill with news articles or guessed stock statuses."));
      grid.append(empty);
    } else filtered.forEach((item) => grid.append(productCard(item)));
    renderRetailers();
  }

  function renderRetailers() {
    const select = $("#retailer-select");
    const current = state.retailer;
    const retailers = [...new Set(state.products.map((item) => item.retailer).filter(Boolean))].sort();
    select.replaceChildren(new Option("All retailers", "all"));
    retailers.forEach((name) => select.append(new Option(name, name)));
    select.value = retailers.includes(current) ? current : "all";
    state.retailer = select.value;
  }

  function renderDiagnostics() {
    const panel = $("#diagnostics-content"); panel.replaceChildren();
    if (!state.status) { panel.textContent = "Waiting for the first hosted retailer scan."; return; }
    const summary = make("p", "", `SCAN ${prettyDate(state.status.lastScanAt)} · ${state.status.productsChecked || 0} PRODUCT PAGES CHECKED · ${state.status.productsVerified || 0} AVAILABILITY SIGNALS VERIFIED · ${state.status.alertsSent || 0} ALERT(S) SENT THIS RUN`);
    panel.append(summary);
    const health = make("div", "health-grid");
    (state.status.sources || []).forEach((source) => {
      const item = make("div", "health-item");
      item.append(make("strong", "", `${source.ok ? "●" : "○"} ${source.retailer}`));
      item.append(make("span", "", `${source.productsFound || 0} listings · ${source.pagesChecked || 0} checked · ${source.error || (source.ok ? "Search reached" : "No response")}`));
      health.append(item);
    });
    panel.append(health);
    if (state.status.note) panel.append(make("p", "", state.status.note));
  }

  function setNotice(message, type = "") {
    const notice = $("#monitor-notice"); notice.className = `notice-line ${type}`; notice.replaceChildren(make("span", "notice-dot"), document.createTextNode(message));
  }

  function updateHeader() {
    const stamp = state.status?.lastScanAt;
    $("#header-scan-time").textContent = stamp ? `LAST CLOUD SCAN ${prettyDate(stamp).toUpperCase()}` : "WAITING FOR FIRST SCAN";
    $("#last-updated").textContent = stamp ? `LAST CHECK ${ago(stamp)}` : "LAST CHECK —";
    const total = Number(state.status?.retailersChecked || 0);
    const ok = Number(state.status?.retailersReached || 0);
    if (!stamp) setNotice("No hosted stock scan has been published yet. The next successful GitHub Actions run will appear here.", "warn");
    else if (state.status?.errors?.length || (total && ok === 0)) setNotice(`Last cloud scan reached ${ok} of ${total} retailer search sources. Some stores may be blocking automated requests; those are not treated as sold out.`, "warn");
    else if (state.products.some((item) => item.stockState === "IN_STOCK" || item.stockState === "PREORDER")) setNotice(`Stock scan completed ${ago(stamp)}. Green / preorder labels are based on product-page availability signals. Confirm price and stock at the retailer.`, "good");
    else setNotice(`Stock scan completed ${ago(stamp)}. No verified in-stock or preorder listings were found in the checked product pages.`, "");
  }

  function renderCommunity() {
    const grid = $("#community-grid"); grid.replaceChildren();
    const items = state.community === "giveaways"
      ? state.raffles.filter((item) => item && item.title && relevantPokemonPost(item)).slice(0, 9)
      : state.posts.filter((item) => item && item.title && relevantPokemonPost(item)).slice(0, 9);
    if (!items.length) {
      const empty = make("div", "empty-state");
      empty.append(make("strong", "", state.community === "giveaways" ? "NO QUALIFIED GIVEAWAY LEADS" : "NO RECENT TCG NEWS"));
      empty.append(make("p", "", "The current public-source search did not return a matching item. This section is separate from verified product stock."));
      grid.append(empty); return;
    }
    items.forEach((item) => {
      const card = make("article", "community-card");
      const meta = make("div", "community-meta");
      meta.append(make("span", "", esc(item.source || item.siteName || "COMMUNITY SOURCE")));
      if (state.community === "giveaways") meta.append(make("span", "community-status", esc(item.status || "VERIFY").toUpperCase()));
      card.append(meta, make("h3", "", esc(item.title)), make("p", "", esc(item.summary || item.statusNote || "Open the original announcement for the complete details.")));
      const url = state.community === "giveaways" ? (validUrl(item.entryUrl) || validUrl(item.entrySearchUrl) || validUrl(item.sourceUrl) || validUrl(item.url)) : (validUrl(item.sourceUrl) || validUrl(item.url));
      if (url) {
        const link = make("a", "community-link", state.community === "giveaways" ? (validUrl(item.entryUrl) ? "OPEN VERIFIED ENTRY ↗" : "SEARCH ENTRY DETAILS ↗") : "READ SOURCE ↗");
        link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; card.append(link);
      }
      grid.append(card);
    });
  }

  async function loadJson(path, fallback) {
    try { const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" }); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return await response.json(); }
    catch (error) { console.warn(`PokeDrop could not load ${path}:`, error); return fallback; }
  }

  async function refresh() {
    const [products, status, posts, raffles] = await Promise.all([
      loadJson("products.json", []), loadJson("product-status.json", null), loadJson("posts.json", []), loadJson("raffles.json", [])
    ]);
    state.products = Array.isArray(products) ? products.filter((item) => item && item.productUrl && validUrl(item.productUrl)) : [];
    state.status = status && typeof status === "object" ? status : null;
    state.posts = Array.isArray(posts) ? posts.filter(relevantPokemonPost) : [];
    state.raffles = Array.isArray(raffles) ? raffles.filter((item) => item.qualificationStatus !== "rejected") : [];
    renderProducts(); renderDiagnostics(); renderCommunity(); updateHeader();
  }

  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    state.tab = button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((item) => { const active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); });
    renderProducts();
  }));
  document.querySelectorAll("[data-community]").forEach((button) => button.addEventListener("click", () => {
    state.community = button.dataset.community;
    document.querySelectorAll("[data-community]").forEach((item) => { const active = item === button; item.classList.toggle("is-active", active); item.setAttribute("aria-pressed", String(active)); });
    renderCommunity();
  }));
  $("#search-input").addEventListener("input", (event) => { state.query = event.target.value.trim().toLowerCase(); renderProducts(); });
  $("#retailer-select").addEventListener("change", (event) => { state.retailer = event.target.value; renderProducts(); });
  refresh();
  window.setInterval(refresh, 60000);
})();
