(() => {
  "use strict";

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
  const fmtDate = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "NOT CHECKED" : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const ago = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "TIME UNKNOWN";
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "JUST CHECKED";
    if (minutes < 60) return `${minutes}M AGO`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}H AGO`;
    return `${Math.floor(minutes / 1440)}D AGO`;
  };

  const style = document.createElement("style");
  style.textContent = `
    .stock-radar-section { margin: 0 0 30px; }
    .stock-radar-note { margin: 10px 2px 14px; color: var(--muted); font-size: 9px; line-height: 1.9; }
    .stock-radar-filters { display: grid; grid-template-columns: minmax(0,1fr) minmax(160px,.45fr) minmax(160px,.45fr); gap: 12px; margin: 12px 0 14px; }
    .stock-radar-filters label { display: grid; gap: 5px; }
    .stock-radar-filters .control-label { font-size: 8px; }
    .stock-product-image { display: block; width: 100%; max-height: 185px; margin: 12px 0; object-fit: contain; background: var(--white); border: 2px solid var(--ink); }
    .stock-state-note { margin: 0 0 10px; color: var(--muted); font-size: 8px; line-height: 1.8; }
    .stock-last-check { margin-left: auto; color: var(--muted); font-size: 8px; }
    .stock-status-in { background: var(--grass) !important; }
    .stock-status-pre { color: var(--ink) !important; background: var(--gold) !important; }
    .stock-status-out { background: var(--red-dark) !important; }
    .stock-status-unknown { background: var(--blue) !important; }
    .stock-source-health { margin: 4px 0; font-size: 8px; line-height: 1.8; overflow-wrap: anywhere; }
    @media (max-width: 680px) { .stock-radar-filters { grid-template-columns: 1fr 1fr; } .stock-radar-filters label:first-child { grid-column: 1 / -1; } }
    @media (max-width: 430px) { .stock-radar-filters { grid-template-columns: 1fr; } .stock-radar-filters label:first-child { grid-column: auto; } }
  `;
  document.head.append(style);

  const feedSection = document.querySelector(".feed-section");
  if (!feedSection || !feedSection.parentNode) return;

  const section = make("section", "feed-section stock-radar-section");
  section.setAttribute("aria-labelledby", "stock-radar-title");
  const heading = make("div", "feed-heading");
  const titleWrap = document.createElement("div");
  titleWrap.append(make("p", "section-kicker", "VERIFIED RETAILER LISTINGS"), make("h2", "", "STOCK RADAR"));
  const total = make("div", "feed-total");
  const totalNumber = make("span", "", "0");
  totalNumber.id = "stock-result-count";
  total.append(totalNumber, make("span", "", "LISTINGS"));
  heading.append(titleWrap, total);
  section.append(heading);

  const note = make("p", "stock-radar-note", "Only direct retailer product pages with a readable Pokémon TCG product identity are listed here. A failed retailer request is not treated as sold out.");
  section.append(note);

  const filters = make("div", "stock-radar-filters");
  const searchLabel = document.createElement("label");
  searchLabel.append(make("span", "control-label", "SEARCH TRACKED PRODUCTS"));
  const search = document.createElement("input");
  search.type = "search";
  search.id = "stock-search";
  search.placeholder = "PRODUCT OR SET NAME...";
  searchLabel.append(search);

  const retailerLabel = document.createElement("label");
  retailerLabel.append(make("span", "control-label", "RETAILER"));
  const retailerFilter = document.createElement("select");
  retailerFilter.id = "stock-retailer-filter";
  retailerFilter.append(new Option("ALL RETAILERS", "all"));
  retailerLabel.append(retailerFilter);

  const stateLabel = document.createElement("label");
  stateLabel.append(make("span", "control-label", "AVAILABILITY"));
  const stateFilter = document.createElement("select");
  stateFilter.id = "stock-state-filter";
  for (const [label, value] of [["ALL STATES", "all"], ["IN STOCK", "IN_STOCK"], ["PREORDER", "PREORDER"], ["SOLD OUT", "OUT_OF_STOCK"], ["UNCONFIRMED", "UNKNOWN"]]) {
    stateFilter.append(new Option(label, value));
  }
  stateLabel.append(stateFilter);
  filters.append(searchLabel, retailerLabel, stateLabel);
  section.append(filters);

  const statusLine = make("div", "feed-status");
  statusLine.id = "stock-feed-status";
  statusLine.setAttribute("role", "status");
  statusLine.setAttribute("aria-live", "polite");
  statusLine.append(make("span", "status-pixel"), make("span", "", "CONNECTING TO CLOUD STOCK CHECKS..."));
  section.append(statusLine);

  const grid = make("section", "feed-grid");
  grid.id = "stock-feed";
  grid.setAttribute("aria-label", "Verified Pokémon TCG retailer listings");
  grid.setAttribute("aria-live", "polite");
  section.append(grid);

  feedSection.parentNode.insertBefore(section, feedSection);

  let products = [];
  let status = null;
  let refreshBusy = false;

  function renderRetailers() {
    const selected = retailerFilter.value;
    const names = [...new Set(products.map((item) => item.retailer).filter(Boolean))].sort();
    retailerFilter.replaceChildren(new Option("ALL RETAILERS", "all"));
    for (const name of names) retailerFilter.append(new Option(name.toUpperCase(), name));
    retailerFilter.value = names.includes(selected) ? selected : "all";
  }

  function stockPresentation(value) {
    const state = String(value || "UNKNOWN").toUpperCase();
    if (state === "IN_STOCK") return ["IN STOCK", "stock-status-in"];
    if (state === "PREORDER") return ["PREORDER", "stock-status-pre"];
    if (state === "OUT_OF_STOCK") return ["SOLD OUT", "stock-status-out"];
    return ["UNCONFIRMED", "stock-status-unknown"];
  }

  function productCard(item) {
    const card = make("article", "post-card stock-product-card");
    const top = make("div", "post-topline");
    const [stateLabel, stateClass] = stockPresentation(item.stockState);
    const tag = make("span", `tag ${stateClass}`, stateLabel);
    tag.dataset.category = item.stockState === "IN_STOCK" ? "Restock" : item.stockState === "PREORDER" ? "Deals" : "Release";
    top.append(tag, make("span", "retailer-tag", String(item.retailer || "RETAILER").toUpperCase()), make("time", "stock-last-check", ago(item.lastCheckedAt)));
    const title = make("h3", "", String(item.name || "POKÉMON TCG PRODUCT").toUpperCase().replace(/É/g, "é"));
    card.append(top, title);

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

    const details = make("div", "product-extra-details");
    const price = make("div", "");
    const priceLabel = make("strong", "", "PRICE:");
    price.append(priceLabel, document.createTextNode(` ${item.price || "NOT LISTED"}`));
    details.append(price);
    const checked = make("div", "");
    const checkedLabel = make("strong", "", "LAST CHECK:");
    checked.append(checkedLabel, document.createTextNode(` ${fmtDate(item.lastCheckedAt)}`));
    details.append(checked);
    if (item.lastCheckStatus && item.lastCheckStatus !== "OK") {
      const checkNote = make("div", "stock-state-note", `LATEST CHECK: ${item.lastCheckStatus}${item.lastError ? ` — ${item.lastError}` : ""}. THE LAST VERIFIED STOCK STATE IS RETAINED.`);
      details.append(checkNote);
    }
    card.append(details);

    const linkUrl = httpUrl(item.productUrl);
    if (linkUrl) {
      const link = make("a", "post-action", `OPEN ${String(item.retailer || "RETAILER").toUpperCase()} PRODUCT PAGE`);
      link.href = linkUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link);
    }
    const noteText = item.stockState === "UNKNOWN"
      ? "RETAILER PAGE IDENTIFIED; IT DID NOT EXPOSE A CLEAR STOCK SIGNAL."
      : item.stockState === "OUT_OF_STOCK"
        ? "THE RETAILER PAGE EXPLICITLY MARKED THIS LISTING OUT OF STOCK WHEN CHECKED."
        : "AVAILABILITY IS BASED ON THE PUBLIC PRODUCT-PAGE SIGNAL AT THE LAST CHECK.";
    card.append(make("p", "stock-state-note", noteText));
    return card;
  }

  function renderProducts() {
    grid.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const retailer = retailerFilter.value;
    const chosenState = stateFilter.value;
    const filtered = products.filter((item) => {
      if (retailer !== "all" && item.retailer !== retailer) return false;
      if (chosenState !== "all" && String(item.stockState || "UNKNOWN").toUpperCase() !== chosenState) return false;
      return `${item.name || ""} ${item.retailer || ""} ${item.setName || ""}`.toLowerCase().includes(query);
    });
    totalNumber.textContent = String(filtered.length);
    if (!filtered.length) {
      const empty = make("div", "empty-state");
      const noData = products.length === 0;
      empty.append(make("strong", "", noData ? "NO VERIFIED RETAILER PRODUCT PAGES YET" : "NO LISTINGS MATCH THIS FILTER"));
      empty.append(make("p", "", noData
        ? "The cloud checker has not found a public product-detail URL it could verify. This does not mean every store is sold out; open the scan diagnostics below to see whether a retailer exposed searchable product links."
        : "Try another retailer, availability state or product name."));
      grid.append(empty);
    } else filtered.forEach((item) => grid.append(productCard(item)));
  }

  function renderStatus() {
    statusLine.classList.toggle("error", status?.state === "error");
    const responders = Number(status?.retailersReached || 0);
    const totalRetailers = Number(status?.retailersChecked || 0);
    const productPages = Number(status?.productsChecked || 0);
    const verified = Number(status?.productsVerified || 0);
    const stockCount = products.filter((item) => item.stockState === "IN_STOCK").length;
    const preorderCount = products.filter((item) => item.stockState === "PREORDER").length;
    let message;
    if (!status) message = "CLOUD STOCK STATUS NOT AVAILABLE YET. RUN ACTIONS → RETAILER STOCK MONITOR.";
    else if (!productPages) message = `SCAN ${fmtDate(status.lastScanAt)} · ${responders}/${totalRetailers} SEARCH SOURCES RESPONDED · 0 PRODUCT PAGES CHECKED. NO STOCK CONCLUSION CAN BE MADE.`;
    else message = `SCAN ${fmtDate(status.lastScanAt)} · ${productPages} PRODUCT PAGES CHECKED · ${verified} STOCK SIGNALS READ · ${stockCount} IN STOCK · ${preorderCount} PREORDER`;
    statusLine.replaceChildren(make("span", "status-pixel"), make("span", "", message));
  }

  function addDiagnostics() {
    const holder = document.querySelector("#feed-diagnostics-content");
    if (!holder || !status) return;
    let box = document.querySelector("#stock-scan-diagnostics");
    if (!box) {
      box = make("div", "");
      box.id = "stock-scan-diagnostics";
      holder.append(box);
    }
    box.replaceChildren();
    box.append(make("p", "diagnostics-summary", `STOCK MONITOR: ${status.productsChecked || 0} PRODUCT PAGES CHECKED · ${status.productsVerified || 0} AVAILABILITY SIGNALS READ · ${status.productsFound || 0} LISTINGS STORED · ${status.alertsSent || 0} DISCORD ALERTS SENT`));
    box.append(make("p", "diagnostics-summary", `RETAILER SEARCH: ${status.retailersReached || 0}/${status.retailersChecked || 0} RESPONDED · ${status.retailersWithProducts || 0} EXPOSED PRODUCT LINKS · ${status.search?.resultLinks || 0} TOTAL LINKS PARSED`));
    if (status.note) box.append(make("p", "diagnostics-summary", status.note));
    for (const source of status.sources || []) {
      const details = source.error || `${source.productsFound || 0} product links · ${source.pagesChecked || 0} product pages checked · ${source.method || "no method"}`;
      box.append(make("p", "stock-source-health", `${source.ok ? "OK" : "LIMITED"} // ${source.retailer}: ${details}`));
    }
    if (status.discord?.note) box.append(make("p", "stock-source-health", `DISCORD: ${status.discord.note}`));
  }

  async function loadJson(path, fallback) {
    try {
      const response = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      console.warn(`PokeDrop stock radar could not load ${path}:`, error);
      return fallback;
    }
  }

  async function refresh() {
    if (refreshBusy) return;
    refreshBusy = true;
    try {
      const [nextProducts, nextStatus] = await Promise.all([
        loadJson("products.json", []),
        loadJson("product-status.json", null)
      ]);
      products = Array.isArray(nextProducts)
        ? nextProducts.filter((item) => item && httpUrl(item.productUrl) && item.name && item.retailer)
        : [];
      status = nextStatus && typeof nextStatus === "object" ? nextStatus : null;
      renderRetailers();
      renderProducts();
      renderStatus();
      addDiagnostics();
    } finally {
      refreshBusy = false;
    }
  }

  search.addEventListener("input", renderProducts);
  retailerFilter.addEventListener("change", renderProducts);
  stateFilter.addEventListener("change", renderProducts);
  refresh();
  window.setInterval(refresh, 90000);
})();
