// PokeDrop stock integration.
// Retailer products are normalized into the same posts array consumed by app.js.
// app.js remains the only feed/card renderer; this file adds only the stock filter.
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const feed = $("#feed");
  const searchControls = $(".search-controls");
  const resultCount = $("#result-count");
  if (!feed || !searchControls) return;

  const nativeFetch = window.fetch.bind(window);
  const normalize = (value) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const validUrl = (value) => {
    try {
      const url = new URL(value, window.location.href);
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch { return ""; }
  };
  const canonicalUrl = (value) => {
    const url = validUrl(value);
    return url ? url.split(/[?#]/)[0].replace(/\/$/, "").toLowerCase() : "";
  };
  const stateLabel = (state) => ({
    IN_STOCK: "IN STOCK",
    PREORDER: "PREORDER",
    OUT_OF_STOCK: "SOLD OUT",
    UNKNOWN: "UNCONFIRMED"
  })[String(state || "UNKNOWN").toUpperCase()] || "UNCONFIRMED";
  const availabilityLabel = (state) => ({
    IN_STOCK: "In Stock",
    PREORDER: "Preorder",
    OUT_OF_STOCK: "Sold Out",
    UNKNOWN: "Unconfirmed"
  })[String(state || "UNKNOWN").toUpperCase()] || "Unconfirmed";
  const safeDate = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
  };

  const stateWrap = document.createElement("div");
  stateWrap.className = "stock-state-wrap";
  stateWrap.id = "stock-state-filter-wrap";
  const stateLabelNode = document.createElement("span");
  stateLabelNode.className = "control-label";
  stateLabelNode.textContent = "STOCK STATUS";
  const stateButtons = document.createElement("div");
  stateButtons.className = "stock-state-buttons";
  stateButtons.setAttribute("role", "group");
  stateButtons.setAttribute("aria-label", "Filter non-raffle feed alerts by product stock status");
  const stockStates = [
    ["ALL STATES", "all"],
    ["IN STOCK", "IN_STOCK"],
    ["PREORDER", "PREORDER"],
    ["SOLD OUT", "OUT_OF_STOCK"]
  ];
  let selectedState = "all";

  for (const [label, value] of stockStates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stock-state-button";
    button.dataset.stockState = value;
    button.setAttribute("aria-pressed", String(value === selectedState));
    button.textContent = label;
    button.addEventListener("click", () => {
      selectedState = value;
      stateButtons.querySelectorAll("button[data-stock-state]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item.dataset.stockState === selectedState));
      });
      applyStockFilter();
    });
    stateButtons.append(button);
  }
  stateWrap.append(stateLabelNode, stateButtons);
  searchControls.append(stateWrap);

  const style = document.createElement("style");
  style.textContent = `
    .search-controls { grid-template-columns: minmax(0, 1fr) minmax(170px, .55fr) minmax(300px, 1fr); align-items: end; }
    .stock-state-wrap { display:grid; min-width:0; gap:6px; }
    .stock-state-wrap[hidden], .post-card[hidden] { display:none !important; }
    .stock-state-buttons { display:flex; min-height:46px; align-items:stretch; flex-wrap:wrap; gap:6px; }
    .stock-state-button { min-height:42px; padding:6px 9px; color:var(--ink); background:var(--white); border:2px solid var(--ink); box-shadow:3px 3px 0 var(--paper-shadow); cursor:pointer; font:inherit; font-size:8px; line-height:1.45; }
    .stock-state-button[aria-pressed="true"] { color:var(--white); background:var(--deep); box-shadow:3px 3px 0 #8a9a78; }
    .stock-state-button:hover:not([aria-pressed="true"]) { background:#e8edcf; }
    .stock-state-tag { display:inline-flex; align-items:center; padding:3px 6px; border:1px solid var(--ink); font-size:7px; line-height:1.5; white-space:nowrap; }
    .stock-state-tag.in-stock { color:#fff; background:#347b43; }
    .stock-state-tag.preorder { color:var(--ink); background:var(--gold); }
    .stock-state-tag.sold-out { color:#fff; background:#a83c35; }
    .stock-state-tag.unknown { color:#fff; background:#5c6670; }
    .stock-filter-empty { grid-column:1 / -1; }
    @media (max-width:760px) {
      .search-controls { grid-template-columns:minmax(0, 1fr) minmax(250px, 1.15fr); }
      .search-wrap { grid-column:1 / -1; }
      .stock-state-buttons { min-height:42px; }
    }
    @media (max-width:560px) {
      .search-controls { grid-template-columns:1fr; }
      .search-wrap { grid-column:auto; }
      .stock-state-buttons { min-height:0; }
      .stock-state-button { flex:1 1 calc(50% - 6px); min-height:38px; }
    }
  `;
  document.head.append(style);

  let lastStockRecords = [];
  let stockByTitle = new Map();
  let renderQueued = false;

  function normalizeProduct(product) {
    const productUrl = validUrl(product?.productUrl);
    if (!productUrl || !product?.name || !product?.retailer) return null;
    const state = String(product.stockState || "UNKNOWN").toUpperCase();
    if (!["IN_STOCK", "PREORDER", "OUT_OF_STOCK", "UNKNOWN"].includes(state)) return null;
    const checkedAt = safeDate(product.lastCheckedAt || product.firstSeenAt);
    const retailer = String(product.retailer).trim();
    const name = String(product.name).trim();
    const summaryParts = [`${retailer} product listing.`];
    if (product.price) summaryParts.push(`Listed price: ${product.price}.`);
    summaryParts.push(`Last retailer page check: ${new Date(checkedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`);
    if (state === "UNKNOWN") summaryParts.push("The page did not expose a confirmed availability signal; this is not a sold-out result.");
    if (product.lastCheckStatus && product.lastCheckStatus !== "OK") {
      summaryParts.push(`Latest check: ${product.lastCheckStatus}. The displayed status is the last retained product-page signal.`);
    }
    return {
      date: checkedAt,
      cat: state === "PREORDER" ? "Deals" : "Restock",
      title: name,
      summary: summaryParts.join(" "),
      text: `${retailer} ${name} ${stateLabel(state)}`,
      source: retailer,
      store: retailer,
      // Let raffle-ui.js build the retailer product action from productUrl.
      // Do not use the product page as a "source announcement" link.
      url: "",
      sourceUrl: "",
      productUrl,
      productName: name,
      productPrice: product.price || "",
      productAvailability: availabilityLabel(state),
      productRetailer: retailer,
      imageUrl: product.imageUrl || "",
      imageUrls: product.imageUrl ? [{ url: product.imageUrl, label: "RETAILER PRODUCT IMAGE", alt: name, kind: "product" }] : [],
      stockState: state,
      stockLastCheckedAt: checkedAt,
      stockCheckStatus: product.lastCheckStatus || "OK",
      stockLastError: product.lastError || "",
      stockMonitorItem: true
    };
  }

  function postProductUrls(post) {
    const values = [post?.productUrl];
    for (const entry of Array.isArray(post?.productLinks) ? post.productLinks : []) values.push(entry?.url);
    return values.map(canonicalUrl).filter(Boolean);
  }

  function buildUnifiedPosts(posts, products) {
    const unified = (Array.isArray(posts) ? posts : []).map((post) => ({ ...post }));
    const byProductUrl = new Map();
    const byProductName = new Map();
    unified.forEach((post) => {
      for (const url of postProductUrls(post)) byProductUrl.set(url, post);
      const productName = normalize(post.productName);
      if (productName) byProductName.set(productName, post);
      const directState = String(post.stockState || "").toUpperCase();
      if (["IN_STOCK", "PREORDER", "OUT_OF_STOCK", "UNKNOWN"].includes(directState)) {
        post.stockState = directState;
      }
    });

    const annotations = new Map();
    lastStockRecords = (Array.isArray(products) ? products : []).map(normalizeProduct).filter(Boolean);
    const nameCounts = new Map();
    for (const product of lastStockRecords) {
      const key = normalize(product.productName);
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
    for (const product of lastStockRecords) {
      const urlKey = canonicalUrl(product.productUrl);
      const nameKey = normalize(product.productName);
      // Only merge by name when the monitor found one retailer listing for that
      // product. Multiple retailers must remain separate normal feed entries.
      let existing = byProductUrl.get(urlKey) || (nameCounts.get(nameKey) === 1 ? byProductName.get(nameKey) : null);
      if (!existing && nameCounts.get(nameKey) === 1) {
        existing = unified.find((post) => normalize(post.title) === nameKey) || null;
      }
      if (existing) {
        Object.assign(existing, {
          stockState: product.stockState,
          stockProductUrl: product.productUrl,
          stockProductName: product.productName,
          stockPrice: product.productPrice,
          stockRetailer: product.productRetailer,
          stockLastCheckedAt: product.stockLastCheckedAt,
          stockCheckStatus: product.stockCheckStatus,
          stockLastError: product.stockLastError,
          productUrl: product.productUrl,
          productName: product.productName,
          productPrice: product.productPrice,
          productAvailability: product.productAvailability,
          productRetailer: product.productRetailer,
          store: product.productRetailer
        });
        const key = normalize(existing.title);
        if (key) {
          if (!annotations.has(key)) annotations.set(key, []);
          annotations.get(key).push(product);
        }
      } else {
        unified.push(product);
        const key = normalize(product.title);
        if (key) {
          if (!annotations.has(key)) annotations.set(key, []);
          annotations.get(key).push(product);
        }
      }
    }

    for (const post of unified) {
      const key = normalize(post.title);
      const state = String(post.stockState || "").toUpperCase();
      if (key && ["IN_STOCK", "PREORDER", "OUT_OF_STOCK", "UNKNOWN"].includes(state)) {
        if (!annotations.has(key)) annotations.set(key, []);
        if (!annotations.get(key).some((item) => item.stockState === state && normalize(item.productRetailer || item.retailer) === normalize(post.stockRetailer || post.store))) {
          annotations.get(key).push({
            stockState: state,
            productRetailer: post.stockRetailer || post.store || post.productRetailer || "",
            productName: post.stockProductName || post.productName || post.title,
            stockLastCheckedAt: post.stockLastCheckedAt || ""
          });
        }
      }
    }
    stockByTitle = annotations;
    return unified;
  }

  async function loadStockProducts() {
    try {
      const response = await nativeFetch(`products.json?stock-filter=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.warn("PokeDrop stock products unavailable:", error);
      return [];
    }
  }
  const productsPromise = loadStockProducts();

  // Intercept only posts.json. The retailer records become ordinary post objects,
  // so app.js builds them with the same card renderer and feed layout as every alert.
  window.fetch = async (input, init) => {
    const response = await nativeFetch(input, init);
    const requestUrl = typeof input === "string" ? input : input?.url || "";
    let isPostsRequest = false;
    try { isPostsRequest = new URL(requestUrl, window.location.href).pathname.endsWith("/posts.json"); }
    catch { /* leave non-post requests unchanged */ }
    if (!isPostsRequest || !response.ok) return response;
    try {
      const [posts, products] = await Promise.all([response.clone().json(), productsPromise]);
      const unified = buildUnifiedPosts(posts, products);
      return new Response(JSON.stringify(unified), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    } catch (error) {
      console.warn("PokeDrop could not merge stock listings into the feed:", error);
      return response;
    }
  };

  function activeCategory() {
    const raffleButton = $("#raffle-category-button");
    if (raffleButton?.getAttribute("aria-pressed") === "true") return "Raffle";
    const active = $(".category-nav .category-button[aria-pressed=\"true\"]");
    return active?.dataset.value || "All";
  }

  function selectStockRecord(title, retailer) {
    const records = stockByTitle.get(normalize(title)) || [];
    if (!records.length) return null;
    const retailerKey = normalize(retailer);
    return records.find((item) => retailerKey && normalize(item.productRetailer || item.retailer) === retailerKey)
      || (records.length === 1 ? records[0] : records[0]);
  }

  function stateClass(state) {
    if (state === "IN_STOCK") return "in-stock";
    if (state === "PREORDER") return "preorder";
    if (state === "OUT_OF_STOCK") return "sold-out";
    return "unknown";
  }

  function applyStockFilter() {
    const category = activeCategory();
    stateWrap.hidden = category === "Raffle";
    const cards = [...feed.querySelectorAll(":scope > .post-card")];
    let visibleCount = 0;

    for (const card of cards) {
      const isRaffle = card.dataset.category === "Raffle" || card.classList.contains("raffle-card");
      if (isRaffle) {
        card.hidden = false;
        visibleCount++;
        continue;
      }

      const heading = card.querySelector("h3")?.textContent || "";
      const retailer = card.querySelector(".retailer-tag")?.textContent || "";
      const record = selectStockRecord(heading, retailer);
      const state = String(record?.stockState || card.dataset.stockState || "").toUpperCase();
      if (record) {
        card.dataset.stockState = state;
        const meta = card.querySelector(".post-topline");
        if (meta && !meta.querySelector(".stock-state-tag")) {
          const badge = document.createElement("span");
          badge.className = `stock-state-tag ${stateClass(state)}`;
          badge.textContent = stateLabel(state);
          meta.append(badge);
        }
      }

      card.hidden = selectedState !== "all" && state !== selectedState;
      if (!card.hidden) visibleCount++;
    }

    const existingEmpty = $("#stock-filter-empty-state", feed);
    const appEmpty = feed.querySelector(":scope > .empty-state:not(#stock-filter-empty-state)");
    if (existingEmpty) existingEmpty.remove();
    if (selectedState !== "all" && category !== "Raffle" && visibleCount === 0 && !appEmpty) {
      const empty = document.createElement("div");
      empty.id = "stock-filter-empty-state";
      empty.className = "empty-state stock-filter-empty";
      const title = document.createElement("strong");
      title.textContent = `NO ${stateLabel(selectedState)} ALERTS FOUND`;
      const note = document.createElement("p");
      note.textContent = "No existing feed item has a matching verified retailer stock signal. Try ALL STATES; raffle and giveaway entries use their separate entry-status filter.";
      empty.append(title, note);
      feed.append(empty);
    }
    if (resultCount) resultCount.textContent = String(visibleCount);
  }

  function scheduleApply() {
    if (renderQueued) return;
    renderQueued = true;
    window.setTimeout(() => {
      renderQueued = false;
      applyStockFilter();
    }, 0);
  }

  const categoryNav = $(".category-nav");
  categoryNav?.addEventListener("click", scheduleApply);
  $("#raffle-category-button")?.addEventListener("click", scheduleApply);
  if ("MutationObserver" in window) {
    const observer = new MutationObserver((records) => {
      const changed = records.some((record) => record.type === "childList");
      if (changed) scheduleApply();
    });
    observer.observe(feed, { childList: true, subtree: true });
  }
  applyStockFilter();
})();
