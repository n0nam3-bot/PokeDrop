// Adds verified giveaway details and product-image carousels to PokeDrop cards.
// Invalid/unqualified posts that the legacy renderer labels as raffles are removed.
(() => {
  "use strict";

  const normalize = (value) => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const httpUrl = (value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
    } catch { return ""; }
  };

  const style = document.createElement("style");
  style.textContent = `
    .item-image-carousel { position:relative; display:grid; gap:7px; margin:1px 0 14px; padding:9px; background:rgba(228,223,190,.48); border:2px solid var(--ink); }
    .item-image-carousel[hidden] { display:none !important; }
    .item-image-heading { display:flex; justify-content:space-between; align-items:center; gap:8px; color:var(--muted); font-size:7px; letter-spacing:.06em; text-transform:uppercase; }
    .item-image-count { color:var(--deep); white-space:nowrap; }
    .item-image-viewport { position:relative; min-width:0; overflow:hidden; background:var(--white); border:2px solid var(--ink); }
    .item-image-track { display:flex; overflow-x:auto; scroll-snap-type:x mandatory; scrollbar-width:thin; overscroll-behavior-x:contain; }
    .item-image-slide { position:relative; display:grid; flex:0 0 100%; min-width:0; min-height:150px; margin:0; place-items:center; scroll-snap-align:center; background:var(--white); }
    .item-image-slide img { display:block; width:100%; height:clamp(150px, 24vw, 245px); object-fit:contain; image-rendering:auto; }
    .item-image-caption { width:100%; padding:5px 7px; color:var(--muted); background:rgba(247,242,216,.94); border-top:1px dashed #c7c3a8; font-size:7px; line-height:1.6; }
    .item-image-controls { display:flex; align-items:center; justify-content:center; gap:9px; }
    .item-image-controls[hidden] { display:none !important; }
    .item-image-arrow { display:grid; width:27px; height:25px; place-items:center; padding:0; color:var(--white); background:var(--deep); border:2px solid var(--ink); box-shadow:2px 2px 0 var(--paper-shadow); cursor:pointer; font:inherit; font-size:12px; }
    .item-image-arrow:disabled { opacity:.35; cursor:default; }
    .item-image-dots { display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:5px; }
    .item-image-dot { width:8px; height:8px; padding:0; background:var(--paper-shadow); border:1px solid var(--ink); cursor:pointer; }
    .item-image-dot[aria-current="true"] { background:var(--red); }
    .raffle-extra-details { display:grid; gap:8px; margin:0 0 13px; padding:10px; color:var(--deep); background:rgba(228,223,190,.48); border:2px dashed #9a997e; font-size:8px; line-height:1.8; overflow-wrap:anywhere; }
    .raffle-extra-row { display:flex; flex-wrap:wrap; gap:5px 12px; }
    .raffle-extra-row strong { color:var(--ink); font-weight:normal; }
    .raffle-extra-prize { margin:0; color:var(--ink); font-size:9px; line-height:1.8; }
    .raffle-extra-label { display:block; color:var(--muted); font-size:7px; letter-spacing:.05em; text-transform:uppercase; }
    .raffle-extra-site { color:var(--deep); text-decoration:underline; text-underline-offset:2px; }
    .raffle-extra-verified { color:var(--muted); font-size:7px; }
    .product-extra-details { display:grid; gap:5px; margin:0 0 10px; padding:8px 10px; color:var(--deep); background:rgba(228,223,190,.42); border:1px dashed #9a997e; font-size:8px; line-height:1.7; }
    .product-extra-details strong { color:var(--ink); font-weight:normal; }
    .product-destination-note { margin:6px 0 0; color:var(--muted); font-size:7px; line-height:1.7; }
    @media (max-width:560px) {
      .item-image-carousel { padding:7px; margin-bottom:12px; }
      .item-image-slide { min-height:130px; }
      .item-image-slide img { height:clamp(130px, 52vw, 210px); }
    }
  `;
  document.head.append(style);

  const itemsByTitle = new Map();
  const validRaffleTitles = new Set();
  let ready = false;

  function imageRecords(item) {
    const source = Array.isArray(item?.imageUrls) ? item.imageUrls : [];
    const records = source.map((value) => typeof value === "string"
      ? { url: value, label: "ITEM IMAGE", alt: item.title || "Pokémon TCG item" }
      : value);
    if (!records.length && item?.imageUrl && item.imageType === "prize") {
      records.push({ url: item.imageUrl, label: "PRIZE IMAGE", alt: item.prize || item.title || "Pokémon TCG giveaway prize" });
    }
    const seen = new Set();
    return records.filter((record) => {
      const url = httpUrl(record?.url);
      if (!url) return false;
      const path = new URL(url).pathname.toLowerCase();
      if (/favicon|apple-touch-icon|logo|icon|avatar|sprite|placeholder|brandmark/i.test(path)) return false;
      if (/\b(site logo|company logo|brand logo|favicon|site icon|author photo|profile picture|avatar)\b/i.test(String(record?.alt || ""))) return false;
      const key = url.split(/[?#]/)[0].toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      record.url = url;
      return true;
    }).slice(0, 6);
  }

  function buildCarousel(item) {
    const images = imageRecords(item);
    if (!images.length) return null;

    const gallery = document.createElement("section");
    gallery.className = "item-image-carousel";
    gallery.setAttribute("aria-label", `Images for ${item.title || "Pokémon TCG item"}`);

    const heading = document.createElement("div");
    heading.className = "item-image-heading";
    const headingLabel = document.createElement("span");
    const prizeGallery = Boolean(item.prize) && images.some((image) => image.kind === "product" || image.kind === "prize");
    headingLabel.textContent = prizeGallery ? "GIVEAWAY PRIZE IMAGES" : "RELATED ITEM IMAGES";
    const count = document.createElement("span");
    count.className = "item-image-count";
    count.textContent = `1 / ${images.length}`;
    heading.append(headingLabel, count);

    const viewport = document.createElement("div");
    viewport.className = "item-image-viewport";
    const track = document.createElement("div");
    track.className = "item-image-track";
    const slides = [];
    images.forEach((record, index) => {
      const figure = document.createElement("figure");
      figure.className = "item-image-slide";
      const image = document.createElement("img");
      image.loading = "lazy";
      image.decoding = "async";
      image.alt = record.alt || `${item.title || "Pokémon TCG item"} image ${index + 1}`;
      image.src = record.url;
      image.addEventListener("error", () => {
        figure.remove();
        const remaining = track.querySelectorAll(".item-image-slide").length;
        if (!remaining) gallery.remove();
        else {
          const position = Math.min(index + 1, remaining);
          count.textContent = `${position} / ${remaining}`;
        }
      }, { once: true });
      figure.append(image);
      const caption = document.createElement("figcaption");
      caption.className = "item-image-caption";
      caption.textContent = record.label || (record.kind === "article" ? "ARTICLE IMAGE" : "ITEM IMAGE");
      figure.append(caption);
      track.append(figure);
      slides.push(figure);
    });
    viewport.append(track);

    const controls = document.createElement("div");
    controls.className = "item-image-controls";
    controls.hidden = images.length < 2;
    const previous = document.createElement("button");
    previous.type = "button";
    previous.className = "item-image-arrow";
    previous.setAttribute("aria-label", "Previous image");
    previous.textContent = "‹";
    const dots = document.createElement("div");
    dots.className = "item-image-dots";
    const next = document.createElement("button");
    next.type = "button";
    next.className = "item-image-arrow";
    next.setAttribute("aria-label", "Next image");
    next.textContent = "›";

    let active = 0;
    const dotButtons = images.map((_, index) => {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "item-image-dot";
      dot.setAttribute("aria-label", `Show image ${index + 1}`);
      dot.setAttribute("aria-current", String(index === 0));
      dot.addEventListener("click", () => goTo(index));
      dots.append(dot);
      return dot;
    });
    function updateActive(index) {
      active = Math.max(0, Math.min(index, slides.length - 1));
      count.textContent = `${active + 1} / ${slides.length}`;
      dotButtons.forEach((dot, dotIndex) => dot.setAttribute("aria-current", String(dotIndex === active)));
      previous.disabled = active === 0;
      next.disabled = active >= slides.length - 1;
    }
    function goTo(index) {
      const slide = slides[index];
      if (!slide) return;
      slide.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
      updateActive(index);
    }
    previous.addEventListener("click", () => goTo(active - 1));
    next.addEventListener("click", () => goTo(active + 1));
    track.addEventListener("scroll", () => {
      if (!slides.length) return;
      const position = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      updateActive(position);
    }, { passive: true });
    controls.append(previous, dots, next);
    updateActive(0);
    gallery.append(heading, viewport, controls);
    return gallery;
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
  }

  function addText(parent, label, value) {
    if (!value) return;
    const row = document.createElement("div");
    row.className = "raffle-extra-row";
    const strong = document.createElement("strong");
    strong.textContent = `${label}:`;
    const span = document.createElement("span");
    span.textContent = value;
    row.append(strong, span);
    parent.append(row);
  }

  function addSourceArticleLink(card, item) {
    const sourceUrl = httpUrl(item.sourceUrl) || httpUrl(item.url);
    if (!sourceUrl) return;
    const existing = [...card.querySelectorAll("a.post-action")].find((link) => link.href === sourceUrl);
    if (existing) {
      existing.classList.add("post-action-secondary");
      existing.textContent = "READ SOURCE ANNOUNCEMENT";
      return;
    }
    const link = document.createElement("a");
    link.className = "post-action post-action-secondary product-source-link";
    link.href = sourceUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "READ SOURCE ANNOUNCEMENT";
    card.append(link);
  }

  function enhanceProductDestination(card, item) {
    if (card.dataset.productDestinationBuilt === "true") return;
    const actions = [...card.querySelectorAll("a.post-action")];
    const original = actions.find((link) => !link.classList.contains("post-action-secondary")) || null;
    const productUrl = httpUrl(item.productUrl);
    const fallbackLinks = (Array.isArray(item.productSearchLinks) ? item.productSearchLinks : [])
      .map((entry) => ({ url: httpUrl(entry?.url), retailer: String(entry?.retailer || "retailer") }))
      .filter((entry) => entry.url);
    const legacySearchUrl = httpUrl(item.productSearchUrl);
    if (!fallbackLinks.length && legacySearchUrl) {
      fallbackLinks.push({ url: legacySearchUrl, retailer: String(item.productSearchRetailer || "retailer") });
    }
    const sourceLinkExists = () => [...card.querySelectorAll("a.post-action")].some((link) => link.classList.contains("post-action-secondary"));

    if (productUrl) {
      let link = original;
      if (!link) {
        link = document.createElement("a");
        link.className = "post-action";
        card.append(link);
      }
      const retailer = String(item.productRetailer || "retailer").toUpperCase();
      link.href = productUrl;
      link.textContent = /out of stock|sold out|discontinued/i.test(item.productAvailability || "")
        ? `OPEN ${retailer} PRODUCT PAGE`
        : /in stock|pre.?order|back order/i.test(item.productAvailability || "")
          ? `BUY AT ${retailer}`
          : `VIEW PRODUCT AT ${retailer}`;
      link.dataset.destinationType = "verified-product";
      link.rel = "noopener noreferrer sponsored";
      addSourceArticleLink(card, item);
    } else if (fallbackLinks.length) {
      const first = fallbackLinks[0];
      let link = original;
      if (!link) {
        link = document.createElement("a");
        link.className = "post-action";
        card.append(link);
      }
      link.href = first.url;
      link.textContent = `SEARCH ${first.retailer.toUpperCase()} FOR ITEM`;
      link.dataset.destinationType = "retailer-search";
      link.rel = "noopener noreferrer";
      for (const entry of fallbackLinks.slice(1)) {
        const extra = document.createElement("a");
        extra.className = "post-action post-action-secondary product-search-alternative";
        extra.href = entry.url;
        extra.target = "_blank";
        extra.rel = "noopener noreferrer";
        extra.textContent = `ALSO SEARCH ${entry.retailer.toUpperCase()}`;
        card.append(extra);
      }
      addSourceArticleLink(card, item);
      const note = document.createElement("p");
      note.className = "product-destination-note";
      note.textContent = "These open retailer search results, not a confirmed individual product listing. Check the exact item, seller and stock before buying.";
      const summary = card.querySelector(".post-summary");
      if (summary) summary.insertAdjacentElement("afterend", note);
      else card.insertBefore(note, link);
    } else {
      if (original) {
        const missing = document.createElement("span");
        missing.className = "post-action post-action-missing";
        missing.textContent = "PRODUCT PAGE NOT VERIFIED";
        original.replaceWith(missing);
      }
      addSourceArticleLink(card, item);
      const note = document.createElement("p");
      note.className = "product-destination-note";
      note.textContent = "This is a news/source alert, not a confirmed purchase listing. No retailer destination was found.";
      const summary = card.querySelector(".post-summary");
      if (summary) summary.insertAdjacentElement("afterend", note);
    }

    if (productUrl || fallbackLinks.length || item.productPrice || item.productAvailability) {
      const details = document.createElement("div");
      details.className = "product-extra-details";
      if (item.productName) {
        const name = document.createElement("div");
        name.textContent = item.productName;
        details.append(name);
      }
      if (item.productPrice) {
        const price = document.createElement("div");
        const label = document.createElement("strong");
        label.textContent = "PRICE:";
        price.append(label, document.createTextNode(` ${String(item.productPrice)}`));
        details.append(price);
      }
      if (item.productAvailability) {
        const availability = document.createElement("div");
        const label = document.createElement("strong");
        label.textContent = "LISTING STATUS:";
        availability.append(label, document.createTextNode(` ${String(item.productAvailability)}`));
        details.append(availability);
      }
      const source = card.querySelector(".post-source");
      if (source) card.insertBefore(details, source);
      else card.append(details);
    }
    card.dataset.productDestinationBuilt = "true";
  }

  function enhanceCard(card) {
    if (!ready || !(card instanceof HTMLElement)) return;
    const heading = card.querySelector("h3");
    const titleKey = normalize(heading?.textContent);
    if (!titleKey) return;
    const isRaffle = card.dataset.category === "Raffle" || card.classList.contains("raffle-card");
    if (isRaffle && !validRaffleTitles.has(titleKey)) {
      card.remove();
      return;
    }
    const item = itemsByTitle.get(titleKey);
    if (!item) return;

    if (card.dataset.itemImagesBuilt !== "true") {
      const gallery = buildCarousel(item);
      const summary = card.querySelector(".post-summary");
      if (gallery) {
        if (summary) card.insertBefore(gallery, summary);
        else if (heading) heading.insertAdjacentElement("afterend", gallery);
      }
      card.dataset.itemImagesBuilt = "true";
    }

    if (!isRaffle) {
      enhanceProductDestination(card, item);
      return;
    }
    if (!item.entryUrl && item.entrySearchUrl && !card.querySelector(".entry-search-fallback")) {
      const searchLink = document.createElement("a");
      searchLink.className = "post-action post-action-secondary entry-search-fallback";
      searchLink.href = httpUrl(item.entrySearchUrl);
      searchLink.target = "_blank";
      searchLink.rel = "noopener noreferrer";
      searchLink.textContent = "SEARCH FOR OFFICIAL ENTRY PAGE";
      if (searchLink.href) card.append(searchLink);
    }
    if (card.dataset.raffleExtraDetails === "true") return;
    const details = document.createElement("div");
    details.className = "raffle-extra-details";
    let hasContent = false;

    if (item.prize) {
      const prize = document.createElement("p");
      prize.className = "raffle-extra-prize";
      const label = document.createElement("span");
      label.className = "raffle-extra-label";
      label.textContent = "IDENTIFIED PRIZE";
      const value = document.createElement("span");
      value.textContent = item.prize;
      prize.append(label, value);
      details.append(prize);
      hasContent = true;
    }

    if (item.startDate || item.endDate) {
      if (item.startDate) addText(details, "ENTRY START", dateLabel(item.startDate));
      if (item.endDate) addText(details, "ENTRY DEADLINE", dateLabel(item.endDate));
      hasContent = true;
    }

    const siteUrl = httpUrl(item.siteUrl);
    if (item.siteName || siteUrl) {
      const site = document.createElement("div");
      site.className = "raffle-extra-row";
      const label = document.createElement("strong");
      label.textContent = "SITE:";
      if (siteUrl) {
        const link = document.createElement("a");
        link.className = "raffle-extra-site";
        link.href = siteUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = item.siteName || new URL(siteUrl).hostname;
        site.append(label, link);
      } else {
        const name = document.createElement("span");
        name.textContent = item.siteName;
        site.append(label, name);
      }
      details.append(site);
      hasContent = true;
    }

    if (item.lastVerifiedAt) {
      addText(details, "LAST VERIFIED", dateLabel(item.lastVerifiedAt));
      hasContent = true;
    }
    if (hasContent) {
      const source = card.querySelector(".post-source");
      if (source) card.insertBefore(details, source);
      else card.append(details);
    }
    card.dataset.raffleExtraDetails = "true";
  }

  function enhanceCards() {
    if (!ready) return;
    document.querySelectorAll(".post-card").forEach(enhanceCard);
    const count = document.querySelector("#result-count");
    if (count) count.textContent = String(document.querySelectorAll("#feed .post-card").length);
  }

  async function loadData() {
    const [postsResult, rafflesResult] = await Promise.allSettled([
      fetch("posts.json", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`Posts request failed (${response.status})`);
        return response.json();
      }),
      fetch("raffles.json", { cache: "no-store" }).then((response) => {
        if (!response.ok) throw new Error(`Raffles request failed (${response.status})`);
        return response.json();
      })
    ]);

    if (postsResult.status === "fulfilled" && Array.isArray(postsResult.value)) {
      for (const item of postsResult.value) {
        const key = normalize(item?.title);
        if (key) itemsByTitle.set(key, item);
      }
    }
    if (rafflesResult.status === "fulfilled" && Array.isArray(rafflesResult.value)) {
      for (const item of rafflesResult.value) {
        const key = normalize(item?.title);
        if (!key) continue;
        itemsByTitle.set(key, item);
        validRaffleTitles.add(key);
      }
    }
    ready = true;
    enhanceCards();
  }

  const feed = document.querySelector("#feed");
  if (feed && "MutationObserver" in window) {
    const observer = new MutationObserver(enhanceCards);
    observer.observe(feed, { childList: true, subtree: true });
  }

  async function refreshDiagnostics() {
    const holder = document.querySelector("#feed-diagnostics-content");
    if (!holder) return;
    try {
      const response = await fetch("feed-status.json", { cache: "no-store" });
      if (!response.ok) return;
      const diagnostics = await response.json();
      const raffle = diagnostics.raffles || {};
      const discovery = raffle.discoveryEngine || {};
      const imageDiscovery = (diagnostics.news || {}).itemImageDiscovery || {};
      let line = document.querySelector("#raffle-enrichment-diagnostics");
      if (!line) {
        line = document.createElement("p");
        line.id = "raffle-enrichment-diagnostics";
        line.className = "diagnostics-summary";
        holder.append(line);
      }
      const summary = `VERIFIED RAFFLES: ${discovery.entryLinksValidated || 0} ENTRY LINKS · ${discovery.prizeDetailsFound || 0} PRIZES · ${discovery.endDatesFound || 0} DEADLINES · ${discovery.rejectedFalsePositives || 0} FALSE POSITIVES FILTERED`;
      if (line.textContent !== summary) line.textContent = summary;
      let imageLine = document.querySelector("#item-image-diagnostics");
      if (!imageLine) {
        imageLine = document.createElement("p");
        imageLine.id = "item-image-diagnostics";
        imageLine.className = "diagnostics-summary";
        holder.append(imageLine);
      }
      const imageSummary = `ITEM IMAGES: ${imageDiscovery.itemsWithImages || 0} ALERTS WITH IMAGES · ${imageDiscovery.pagesChecked || 0} PAGES CHECKED THIS RUN`;
      if (imageLine.textContent !== imageSummary) imageLine.textContent = imageSummary;
      let destinationLine = document.querySelector("#destination-diagnostics");
      if (!destinationLine) {
        destinationLine = document.createElement("p");
        destinationLine.id = "destination-diagnostics";
        destinationLine.className = "diagnostics-summary";
        holder.append(destinationLine);
      }
      const destinationSummary = `PURCHASE DESTINATIONS: ${imageDiscovery.verifiedProductPages || 0} VERIFIED PRODUCT PAGES · ${imageDiscovery.retailerSearchFallbacks || 0} RETAILER SEARCH FALLBACKS · GIVEAWAY ENTRIES: ${raffle.directEntryLinksFound || 0} VERIFIED ENTRY PAGES · ${raffle.entrySearchFallbacks || 0} ENTRY SEARCH FALLBACKS`;
      if (destinationLine.textContent !== destinationSummary) destinationLine.textContent = destinationSummary;
      let searchLine = document.querySelector("#search-diagnostics");
      if (!searchLine) {
        searchLine = document.createElement("p");
        searchLine.id = "search-diagnostics";
        searchLine.className = "diagnostics-summary";
        holder.append(searchLine);
      }
      const searchStats = discovery.search || imageDiscovery.search || {};
      const searchSummary = `PUBLIC SEARCH LOOKUPS: ${searchStats.successfulQueries || 0} QUERIES RETURNED RESULTS · ${searchStats.resultLinks || 0} RESULT LINKS PARSED · ${searchStats.errors || 0} REQUEST ERRORS`;
      if (searchLine.textContent !== searchSummary) searchLine.textContent = searchSummary;
    } catch (error) {
      console.warn("PokeDrop image/giveaway diagnostics unavailable:", error);
    }
  }

  loadData().catch((error) => console.warn("PokeDrop card enrichment unavailable:", error));
  window.setTimeout(refreshDiagnostics, 350);
  const diagnosticsHolder = document.querySelector("#feed-diagnostics-content");
  if (diagnosticsHolder && "MutationObserver" in window) {
    const observer = new MutationObserver(() => window.setTimeout(refreshDiagnostics, 0));
    observer.observe(diagnosticsHolder, { childList: true, subtree: true });
  }
})();
