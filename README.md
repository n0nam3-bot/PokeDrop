# PokeDrop

PokeDrop is a free, Pokémon-inspired 8-bit community radar for Pokémon TCG restocks, exclusive deals, rare drops, new releases, promos, raffles and giveaways. It runs as a static site on GitHub Pages with no paid API or hosted database.

## Drop Finder

- The Drop Finder contains all categories, including **Raffles + Giveaways**. Raffles are not displayed in a separate page section.
- Selecting **Raffles + Giveaways** reveals the additional entry-status filter: **All statuses**, **Upcoming**, **Open**, **Closed** and **Verify**.
- Search and retailer/store filters apply to both regular alerts and raffle/giveaway leads.
- The Drop Finder sticks to the top of the viewport while scrolling down and returns to its normal document position at the top.
- `posts.json` stores regular alerts. `raffles.json` stores raffle/giveaway leads and a best-effort status. Both datasets are rendered in the same feed.

## Free data collection

- `.github/workflows/update.yml` runs every 30 minutes and can be started manually from GitHub Actions.
- `scripts/update.mjs` collects public headlines from Google News RSS searches, removes duplicates and keeps up to 45 days of regular news coverage.
- Raffle searches cover TCG giveaways, card raffles, booster boxes, Elite Trainer Boxes, sweepstakes, local card shops, and targeted searches for Target, Walmart, GameStop, Best Buy, Costco and Pokémon Center.
- Raffle history is retained for up to **365 days**, separately from the regular news retention window. Announcements older than 45 days are moved to **Closed** as archived leads unless the source gives a more specific date/status; the card explains that this is an age-based inference.
- `feed-status.json` records how many searches responded, how many raw results each returned, how many leads were saved, and which requests failed. Open **VIEW FEED SOURCE STATUS** below the result counter to diagnose a zero count.
- Raffle status is inferred from article headlines/snippets, not verified directly by retailers. Ambiguous fresh entries are marked **Verify** rather than being guessed as open.

**Important:** the GitHub Pages feed is a free public-news radar, not a live retailer inventory checker or official raffle-registration integration. Search coverage can miss active store-run giveaways and can surface old or incomplete information. The raffle status is not confirmed by the retailer. Open the source and check the official entry page for current dates, rules, eligibility and availability.

## Free local product monitor (Windows)

The optional `local-monitor/` tool complements the website by checking the **direct retailer product URLs you add** and sending Discord restock alerts. It is not a paid hosted service and does not change the GitHub Pages feed.

- Runs on your own Windows PC using free **Node.js 20+** and built-in Node features; no npm packages, AI provider, paid API key, database, or proxy is required.
- Tracks up to 30 direct product pages and checks every 2–30 minutes (3 minutes by default).
- Reads public Schema.org/JSON-LD and common product availability metadata, with a public Shopify product-data fallback when available.
- Sends a Discord webhook alert when the first scan finds an available item (optional) or an item changes from OUT OF STOCK/UNKNOWN to IN STOCK/PREORDER.
- Keeps the watchlist and Discord webhook in `local-monitor/data/` on that PC. Those runtime files are excluded from Git.

To start it, get the updated repository files onto your Windows PC, install Node.js 20 LTS or later, and double-click `local-monitor/start.bat`. Add the retailer's actual product detail page in the local dashboard at `http://127.0.0.1:8787`, then configure a Discord webhook under **Configure Discord Notifications**. Keep the terminal window open and the PC awake for scheduled checks. Full setup and troubleshooting are in [`local-monitor/README.md`](local-monitor/README.md).

This monitor is a watchlist tracker, not an automatic catalog crawler: use the news feed to discover a product, then paste its direct retailer product page into the watchlist. Some retailers block automated requests or do not expose stock status. Such pages are marked **UNKNOWN**, **BLOCKED**, or **ERROR** instead of generating guessed restock alerts. The monitor does not bypass queues, CAPTCHAs, account protections, or automate checkout.

## Upload a ZIP to update the repository automatically

1. Open the repository on GitHub and open the `uploads/` folder.
2. Choose **Add file → Upload files**, select your repository ZIP, and commit the upload.
3. The **Extract uploaded ZIP** GitHub Actions workflow runs automatically. It extracts the ZIP into matching repository paths, strips one outer project folder when present, removes the uploaded ZIP, commits the extracted files, and requests a GitHub Pages rebuild.

Upload one project or patch ZIP at a time. Do not put the ZIP in the repository root; use `uploads/`. The importer protects every file under `.github/workflows/` and its own extraction script, ignores ZIP paths inside `uploads/`, and rejects unsafe archive paths. This is intentional: the automatic Actions token can update site files, but cannot replace workflow definitions. Update workflow files directly in GitHub when needed. GitHub Actions must have **Read and write permissions** under **Settings → Actions → General → Workflow permissions**. No API key, AI provider, or paid token is required.

## Publish on GitHub Pages

1. Keep the files and folders in this repository structure, including `fonts/`, `scripts/` and `.github/workflows/`.
2. In GitHub, open **Settings → Pages** and make sure Pages is configured to deploy from the branch containing these files (usually the root of `main`).
3. Open **Settings → Actions → General → Workflow permissions** and select **Read and write permissions** so the updater can commit `posts.json` and `raffles.json`.
4. Open **Actions → Update feed → Run workflow** to refresh headlines and giveaway leads immediately. Scheduled runs follow every 30 minutes.

Because the ZIP importer protects workflow files, make this one-time change directly in `.github/workflows/update.yml` after the first upload: use `actions/checkout@v5` instead of `@v4`, and change `git add posts.json raffles.json` to `git add posts.json raffles.json feed-status.json`. This lets scheduled runs publish the new on-page source diagnostics.

## Customize search sources

Edit the `FEEDS` and `RAFFLE_FEEDS` arrays near the top of `scripts/update.mjs`. Each entry is a free Google News RSS query. The site uses no paid API key or paid external service.

## Design and attribution

- The bundled `fonts/PKMN-RBYGSC.ttf` font is used throughout the interface.
- The Poké Ball mark is drawn as crisp pixel art directly in `index.html`.
- The responsive layout supports mobile, tablet and desktop.
- Pokémon and related product names are trademarks of their respective owners. PokeDrop is a fan-made project and is not affiliated with Nintendo, Game Freak or The Pokémon Company.
- Review the font's license before using it commercially. Update the affiliate disclosure in `index.html` to match the links and monetization actually used by the site.
