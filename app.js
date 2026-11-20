(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const categoryOptions = [
    { label: "ALL ALERTS", value: "All" },
    { label: "RESTOCKS", value: "Restock" },
    { label: "EXCLUSIVE DEALS", value: "Deals" },
    { label: "RARE DROPS", value: "Rare Drop" },
    { label: "NEW RELEASES", value: "Release" },
    { label: "PROMOS + COLLABS", value: "Promo" }
  ];

  const retailerNames = [
    ["Pokémon Center", /pok[eé]mon\s*center/i],
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

  const state = {
    posts: [], category: "All", query: "", retailer: "all",
    raffles: [], raffleStatus: "All", raffleQuery: "", raffleStore: "all"
  };
  const nav = $(".category-nav");
  const search = $("#search");
  const retailerFilter = $("#retailer-filter");
  const feed = $("#feed");
  const status = $("#feed-status");
  const resultCount = $("#result-count");
  const raffleNav = $(".raffle-status-nav");
  const raffleSearch = $("#raffle-search");
  const raffleStoreFilter = $("#raffle-store-filter");
  const raffleFeed = $("#raffles");
  const raffleStatus = $("#raffle-feed-status");
  const raffleResultCount = $("#raffle-result-count");

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function normalizedCategory(post) {
    const value = String(post.cat || "").trim().toLowerCase();
    if (value === "restock" || value === "restocks") return "Restock";
    if (value === "deal" || value === "deals" || value === "price drop") return "Deals";
    if (value === "rare drop" || value === "rare drops" || value === "exclusive") return "Rare Drop";
    if (value === "release" || value === "releases" || value === "new release") return "Release";
    if (value === "promo" || value === "promos" || value === "collab" || value === "collaboration") return "Promo";
    return "Release";
  }

  function findRetailer(post) {
    const haystack = `${post.title || ""} ${post.summary || ""} ${post.text || ""} ${post.source || ""}`;
    const match = retailerNames.find(([, pattern]) => pattern.test(haystack));
    return match ? match[0] : "Other";
  }

  function sourceName(post) {
    if (post.source && String(post.source).trim()) return String(post.source).trim();
    const text = String(post.text || "").trim();
    return text.replace(/^via\s+/i, "").trim() || "Original publisher";
  }

  function summaryText(post) {
    const summary = String(post.summary || "").trim();
    if (summary) return summary;
    const text = String(post.text || "").trim();
    if (text && !/^via\s+/i.test(text)) return text;
    return "Open the original coverage for product details, pricing and availability.";
  }

  function formatAge(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "DATE UNKNOWN";
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "JUST NOW";
    if (minutes < 60) return `${minutes}M AGO`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}H AGO`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "1 DAY AGO";
    if (days < 7) return `${days} DAYS AGO`;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  }

  function formatCalendarDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "DATE NOT LISTED";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
  }

  function validHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }

  function categoryAction(category) {
    if (category === "Restock") return "CHECK RESTOCK INFO";
    if (category === "Deals") return "VIEW DEAL DETAILS";
    if (category === "Rare Drop") return "CHECK RARE DROP";
    if (category === "Promo") return "VIEW PROMO INFO";
    return "VIEW RELEASE INFO";
  }

  function renderCategories() {
    nav.replaceChildren();
    for (const option of categoryOptions) {
      const button = makeElement("button", "category-button", option.label);
      button.type = "button";
      button.dataset.value = option.value;
      button.setAttribute("aria-pressed", String(state.category === option.value));
      button.addEventListener("click", () => {
        state.category = option.value;
        renderCategories();
        renderFeed();
      });
      nav.append(button);
    }
  }

  function renderRetailerOptions() {
    const selected = state.retailer;
    const values = [...new Set(state.posts.map(findRetailer).filter((name) => name !== "Other"))].sort((a, b) => a.localeCompare(b));
    retailerFilter.replaceChildren();
    retailerFilter.append(new Option("ALL RETAILERS", "all"));
    for (const value of values) retailerFilter.append(new Option(value.toUpperCase(), value));
    if (selected !== "all" && values.includes(selected)) retailerFilter.value = selected;
    else {
      state.retailer = "all";
      retailerFilter.value = "all";
    }
  }

  function buildCard(post) {
    const category = normalizedCategory(post);
    const retailer = findRetailer(post);
    const article = makeElement("article", "post-card");
    article.dataset.category = category;

    const meta = makeElement("div", "post-topline");
    const tag = makeElement("span", "tag", category === "Deals" ? "EXCLUSIVE DEAL" : category.toUpperCase());
    tag.dataset.category = category;
    meta.append(tag);
    if (retailer !== "Other") meta.append(makeElement("span", "retailer-tag", retailer.toUpperCase()));
    meta.append(makeElement("time", "post-date", formatAge(post.date)));

    const title = makeElement("h3", "", String(post.title || "POKÉMON TCG UPDATE").toUpperCase().replace(/É/g, "é"));
    const summary = makeElement("p", "post-summary", summaryText(post));
    const source = makeElement("div", "post-source");
    source.append(document.createTextNode("SOURCE:"), makeElement("strong", "", sourceName(post)));

    article.append(meta, title, summary, source);
    if (validHttpUrl(post.url)) {
      const link = makeElement("a", "post-action", categoryAction(category));
      link.href = post.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
      article.append(link);
    }
    return article;
  }

  function setStatus(message, isError = false) {
    status.classList.toggle("error", isError);
    status.replaceChildren(makeElement("span", "status-pixel"), makeElement("span", "", message));
  }

  function renderFeed() {
    feed.replaceChildren();
    const filtered = state.posts.filter((post) => {
      const categoryMatch = state.category === "All" || normalizedCategory(post) === state.category;
      const retailerMatch = state.retailer === "all" || findRetailer(post) === state.retailer;
      const searchable = `${post.title || ""} ${post.summary || ""} ${post.text || ""} ${post.source || ""} ${findRetailer(post)}`.toLowerCase();
      return categoryMatch && retailerMatch && searchable.includes(state.query);
    });

    resultCount.textContent = String(filtered.length);
    if (!filtered.length) {
      const empty = makeElement("div", "empty-state");
      empty.append(
        makeElement("strong", "", "NO SIGNAL FOUND"),
        makeElement("p", "", "Try another category, retailer or search term. The next alert will appear here when the feed updates.")
      );
      feed.append(empty);
      return;
    }

    for (const post of filtered) feed.append(buildCard(post));
  }

  function renderRaffleStatusButtons() {
    raffleNav.querySelectorAll("button[data-status]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.status === state.raffleStatus));
    });
  }

  function renderRaffleStoreOptions() {
    const selected = state.raffleStore;
    const values = [...new Set(state.raffles.map((raffle) => raffle.store || "Other"))].sort((a, b) => a.localeCompare(b));
    raffleStoreFilter.replaceChildren(new Option("ALL STORES", "all"));
    for (const value of values) raffleStoreFilter.append(new Option(value.toUpperCase(), value));
    if (selected !== "all" && values.includes(selected)) raffleStoreFilter.value = selected;
    else {
      state.raffleStore = "all";
      raffleStoreFilter.value = "all";
    }
  }

  function buildRaffleCard(raffle) {
    const normalizedStatus = ["Upcoming", "Open", "Closed"].includes(raffle.status) ? raffle.status : "Verify";
    const store = raffle.store || "Other";
    const card = makeElement("article", "post-card raffle-card");
    card.dataset.status = normalizedStatus.toLowerCase();

    const meta = makeElement("div", "post-topline");
    const stateTag = makeElement("span", "raffle-status-tag", normalizedStatus.toUpperCase());
    stateTag.dataset.status = normalizedStatus.toLowerCase();
    meta.append(stateTag);
    meta.append(makeElement("span", "retailer-tag", store === "Other" ? "STORE UNKNOWN" : store.toUpperCase()));
    meta.append(makeElement("time", "post-date", formatAge(raffle.date)));

    const title = makeElement("h3", "", String(raffle.title || "POKÉMON TCG GIVEAWAY").toUpperCase().replace(/É/g, "é"));
    const summary = makeElement("p", "post-summary", raffle.summary || "Open the source for the giveaway description and entry instructions.");
    const note = makeElement("p", "raffle-status-note", raffle.statusNote || "Check the source for current entry status and rules.");
    if (raffle.statusDate) note.append(makeElement("span", "raffle-date", ` DATE: ${formatCalendarDate(raffle.statusDate)}`));

    const source = makeElement("div", "post-source");
    source.append(document.createTextNode("SOURCE:"), makeElement("strong", "", raffle.source || "Original publisher"));

    card.append(meta, title, summary, note, source);
    if (validHttpUrl(raffle.url)) {
      const link = makeElement("a", "post-action raffle-action", "VIEW ENTRY DETAILS");
      link.href = raffle.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      card.append(link);
    }
    return card;
  }

  function renderRaffles() {
    raffleFeed.replaceChildren();
    const filtered = state.raffles.filter((raffle) => {
      const raffleStatus = ["Upcoming", "Open", "Closed"].includes(raffle.status) ? raffle.status : "Verify";
      const statusMatch = state.raffleStatus === "All" || raffleStatus === state.raffleStatus;
      const storeMatch = state.raffleStore === "all" || (raffle.store || "Other") === state.raffleStore;
      const searchable = `${raffle.title || ""} ${raffle.summary || ""} ${raffle.source || ""} ${raffle.store || ""} ${raffle.statusNote || ""}`.toLowerCase();
      return statusMatch && storeMatch && searchable.includes(state.raffleQuery);
    });

    raffleResultCount.textContent = String(filtered.length);
    if (!filtered.length) {
      const empty = makeElement("div", "empty-state");
      empty.append(
        makeElement("strong", "", "NO GIVEAWAYS FOUND"),
        makeElement("p", "", state.raffles.length ? "Try another status, store or search term." : "No matching raffle headlines have been collected yet. The radar checks public coverage during its scheduled updates.")
      );
      raffleFeed.append(empty);
      return;
    }

    for (const raffle of filtered) raffleFeed.append(buildRaffleCard(raffle));
  }

  function setRaffleStatus(message, isError = false) {
    raffleStatus.classList.toggle("error", isError);
    raffleStatus.replaceChildren(makeElement("span", "status-pixel"), makeElement("span", "", message));
  }

  function sortNewestFirst(posts) {
    return posts.slice().sort((a, b) => {
      const dateA = Date.parse(a.date || "") || 0;
      const dateB = Date.parse(b.date || "") || 0;
      return dateB - dateA;
    });
  }

  search.addEventListener("input", () => {
    state.query = search.value.trim().toLowerCase();
    renderFeed();
  });

  retailerFilter.addEventListener("change", () => {
    state.retailer = retailerFilter.value;
    renderFeed();
  });

  raffleNav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) return;
    state.raffleStatus = button.dataset.status;
    renderRaffleStatusButtons();
    renderRaffles();
  });

  raffleSearch.addEventListener("input", () => {
    state.raffleQuery = raffleSearch.value.trim().toLowerCase();
    renderRaffles();
  });

  raffleStoreFilter.addEventListener("change", () => {
    state.raffleStore = raffleStoreFilter.value;
    renderRaffles();
  });

  async function loadFeed() {
    try {
      const response = await fetch("posts.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Feed request failed (${response.status})`);
      const posts = await response.json();
      if (!Array.isArray(posts)) throw new Error("Feed data is not a list");
      state.posts = sortNewestFirst(posts.filter((post) => post && post.title && post.date));
      renderRetailerOptions();
      renderFeed();
      const latest = state.posts[0];
      setStatus(latest ? `RADAR UPDATED // LATEST SIGNAL ${formatAge(latest.date)}` : "RADAR ONLINE // NO ALERTS YET");
    } catch (error) {
      console.error("PokeDrop feed error:", error);
      setStatus("COULD NOT LOAD ALERTS // REFRESH OR CHECK THE GITHUB PAGES DEPLOYMENT", true);
      const empty = makeElement("div", "empty-state");
      empty.append(
        makeElement("strong", "", "RADAR CONNECTION LOST"),
        makeElement("p", "", "The alert file could not be loaded. Check that posts.json is deployed beside index.html, then refresh this page.")
      );
      feed.replaceChildren(empty);
      resultCount.textContent = "0";
    }
  }

  async function loadRaffles() {
    try {
      const response = await fetch("raffles.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Raffle feed request failed (${response.status})`);
      const raffles = await response.json();
      if (!Array.isArray(raffles)) throw new Error("Raffle data is not a list");
      const statusRank = { Open: 0, Upcoming: 1, Verify: 2, Closed: 3 };
      state.raffles = raffles
        .filter((raffle) => raffle && raffle.title && raffle.date && validHttpUrl(raffle.url))
        .sort((a, b) => (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      renderRaffleStoreOptions();
      renderRaffleStatusButtons();
      renderRaffles();
      setRaffleStatus(`GIVEAWAY RADAR UPDATED // ${state.raffles.length} RESULTS COLLECTED`);
    } catch (error) {
      console.error("PokeDrop raffle feed error:", error);
      setRaffleStatus("COULD NOT LOAD GIVEAWAYS // CHECK raffles.json OR THE GITHUB PAGES DEPLOYMENT", true);
      const empty = makeElement("div", "empty-state");
      empty.append(
        makeElement("strong", "", "GIVEAWAY RADAR CONNECTION LOST"),
        makeElement("p", "", "The raffle file could not be loaded. Confirm raffles.json is deployed beside index.html, then refresh this page.")
      );
      raffleFeed.replaceChildren(empty);
      raffleResultCount.textContent = "0";
    }
  }

  renderCategories();
  renderRaffleStatusButtons();
  loadFeed();
  loadRaffles();
})();
