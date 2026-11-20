// Adds the verified/enriched giveaway details to existing PokeDrop raffle cards.
// This is an additive layer: the current card builder and all non-raffle cards remain unchanged.
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
    .raffle-extra-details { display:grid; gap:9px; margin:2px 0 13px; padding:11px; color:var(--deep); background:rgba(228,223,190,.48); border:2px dashed #9a997e; font-size:8px; line-height:1.8; overflow-wrap:anywhere; }
    .raffle-extra-image { display:grid; gap:5px; margin:0; padding:8px; background:var(--white); border:2px solid var(--ink); }
    .raffle-extra-image img { display:block; width:100%; max-height:210px; object-fit:contain; image-rendering:auto; }
    .raffle-extra-image figcaption,.raffle-extra-label { color:var(--muted); font-size:7px; letter-spacing:.05em; text-transform:uppercase; }
    .raffle-extra-prize { margin:0; color:var(--ink); font-size:9px; line-height:1.9; }
    .raffle-extra-row { display:flex; flex-wrap:wrap; gap:5px 14px; }
    .raffle-extra-row strong { color:var(--ink); font-weight:normal; }
    .raffle-extra-site { color:var(--deep); text-decoration:underline; text-underline-offset:2px; }
    .raffle-extra-verified { color:var(--muted); font-size:7px; }
  `;
  document.head.append(style);

  let detailsByTitle = new Map();
  let ready = false;

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

  function dateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
  }

  function enhanceCards() {
    if (!ready) return;
    document.querySelectorAll(".raffle-card").forEach((card) => {
      if (card.dataset.raffleExtraDetails === "true") return;
      const heading = card.querySelector("h3");
      const item = detailsByTitle.get(normalize(heading?.textContent));
      if (!item) return;

      const details = document.createElement("div");
      details.className = "raffle-extra-details";
      let hasContent = false;

      const imageUrl = httpUrl(item.imageUrl);
      if (imageUrl) {
        const figure = document.createElement("figure");
        figure.className = "raffle-extra-image";
        const image = document.createElement("img");
        image.loading = "lazy";
        image.decoding = "async";
        image.alt = item.prize ? `Giveaway prize: ${item.prize}` : `${item.siteName || "Giveaway"} image`;
        image.src = imageUrl;
        image.addEventListener("error", () => figure.remove(), { once: true });
        const caption = document.createElement("figcaption");
        caption.textContent = item.imageType === "prize" ? "PRIZE IMAGE · STRUCTURED GIVEAWAY DATA" : "PAGE / FEATURED IMAGE · PRIZE NOT CONFIRMED";
        figure.append(image, caption);
        details.append(figure);
        hasContent = true;
      }

      if (item.prize) {
        const prize = document.createElement("p");
        prize.className = "raffle-extra-prize";
        const label = document.createElement("span");
        label.className = "raffle-extra-label";
        label.textContent = "POTENTIAL PRIZE";
        const value = document.createElement("span");
        value.textContent = item.prize;
        prize.append(label, document.createElement("br"), value);
        details.append(prize);
        hasContent = true;
      }

      if (item.startDate || item.endDate) {
        const dates = document.createElement("div");
        dates.className = "raffle-extra-row";
        if (item.startDate) addText(dates, "START DATE", dateLabel(item.startDate));
        if (item.endDate) addText(dates, "ENTRY DEADLINE", dateLabel(item.endDate));
        details.append(dates);
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
        const verified = document.createElement("div");
        verified.className = "raffle-extra-verified";
        verified.textContent = `PAGE LAST CHECKED: ${dateLabel(item.lastVerifiedAt)}`;
        details.append(verified);
        hasContent = true;
      }

      if (hasContent) {
        const source = card.querySelector(".post-source");
        if (source) card.insertBefore(details, source);
        else card.append(details);
      }
      card.dataset.raffleExtraDetails = "true";
    });
  }

  async function loadRaffleDetails() {
    try {
      const response = await fetch("raffles.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Raffle metadata request failed (${response.status})`);
      const list = await response.json();
      if (!Array.isArray(list)) throw new Error("Raffle metadata is not a list");
      detailsByTitle = new Map();
      for (const item of list) {
        const key = normalize(item?.title);
        if (key) detailsByTitle.set(key, item);
      }
      ready = true;
      enhanceCards();
    } catch (error) {
      console.warn("PokeDrop raffle details unavailable:", error);
    }
  }

  const feed = document.querySelector("#feed");
  if (feed && "MutationObserver" in window) {
    const observer = new MutationObserver(enhanceCards);
    observer.observe(feed, { childList: true, subtree: true });
  }
  async function refreshEnrichmentDiagnostics() {
    const holder = document.querySelector("#feed-diagnostics-content");
    if (!holder) return;
    try {
      const response = await fetch("feed-status.json", { cache: "no-store" });
      if (!response.ok) return;
      const diagnostics = await response.json();
      const raffle = diagnostics.raffles || {};
      const details = raffle.discoveryEngine || {};
      let line = document.querySelector("#raffle-enrichment-diagnostics");
      if (!line) {
        line = document.createElement("p");
        line.id = "raffle-enrichment-diagnostics";
        line.className = "diagnostics-summary";
        holder.append(line);
      }
      const summary = `DETAIL EXTRACTION: ${details.prizeDetailsFound || 0} PRIZES · ${details.startDatesFound || 0} START DATES · ${details.endDatesFound || 0} DEADLINES · ${(details.prizeImagesFound || 0) + (details.featuredImagesFound || 0)} IMAGES · ${details.publisherPagesChecked || 0} PAGES CHECKED THIS RUN`;
      if (line.textContent !== summary) line.textContent = summary;
    } catch (error) {
      console.warn("PokeDrop raffle enrichment diagnostics unavailable:", error);
    }
  }

  const diagnosticsHolder = document.querySelector("#feed-diagnostics-content");
  if (diagnosticsHolder && "MutationObserver" in window) {
    let diagnosticsRefreshQueued = false;
    const diagnosticsObserver = new MutationObserver(() => {
      if (diagnosticsRefreshQueued) return;
      diagnosticsRefreshQueued = true;
      window.setTimeout(() => {
        diagnosticsRefreshQueued = false;
        refreshEnrichmentDiagnostics();
      }, 0);
    });
    diagnosticsObserver.observe(diagnosticsHolder, { childList: true, subtree: true });
  }

  loadRaffleDetails();
  window.setTimeout(refreshEnrichmentDiagnostics, 250);
})();
