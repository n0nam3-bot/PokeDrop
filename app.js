(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const categoryOptions = [
    { label: "ALL ALERTS", value: "All" },
    { label: "RESTOCKS", value: "Restock" },
    { label: "EXCLUSIVE DEALS", value: "Deals" },
    { label: "RARE DROPS", value: "Rare Drop" },
    { label: "NEW RELEASES", value: "Release" },
    { label: "PROMOS + COLLABS", value: "Promo" },
    { label: "RAFFLES + GIVEAWAYS", value: "Raffle" }
  ];

  // Keep the full retailer directory visible even when a store has no current alert.
  // Dynamic stores found in the feed are appended below this known list.
  const retailerNames = [
    ["Pokémon Center", /pok[eé]mon\s*center/i],
    ["Target", /\btarget\b/i],
    ["Walmart", /\bwalmart\b/i],
    ["Costco", /\bcostco\b/i],
    ["GameStop", /game\s*stop/i],
    ["Best Buy", /best\s*buy/i],
    ["Amazon", /\bamazon\b/i],
    ["Sam's Club", /sam'?s\s*club/i],
    ["Barnes & Noble", /barnes\s*(?:&|and)\s*noble/i],
    ["Macy's", /macy'?s/i],
    ["Kohl's", /kohl'?s/i],
    ["Meijer", /\bmeijer\b/i],
    ["Kroger", /\bkroger\b/i],
    ["H-E-B", /\bh[- ]?e[- ]?b\b/i],
    ["Fred Meyer", /fred\s*meyer/i],
    ["BJ's Wholesale Club", /bj'?s\s*wholesale/i],
    ["Five Below", /five\s*below/i],
    ["Hot Topic", /hot\s*topic/i],
    ["BoxLunch", /box\s*lunch/i],
    ["FYE", /\bfye\b/i],
    ["Fanatics", /\bfanatics\b/i],
    ["TCGplayer", /tcgplayer/i],
    ["eBay", /\bebay\b/i],
    ["Cardmarket", /cardmarket/i],
    ["Dave & Adam's Card World", /dave\s*(?:&|and)\s*adam'?s/i],
    ["Steel City Collectibles", /steel\s*city\s*collectibles/i],
    ["Troll and Toad", /troll\s*(?:and|&)\s*toad/i],
    ["Safari Zone", /safari\s*zone/i],
    ["Forge and Fire Gaming", /forge\s*(?:and|&)\s*fire/i],
    ["Game Nerdz", /game\s*nerdz/i],
    ["Smoke & Mirrors Hobby", /smoke\s*(?:&|and)\s*mirrors/i],
    ["Local Card Shop", /card\s*shop|game\s*store|\bLGS\b/i]
  ];

  const state = {
    posts: [],
    raffles: [],
    category: "All",
    query: "",
    retailer: "all",
    raffleStatus: "All",
    diagnostics: null
  };

  const nav = $(".category-nav");
  const search = $("#search");
  const retailerFilter = $("#retailer-filter");
  const feed = $("#feed");
  const status = $("#feed-status");
  const resultCount = $("#result-count");
  const raffleStatusNav = $("#raffle-status-filter");
  const raffleCategoryButton = $("#raffle-category-button");
  const filterMenuToggle = $("#filter-menu-toggle");
  const filterControls = $("#filter-controls");
  const diagnosticsContent = $("#feed-diagnostics-content");

  function makeElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function normalizedCategory(post) {
    const value = String(post.cat || "").trim().toLowerCase();
    if (["raffle", "raffles", "giveaway", "giveaways"].includes(value)) return "Raffle";
    if (value === "restock" || value === "restocks") return "Restock";
    if (value === "deal" || value === "deals" || value === "price drop") return "Deals";
    if (value === "rare drop" || value === "rare drops" || value === "exclusive") return "Rare Drop";
    if (value === "release" || value === "releases" || value === "new release") return "Release";
    if (value === "promo" || value === "promos" || value === "collab" || value === "collaboration") return "Promo";
    return "Release";
  }

  function findRetailer(post) {
    if (post.store && String(post.store).trim() && post.store !== "Other") return String(post.store).trim();
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
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    }).toUpperCase();
  }

  function validHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }

  function normalizedStatus(value) {
    return ["Upcoming", "Open", "Closed"].includes(value) ? value : "Verify";
  }

  function statusRank(value) {
    return ({ Open: 0, Upcoming: 1, Verify: 2, Closed: 3 })[normalizedStatus(value)];
  }

  function canonicalUrl(value) {
    try {
      const url = new URL(value);
      url.hash = "";
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|ref$|source$|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
      }
      return url.toString().replace(/\/$/, "").toLowerCase();
    } catch {
      return String(value || "").toLowerCase();
    }
  }

  function raffleEntries() {
    const entries = state.raffles.map((raffle) => ({ ...raffle, cat: "Raffle", kind: "raffle" }));
    const knownUrls = new Set(entries.map((entry) => canonicalUrl(entry.url)).filter(Boolean));
    const knownTitles = new Set(entries.map((entry) => String(entry.title || "").toLowerCase().replace(/[^a-z0-9]/g, "")).filter(Boolean));

    for (const post of state.posts.filter((item) => normalizedCategory(item) === "Raffle")) {
      const urlKey = canonicalUrl(post.url);
      const titleKey = String(post.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if ((urlKey && knownUrls.has(urlKey)) || (titleKey && knownTitles.has(titleKey))) continue;
      entries.push({
        ...post,
        cat: "Raffle",
        kind: "raffle",
        status: post.status || "Verify",
        statusNote: post.statusNote || "The article mentions a giveaway, but entry dates and availability need to be checked at the source."
      });
      if (urlKey) knownUrls.add(urlKey);
      if (titleKey) knownTitles.add(titleKey);
    }
    return entries;
  }

  function getAllItems() {
    return [...state.posts, ...raffleEntries()];
  }

  function renderCategories() {
    nav.replaceChildren();
    for (const option of categoryOptions.filter((item) => item.value !== "Raffle")) {
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
    raffleCategoryButton.setAttribute("aria-pressed", String(state.category === "Raffle"));
    raffleStatusNav.hidden = state.category !== "Raffle";
    raffleStatusNav.setAttribute("aria-hidden", String(state.category !== "Raffle"));
    renderRaffleStatusButtons();
  }

  raffleCategoryButton.addEventListener("click", () => {
    state.category = "Raffle";
    renderCategories();
    renderFeed();
  });

  function renderRetailerOptions() {
    const selected = state.retailer;
    const known = retailerNames.map(([name]) => name);
    const detected = getAllItems().map(findRetailer).filter((name) => name !== "Other");
    const values = [...new Set([...known, ...detected])];
    retailerFilter.replaceChildren(new Option("ALL RETAILERS / STORES", "all"));
    for (const value of values) retailerFilter.append(new Option(value.toUpperCase(), value));
    if (selected !== "all" && values.includes(selected)) retailerFilter.value = selected;
    else {
      state.retailer = "all";
      retailerFilter.value = "all";
    }
  }

  function buildCard(item) {
    const isRaffle = item.kind === "raffle" || normalizedCategory(item) === "Raffle";
    const category = isRaffle ? "Raffle" : normalizedCategory(item);
    const retailer = findRetailer(item);
    const card = makeElement("article", isRaffle ? "post-card raffle-card" : "post-card");
    card.dataset.category = category;

    const meta = makeElement("div", "post-topline");
    const tag = makeElement("span", "tag", isRaffle ? "RAFFLE / GIVEAWAY" : (category === "Deals" ? "EXCLUSIVE DEAL" : category.toUpperCase()));
    tag.dataset.category = category;
    meta.append(tag);
    if (isRaffle) {
      const raffleStatus = normalizedStatus(item.status);
      const statusTag = makeElement("span", "raffle-status-tag", raffleStatus.toUpperCase());
      statusTag.dataset.status = raffleStatus.toLowerCase();
      meta.append(statusTag);
    }
    if (retailer !== "Other") meta.append(makeElement("span", "retailer-tag", retailer.toUpperCase()));
    else if (isRaffle) meta.append(makeElement("span", "retailer-tag", "STORE UNKNOWN"));
    meta.append(makeElement("time", "post-date", formatAge(item.date)));

    const title = makeElement("h3", "", String(item.title || (isRaffle ? "POKÉMON TCG GIVEAWAY" : "POKÉMON TCG UPDATE")).toUpperCase().replace(/É/g, "é"));
    const summary = makeElement("p", "post-summary", summaryText(item));
    const source = makeElement("div", "post-source");
    source.append(document.createTextNode("SOURCE:"), makeElement("strong", "", sourceName(item)));

    card.append(meta, title, summary);
    if (isRaffle) {
      const noteText = item.entryUrl
        ? (item.statusNote || "The entry page was identified from the source. Confirm eligibility and rules before entering.")
        : `${item.statusNote || "Check the original source for current entry status and rules."} A direct entry page has not been identified yet.`;
      const note = makeElement("p", "raffle-status-note", noteText);
      if (item.statusDate) note.append(makeElement("span", "raffle-date", ` DATE: ${formatCalendarDate(item.statusDate)}`));
      card.append(note);
    }
    card.append(source);

    if (isRaffle) {
      const entryUrl = validHttpUrl(item.entryUrl) ? item.entryUrl : "";
      const sourceUrl = validHttpUrl(item.sourceUrl) ? item.sourceUrl : (validHttpUrl(item.url) ? item.url : "");
      if (entryUrl) {
        const entryLink = makeElement("a", "post-action", "OPEN ENTRY PAGE");
        entryLink.href = entryUrl;
        entryLink.target = "_blank";
        entryLink.rel = "noopener noreferrer sponsored";
        card.append(entryLink);
      } else {
        card.append(makeElement("span", "post-action post-action-missing", "DIRECT ENTRY LINK NOT FOUND"));
        if (sourceUrl) {
          const sourceLink = makeElement("a", "post-action post-action-secondary", "READ SOURCE ANNOUNCEMENT");
          sourceLink.href = sourceUrl;
          sourceLink.target = "_blank";
          sourceLink.rel = "noopener noreferrer";
          card.append(sourceLink);
        }
      }
    } else if (validHttpUrl(item.url)) {
      const actionLabel = category === "Restock" ? "CHECK RESTOCK INFO" : category === "Deals" ? "VIEW DEAL DETAILS" : category === "Rare Drop" ? "CHECK RARE DROP" : category === "Promo" ? "VIEW PROMO INFO" : "VIEW RELEASE INFO";
      const link = makeElement("a", "post-action", actionLabel);
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer sponsored";
      card.append(link);
    }
    return card;
  }

  function getVisibleEntries() {
    let entries;
    if (state.category === "Raffle") {
      entries = raffleEntries();
    } else {
      entries = state.posts.filter((post) => state.category === "All" || normalizedCategory(post) === state.category);
      if (state.category === "All") {
        const raffleUrlSet = new Set(raffleEntries().map((entry) => canonicalUrl(entry.url)).filter(Boolean));
        entries = entries.filter((post) => !raffleUrlSet.has(canonicalUrl(post.url)));
        entries = entries.concat(raffleEntries());
      }
    }

    return entries.filter((item) => {
      const itemCategory = item.kind === "raffle" || normalizedCategory(item) === "Raffle" ? "Raffle" : normalizedCategory(item);
      if (state.category !== "All" && itemCategory !== state.category) return false;

      const itemStatus = normalizedStatus(item.status);
      if (state.category === "Raffle" && state.raffleStatus !== "All" && itemStatus !== state.raffleStatus) return false;

      const retailer = findRetailer(item);
      if (state.retailer !== "all" && retailer !== state.retailer) return false;

      const searchable = `${item.title || ""} ${item.summary || ""} ${item.text || ""} ${item.source || ""} ${retailer} ${item.statusNote || ""}`.toLowerCase();
      return searchable.includes(state.query);
    }).sort((a, b) => {
      if (state.category === "Raffle") {
        return statusRank(a.status) - statusRank(b.status) || (Date.parse(b.date || "") || 0) - (Date.parse(a.date || "") || 0);
      }
      return (Date.parse(b.date || "") || 0) - (Date.parse(a.date || "") || 0);
    });
  }

  function renderRaffleStatusButtons() {
    raffleStatusNav.querySelectorAll("button[data-status]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.status === state.raffleStatus));
    });
  }

  function renderFeed() {
    feed.replaceChildren();
    const filtered = getVisibleEntries();
    resultCount.textContent = String(filtered.length);

    if (!filtered.length) {
      const empty = makeElement("div", "empty-state");
      if (state.category === "Raffle") {
        empty.append(
          makeElement("strong", "", "NO RAFFLE / GIVEAWAY SIGNALS FOUND"),
          makeElement("p", "", raffleEntries().length
            ? "Try another status, store or search term. Some entries may be missed by public news coverage; check participating stores directly."
            : "No raffle leads are saved yet. Open VIEW FEED SOURCE STATUS to see whether searches returned zero results or a source request failed. A zero count does not prove that stores have no active entries.")
        );
      } else {
        empty.append(
          makeElement("strong", "", "NO SIGNAL FOUND"),
          makeElement("p", "", "Try another category, retailer or search term. The next alert will appear here when the feed updates.")
        );
      }
      feed.append(empty);
      return;
    }

    for (const item of filtered) feed.append(buildCard(item));
  }

  function setStatus(message, isError = false) {
    status.classList.toggle("error", isError);
    status.replaceChildren(makeElement("span", "status-pixel"), makeElement("span", "", message));
  }

  function renderDiagnostics() {
    diagnosticsContent.replaceChildren();
    const diagnostics = state.diagnostics;
    if (!diagnostics) {
      diagnosticsContent.textContent = "Feed diagnostics have not been published yet. Run Actions → Update feed to generate them.";
      return;
    }
    if (diagnostics.state === "not-run") {
      diagnosticsContent.textContent = "WAITING FOR FIRST SEARCH. Open GitHub → Actions → Update feed → Run workflow. The next successful run will report each search source here.";
      return;
    }

    const raffle = diagnostics.raffles || {};
    const news = diagnostics.news || {};
    const summary = makeElement("p", "diagnostics-summary",
      `RAFFLE SEARCHES: ${raffle.sourcesResponded || 0}/${raffle.sourceCount || 0} SOURCES REACHED · ${raffle.searchResults || 0} RAW RESULTS · ${raffle.savedLeads || 0} SAVED LEADS · ${raffle.historyDays || 365} DAYS OF HISTORY`);
    diagnosticsContent.append(summary);
    diagnosticsContent.append(makeElement("p", "diagnostics-summary",
      `ENTRY LINKS: ${raffle.directEntryLinksFound || 0} DIRECT PAGES FOUND · ${raffle.directEntryLinksMissing || 0} NEED MANUAL REVIEW · ${raffle.entryLookupsThisRun || 0} PAGES CHECKED THIS RUN`));

    const newsSummary = makeElement("p", "diagnostics-summary",
      `NEWS SEARCHES: ${news.sourcesResponded || 0}/${news.sourceCount || 0} SOURCES REACHED · ${news.searchResults || 0} RAW RESULTS`);
    diagnosticsContent.append(newsSummary);

    const sourceList = makeElement("ul", "diagnostics-list");
    for (const source of (raffle.sources || [])) {
      const line = makeElement("li", source.ok ? "source-ok" : "source-failed",
        `${source.ok ? "OK" : "FAILED"} // ${source.name}: ${source.results || 0} RESULTS${source.error ? ` // ${source.error}` : ""}`);
      sourceList.append(line);
    }
    diagnosticsContent.append(sourceList);

    if (Array.isArray(diagnostics.failures) && diagnostics.failures.length) {
      diagnosticsContent.append(makeElement("p", "diagnostics-errors", `SOURCE ERRORS: ${diagnostics.failures.join(" | ")}`));
    }
  }

  function updateRadarStatus() {
    const raffleCount = raffleEntries().length;
    const diagnostics = state.diagnostics;
    if (!diagnostics) {
      setStatus(`RADAR // ${state.posts.length} NEWS ALERTS + ${raffleCount} RAFFLE LEADS // SOURCE CHECK DETAILS NOT YET AVAILABLE`);
      return;
    }
    if (diagnostics.state === "not-run") {
      setStatus(`RADAR // ${state.posts.length} NEWS ALERTS + ${raffleCount} RAFFLE LEADS // WAITING FOR FIRST SOURCE SEARCH`);
      return;
    }
    const raffle = diagnostics.raffles || {};
    const sourceHealth = `${raffle.sourcesResponded || 0}/${raffle.sourceCount || 0} RAFFLE SEARCHES REACHED`;
    const hitText = `${raffle.searchResults || 0} SEARCH HITS`;
    setStatus(`RADAR // ${state.posts.length} NEWS ALERTS + ${raffleCount} RAFFLE LEADS // ${sourceHealth} · ${hitText}`,
      diagnostics.state === "error");
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

  raffleStatusNav.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) return;
    state.raffleStatus = button.dataset.status;
    renderRaffleStatusButtons();
    renderFeed();
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
      updateRadarStatus();
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
      state.raffles = raffles
        .filter((raffle) => raffle && raffle.title && raffle.date && validHttpUrl(raffle.url))
        .sort((a, b) => statusRank(a.status) - statusRank(b.status) || (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
      renderRetailerOptions();
      renderFeed();
      updateRadarStatus();
    } catch (error) {
      console.error("PokeDrop raffle feed error:", error);
      setStatus("RAFFLE DATA UNAVAILABLE // CHECK raffles.json DEPLOYMENT", true);
      renderFeed();
    }
  }

  async function loadDiagnostics() {
    try {
      const response = await fetch("feed-status.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Diagnostics request failed (${response.status})`);
      const diagnostics = await response.json();
      if (!diagnostics || typeof diagnostics !== "object") throw new Error("Diagnostics data is invalid");
      state.diagnostics = diagnostics;
      renderDiagnostics();
      updateRadarStatus();
    } catch (error) {
      console.warn("PokeDrop feed diagnostics unavailable:", error);
      state.diagnostics = null;
      renderDiagnostics();
      updateRadarStatus();
    }
  }

  filterMenuToggle.addEventListener("click", () => {
    const willExpand = filterControls.hidden;
    filterControls.hidden = !willExpand;
    filterMenuToggle.setAttribute("aria-expanded", String(willExpand));
    filterMenuToggle.textContent = willExpand ? "FILTER MENU" : "SHOW FILTERS";
  });

  renderCategories();
  renderDiagnostics();
  loadFeed();
  loadRaffles();
  loadDiagnostics();
})();
