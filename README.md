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
- `scripts/update.mjs` collects public headlines from Google News RSS searches, removes duplicates and keeps up to 45 days of coverage.
- The collector also uses several targeted searches for TCG raffles, store giveaways, booster-box prizes, Pokémon Center lotteries, local card shops and community contests. Search results from these targeted queries are retained even when the short RSS headline/snippet does not repeat the search term.
- Raffle status is inferred from article headlines/snippets. Clear closed or opening/closing date wording is used when available; ambiguous entries are marked **Verify** rather than being guessed as open.

**Important:** this is a free public-news radar, not a live retailer inventory checker or official raffle-registration integration. Search coverage can miss active store-run giveaways and can surface old or incomplete information. The raffle status is not confirmed by the retailer. Open the source and check the official entry page for current dates, rules, eligibility and availability.

## Upload a ZIP to update the repository automatically

1. Open the repository on GitHub and open the `uploads/` folder.
2. Choose **Add file → Upload files**, select your repository ZIP, and commit the upload.
3. The **Extract uploaded ZIP** GitHub Actions workflow runs automatically. It extracts the ZIP into matching repository paths, strips one outer project folder when present, removes the uploaded ZIP, commits the extracted files, and requests a GitHub Pages rebuild.

Upload one complete project ZIP at a time. Do not put the ZIP in the repository root; use `uploads/`. The importer protects every file under `.github/workflows/` and its own extraction script, ignores ZIP paths inside `uploads/`, and rejects unsafe archive paths. This is intentional: the automatic Actions token can update site files, but cannot replace workflow definitions. Update workflow files directly in GitHub when needed. GitHub Actions must have **Read and write permissions** under **Settings → Actions → General → Workflow permissions**. No API key, AI provider, or paid token is required.

## Publish on GitHub Pages

1. Keep the files and folders in this repository structure, including `fonts/`, `scripts/` and `.github/workflows/`.
2. In GitHub, open **Settings → Pages** and make sure Pages is configured to deploy from the branch containing these files (usually the root of `main`).
3. Open **Settings → Actions → General → Workflow permissions** and select **Read and write permissions** so the updater can commit `posts.json` and `raffles.json`.
4. Open **Actions → Update feed → Run workflow** to refresh headlines and giveaway leads immediately. Scheduled runs follow every 30 minutes.

## Customize search sources

Edit the `FEEDS` and `RAFFLE_FEEDS` arrays near the top of `scripts/update.mjs`. Each entry is a free Google News RSS query. The site uses no paid API key or paid external service.

## Design and attribution

- The bundled `fonts/PKMN-RBYGSC.ttf` font is used throughout the interface.
- The Poké Ball mark is drawn as crisp pixel art directly in `index.html`.
- The responsive layout supports mobile, tablet and desktop.
- Pokémon and related product names are trademarks of their respective owners. PokeDrop is a fan-made project and is not affiliated with Nintendo, Game Freak or The Pokémon Company.
- Review the font's license before using it commercially. Update the affiliate disclosure in `index.html` to match the links and monetization actually used by the site.
