// PokeDrop stock listings share the existing Drop Finder feed and its filters.
// This file adds only a stock-state button group beside the existing retailer filter.
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  };
  const httpUrl = (value) => {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch { return ""; }
  };
  const dateValue = (value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  };
  const ageLabel = (value) => {
    const date = dateValue(value);
    if (!date) return "CHECK TIME UNKNOWN";
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "JUST CHECKED";
    if (minutes < 60) return `${minutes}M AGO`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}H AGO`;
    return `${Math.floor(minutes / 1440)}D AGO`;
  };
  const dateLabel = (value) => {
    const date = dateValue(value);
    return date ? date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "NOT CHECKED";
  };

  const feed = $("#feed");
  const search = $("#search");
  const retailerFilter = $("#retailer-filter");
  const searchControls = $(".search-controls");
  const resultCount = $("#result-count");
  const diagnostics = $("#feed-diagnostics-content");
  if (!feed || !search || !retailerFilter || !searchControls) return;

  // Keep the original search box and retailer dropdown. No second search input,
  // no second retailer dropdown, and no separate stock feed or section is created.
  const stateWrap = make("div", "stock-state-wrap");
  stateWrap.id = "stock-state-filter-wrap";
  stateWrap.append(make("span", "control-label", "STOCK STATUS"));
  const stateButtons = make("div", "stock-state-buttons");
  stateButtons.setAttribute("role", "group");
  stateButtons.setAttribute("aria-label", "Filter the feed by verified product stock status");
  const states = [
    ["ALL STATES", "all"],
    ["IN STOCK", "IN_STOCK"],
    ["PREORDER", "PREORDER"],
    ["SOLD OUT", "OUT_OF_STOCK"]
  ];
  let selectedState = "all";
  for (const [label, value] of states) {
    const button = make("button", "stock-state-button", label);
    button.type = "button";
    button.dataset.stockState = value;
    button.setAttribute("aria-pressed", String(value === selectedState));
    button.addEventListener("click", () => {
      selectedState = value;
      stateButtons.querySelectorAll("button[data-stock-state]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item.dataset.stockState === selectedState));
      });
      renderIntoUnifiedFeed();
    });
    stateButtons.append(button);
  }
  stateWrap.append(stateButtons);
  searchControls.append(stateWrap);

  const styles = document.createElement("style");
  styles.textContent = `
    .search-controls { grid-template-columns: minmax(0, 1fr) minmax(170px, .55fr) minmax(300px, 1fr); align-items: end; }
    .stock-state-wrap { display: grid; min-width: 0; gap: 6px; }
    .stock-state-buttons { display: flex; min-height: 46px; align-items: stretch; flex-wrap: wrap; gap: 6px; }
    .stock-state-button { min-height: 42px; padding: 6px 9px; color: var(--ink); background: var(--white); border: 2px solid var(--ink); box-shadow: 3px 3px 0 var(--paper-shadow); cursor: pointer; font: inherit; font-size: 8px; line-height: 1.45; }
    .stock-state-button[aria-pressed="true"] { color: var(--white); background: var(--deep); box-shadow: 3px 3px 0 #8a9a78; }
    .stock-state-button:hover:not([aria-pressed="true"]) { background: #e8edcf; }
    .stock-product-card { min-width: 0; }
    .stock-product-image { display: block; width: 100%; max-height: 190px; margin: 11px 0 13px; object-fit: contain; background: var(--white); border: 2px solid var(--ink); }
    .stock-product-details { display: grid; gap: 4px; margin: 0 0 10px; padding: 9px 10px; color: var(--deep); background: rgba(228,223,190,.48); border: 2px dashed #9a997e; font-size: 8px; line-height: 1.8; overflow-wrap: anywhere; }
    .stock-product-details strong { color: var(--ink); font-weight: normal; }
    .stock-product-note { margin: 8px 0 0; color: var(--muted); font-size: 8px; line-height: 1.8; }
    .stock-product-tag.stock-state-in { color: #fff; background: #347b43; }
    .stock-product-tag.stock-state-pre { color: var(--ink); background: var(--gold); }
    .stock-product-tag.stock-state-out { color: #fff; background: var(--red-dark); }
    .stock-product-tag.stock-state-unknown { color: #fff; background: #5c6670; }
    .stock-empty-state { grid-column: 1 / -1; }
    @media (max-width: 760px) {
      .search-controls { grid-template-columns: minmax(0, 1fr) minmax(250px, 1.15fr); }
      .search-wrap { grid-column: 1 / -1; }
      .stock-state-buttons { min-height: 42px; }
    }
    @media (max-width: 560px) {
      .search-controls { grid-template-columns: 1fr; }
      .search-wrap { grid-column: auto; }
      .stock-state-buttons { min-height: 0; }
      .stock-state-button { flex: 1 1 calc(50% - 6px); min-height: 38px; }
      .stock-product-image { max-height: 175px; }
    }
  `;
  document.head.append(styles);

  let products = [];
  let scanStatus = null;
  let refreshBusy = false;
  let renderQueued = false;
  let diagnosticsObserver = null;

  function selectedCategory() {
    const raffleButton = $("#raffle-category-button");
    if (raffleButton?.getAttribute("aria-pressed") === "true") return "Raffle";
    const active = $(".category-nav .category-button[aria-pressed=\"true\"]");
    return active?.dataset.value || "All";
  }

  function productBelongsToCategory(item, category) {
    const stockState = String(item.stockState || "UNKNOWN").toUpperCase();
    if (category === "All") return true;
    if (category === "Restock") return stockState !== "PREORDER";
    if (category === "Deals") return stockState === "PREORDER";
    return false;
  }

  function selectedProducts() {
    const category = selectedCategory();
    const query = search.value.trim().toLowerCase();
    const retailer = retailerFilter.value;
    return products.filter((item) => {
      const stockState = String(item.stockState || "UNKNOWN").toUpperCase();
      if (selectedState !== "all" && stockState !== selectedState) return false;
      if (retailer !== "all" && String(item.retailer || "") !== retailer) return false;
      if (!productBelongsToCategory(item, category)) return false;
      const haystack = `${item.name || ""} ${item.retailer || ""} ${item.setName || ""} ${item.sku || ""}`.toLowerCase();
      return haystack.includes(query);
    }).sort((a, b) => {
      const rank = { IN_STOCK: 0, PREORDER: 1, OUT_OF_STOCK: 2, UNKNOWN: 3 };
      return (rank[String(a.stockState || "UNKNOWN").toUpperCase()] ?? 4)
        - (rank[String(b.stockState || "UNKNOWN").toUpperCase()] ?? 4)
        || (Date.parse(b.lastCheckedAt || "") || 0) - (Date.parse(a.lastCheckedAt || "") || 0);
    });
  }

  function statePresentation(value) {
    const state = String(value || "UNKNOWN").toUpperCase();
    if (state === "IN_STOCK") return ["IN STOCK", "stock-state-in"];
    if (state === "PREORDER") return ["PREORDER", "stock-state-pre"];
    if (state === "OUT_OF_STOCK") return ["SOLD OUT", "stock-state-out"];
    return ["UNCONFIRMED", "stock-state-unknown"];
  }

  function productCard(item) {
    const stockState = String(item.stockState || "UNKNOWN").toUpperCase();
    const [label, stateClass] = statePresentation(stockState);
    const category = stockState === "PREORDER" ? "Deals" : "Restock";
    const card = make("article", "post-card stock-product-card");
    card.dataset.stockProduct = "true";
    card.dataset.category = category;

    const meta = make("div", "post-topline");
    const tag = make("span", `tag stock-product-tag ${stateClass}`, label);
    tag.dataset.category = category;
    meta.append(tag);
    if (item.retailer) meta.append(make("span", "retailer-tag", String(item.retailer).toUpperCase()));
    meta.append(make("time", "post-date", ageLabel(item.lastCheckedAt)));

    const title = make("h3", "", String(item.name || "POKÉMON TCG PRODUCT").toUpperCase().replace(/É/g, "é"));
    card.append(meta, title);

    const imageUrl = httpUrl(item.imageUrl);
    if (imageUrl) {
      const image = make("img", "stock-product-image");
      image.src = imageUrl;
      image.alt = item.name || "Pokémon TCG product";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", () => image.remove(), { once: true });
      card.append(image);
    }

    const details = make("div", "stock-product-details");
    const price = make("div", "");
    price.append(make("strong", "", "PRICE:"), document.createTextNode(` ${item.price || "NOT LISTED"}`));
    details.append(price);
    const lastCheck = make("div", "");
    lastCheck.append(make("strong", "", "LAST CHECK:"), document.createTextNode(` ${dateLabel(item.lastCheckedAt)}`));
    details.append(lastCheck);
    if (item.availabilitySource) {
      const source = make("div", "");
      source.append(make("strong", "", "SIGNAL:"), document.createTextNode(` ${item.availabilitySource === "structured-data" ? "RETAILER PRODUCT DATA" : "PUBLIC PRODUCT PAGE TEXT"}`));
      details.append(source);
    }
    card.append(details);

    const productUrl = httpUrl(item.productUrl);
    if (productUrl) {
      const link = make("a", "post-action", `OPEN ${String(item.retailer || "RETAILER").toUpperCase()} PRODUCT PAGE`);
      link.href = productUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link);
    }

    let note = "Availability is based on the public retailer product page at the last check.";
    if (stockState === "UNKNOWN") note = "The retailer product page was identified, but it did not expose a clear stock signal. It is not counted as in stock or sold out.";
    if (item.lastCheckStatus && item.lastCheckStatus !== "OK") {
      note += ` Latest check: ${item.lastCheckStatus}. The previous verified stock state is retained.`;
      if (item.lastError) note += ` ${item.lastError}`;
    }
    card.append(make("p", "stock-product-note", note));
    return card;
  }

  function makeEmptyState() {
    const empty = make("div", "empty-state stock-empty-state");
    empty.append(make("strong", "", "NO VERIFIED PRODUCT LISTINGS MATCH THIS FILTER"));
    empty.append(make("p", "", "Try All States, another retailer, or a different search. News and giveaway alerts remain available when All States is selected."));
    return empty;
  }

  function updateResultCount() {
    if (!resultCount) return;
    const count = [...feed.querySelectorAll(":scope > .post-card")].filter((card) => !card.hidden).length;
    resultCount.textContent = String(count);
  }

  function renderIntoUnifiedFeed() {
    const chosenState = selectedState;
    const category = selectedCategory();
    const matches = selectedProducts();

    // The original cards stay in the original feed. Choosing a specific stock state
    // narrows the feed to verified product listings; All States restores news/giveaways.
    for (const card of feed.querySelectorAll(":scope > .post-card:not(.stock-product-card)")) {
      card.hidden = chosenState !== "all";
    }
    for (const empty of feed.querySelectorAll(":scope > .empty-state:not(.stock-empty-state)")) {
      empty.hidden = chosenState !== "all" || matches.length > 0;
    }
    for (const card of feed.querySelectorAll(":scope > .stock-product-card, :scope > .stock-empty-state")) card.remove();

    const fragment = document.createDocumentFragment();
    matches.forEach((item) => fragment.append(productCard(item)));
    if (matches.length) {
      feed.prepend(fragment);
    } else if (chosenState !== "all") {
      feed.append(makeEmptyState());
    }

    updateResultCount();
  }

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    window.setTimeout(() => {
      renderQueued = false;
      renderIntoUnifiedFeed();
    }, 0);
  }

  function observeFeed() {
    if (!("MutationObserver" in window)) return;
    const observer = new MutationObserver((records) => {
      const containsFeedContentChange = records.some((record) => {
        const changedNodes = [...record.addedNodes, ...record.removedNodes];
        return changedNodes.some((node) => {
          if (!(node instanceof HTMLElement)) return true;
          return !node.classList.contains("stock-product-card") && !node.classList.contains("stock-empty-state");
        });
      });
      if (containsFeedContentChange) scheduleRender();
    });
    observer.observe(feed, { childList: true });
  }

  function addDiagnostics() {
    if (!diagnostics) return;
    let line = $("#stock-scan-diagnostics", diagnostics);
    if (!line) {
      line = make("p", "diagnostics-summary");
      line.id = "stock-scan-diagnostics";
      diagnostics.append(line);
    }
    let message = "STOCK CHECKS: WAITING FOR THE FIRST HOSTED RETAILER SCAN.";
    if (scanStatus) {
      const stockCounts = products.reduce((counts, item) => {
        const state = String(item.stockState || "UNKNOWN").toUpperCase();
        counts[state] = (counts[state] || 0) + 1;
        return counts;
      }, {});
      message = `STOCK CHECKS: ${scanStatus.productsChecked || 0} PRODUCT PAGES CHECKED · ${scanStatus.productsVerified || 0} STOCK SIGNALS READ · ${products.length} LISTINGS TRACKED · ${stockCounts.IN_STOCK || 0} IN STOCK · ${stockCounts.PREORDER || 0} PREORDER · ${stockCounts.OUT_OF_STOCK || 0} SOLD OUT · ${scanStatus.alertsSent || 0} DISCORD ALERTS SENT`;
    }
    if (line.textContent !== message) line.textContent = message;
  }

  async function loadJson(path, fallback) {
    try {
      const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn(`PokeDrop stock status could not load ${path}:`, error);
      return fallback;
    }
  }

  async function refreshStockData() {
    if (refreshBusy) return;
    refreshBusy = true;
    try {
      const [nextProducts, nextStatus] = await Promise.all([
        loadJson("products.json", []),
        loadJson("product-status.json", null)
      ]);
      products = Array.isArray(nextProducts)
        ? nextProducts.filter((item) => item && item.name && item.retailer && httpUrl(item.productUrl))
        : [];
      scanStatus = nextStatus && typeof nextStatus === "object" ? nextStatus : null;
      renderIntoUnifiedFeed();
      addDiagnostics();
    } finally {
      refreshBusy = false;
    }
  }

  observeFeed();
  if (diagnostics && "MutationObserver" in window) {
    diagnosticsObserver = new MutationObserver(() => {
      window.setTimeout(addDiagnostics, 0);
    });
    diagnosticsObserver.observe(diagnostics, { childList: true, subtree: true });
  }
  refreshStockData();
  window.setInterval(refreshStockData, 90000);
})();
