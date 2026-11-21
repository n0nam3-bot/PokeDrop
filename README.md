# PokeDrop patch — restore the original site and repair cloud stock discovery

This patch restores the original PokeDrop Drop Finder page and adds a Stock Radar section in the same existing pixel-art style. It does not load the redesigned `storefront.css` / `storefront.js` files. The replacement cloud workflow also removes the abandoned PC-only `local-monitor/` folder and the unused redesign files on its first run.

## What this patch changes

- Restores `index.html` to the original PokeDrop layout and adds only the `stock-ui.js` script include.
- Adds a Stock Radar panel that reuses the existing `feed-section`, `feed-grid`, `post-card`, and tag styles. It does not replace the site's header, colors, fonts, layout, filters, or existing news/giveaway feed.
- Reworks `scripts/retailer-monitor.mjs` to search each retailer's own public product-search page first, then fall back to Bing RSS, Bing HTML, and DuckDuckGo HTML result links. It no longer depends only on Bing/DDG CSS class names that produced zero parsed links.
- Separates retailer search responses from actual product-page checks. A search page returning HTTP 200 with no product links is reported as a limited scan, not a completed stock check.
- Rechecks known product URLs and retains their last verified stock state when a later retailer check is blocked or errors. Failed checks do not turn a product into “sold out.”
- Adds visible product search filters and per-retailer health diagnostics to the original page style.
- Provides an updated workflow file that shares the existing `update-feed` concurrency group to prevent the feed updater and stock monitor from racing to push commits at the same time.

## Install through the existing ZIP importer

1. Upload this ZIP to the repository's `uploads/` folder and commit it.
2. Wait for **Extract uploaded ZIP** to finish.
3. Because the ZIP importer protects `.github/workflows/`, open `.github/workflows/retailer-monitor.yml` directly in GitHub and replace its contents with `retailer-monitor.workflow.txt` from this patch. Commit that file change.
4. Run **Actions → Retailer stock monitor → Run workflow**.
5. The first run also removes the obsolete PC-only monitor folder and unused redesign files from the repository. Let the run complete, then refresh the Pages site. The stock panel will appear above the existing Trainer Alerts section.

The existing `Update feed` workflow already uses the `update-feed` concurrency group. The replacement retailer workflow uses that same group to prevent the two jobs from checking out the same old commit and then racing their `git push` operations.

## Notifications

Discord is optional. Create a Discord webhook and add it in **Repository → Settings → Secrets and variables → Actions → New repository secret**:

- Name: `DISCORD_WEBHOOK_URL`
- Value: your Discord webhook URL

No AI, paid API, npm package, local server, PC installation, or continuously running computer is required.

## Important limitations

The cloud scan uses public retailer search pages and public product detail pages. Some retailers return search results only after JavaScript, block cloud-hosted requests, or do not expose product availability in page markup. Those cases are marked as limited, blocked, or unconfirmed. A store that cannot be checked is not treated as sold out, and no alert is sent without a product-specific page and an explicit availability signal.

GitHub Actions' five-minute schedule is a requested cadence, not a guaranteed real-time polling SLA. GitHub can delay scheduled jobs under load. The system never automates checkout, bypasses queues, or solves CAPTCHAs.

## Local test

The scanner has an offline fixture test:

```bash
node scripts/retailer-monitor.mjs --self-test
```

This tests retailer product URL parsing, retailer-page link extraction, Bing RSS parsing, product structured data, stock classification, and duplicate-alert handling. It does not claim live retailer access; the first hosted scan is the real integration check.
