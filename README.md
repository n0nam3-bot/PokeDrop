# PokeDrop — web-only stock radar update

This update changes PokeDrop from a headline-first page into a product-first Pokémon TCG stock dashboard. It is designed to run entirely online using GitHub Pages and GitHub Actions. **There is no PC app, local server, Node installation, or computer that must stay running.**

## What changes

- The home page opens on **Stock Radar**, not a mixed headline feed.
- Stock cards are populated only from retailer product-detail pages that pass the Pokémon TCG product identity checks.
- Stock states are separate: **In Stock**, **Preorder**, **Sold Out**, **Unconfirmed**, and **Check Blocked**. A blocked page is never labeled sold out.
- News and giveaway leads are moved to a separate community section. They do not count as products or restocks.
- Search, retailer filters, responsive cards, product images, prices, last-check time, and source diagnostics are included.
- A cloud workflow searches public retailer listings, checks product pages, updates `products.json`, and can send Discord restock alerts.

## One-time GitHub setup

The ZIP importer intentionally protects `.github/workflows/`, so it will skip the workflow file inside this patch. Upload this ZIP through the repository's existing `uploads/` folder first. After the extraction workflow finishes, create the new workflow in GitHub:

1. Open **Add file → Create new file** in the repository.
2. Set the path to `.github/workflows/retailer-monitor.yml`.
3. Copy the complete contents from the root file `retailer-monitor.workflow.txt` in the extracted repository.
4. Commit the new workflow.

The new workflow checks on a five-minute schedule and can also be run manually from **Actions → Retailer stock monitor → Run workflow**. GitHub may delay scheduled starts; five minutes is the schedule interval, not a guaranteed real-time SLA.

## Optional free Discord alerts

To receive notifications when a newly found product is in stock / preorder or when a previously unavailable product becomes available:

1. Create a Discord webhook in a channel you control.
2. In GitHub, open **Settings → Secrets and variables → Actions → New repository secret**.
3. Name the secret `DISCORD_WEBHOOK_URL` and paste the webhook URL as its value.

Without this secret, the hosted page and product checks still work; only Discord delivery is disabled. The webhook is kept in GitHub Secrets and is never written into the website files.

## Cost and limits

- GitHub Pages: free for this public repository.
- GitHub Actions: standard public-repository runner usage for this scheduled monitor.
- Retailer discovery: free public Bing / DuckDuckGo search result pages; no paid search API.
- Notifications: free Discord webhook.
- AI / LLM: none.
- Paid APIs, npm packages, local installs, checkout automation, queue bypass, and CAPTCHA solving: none.

Retailers can block automated requests or serve incomplete pages. The monitor records those cases as **Check Blocked** / **Unconfirmed** and will not fabricate an in-stock result. The first scan may take a few minutes to populate. The checker currently covers the retailer domains listed in `scripts/retailer-monitor.mjs`; it is not a promise of complete coverage of every retailer or every SKU.

## Files in this patch

- Replaces `index.html` and `README.md`.
- Adds `storefront.css`, `storefront.js`, `products.json`, `product-status.json`, and `scripts/retailer-monitor.mjs`.
- Provides `retailer-monitor.workflow.txt`, which must be copied once into `.github/workflows/retailer-monitor.yml` because the ZIP importer protects workflow paths.
- No existing news collector or giveaway data file is deleted or overwritten.

The old `local-monitor/` directory from the earlier add-on is not referenced by this page or cloud workflow. It can be deleted from the repository after this update; it is not required and must not be run.
