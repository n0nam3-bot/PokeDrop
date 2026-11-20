# PokeDrop

PokeDrop is a free, Pokémon-inspired 8-bit community radar for Pokémon TCG restocks, exclusive deals, rare drops, new releases, promos, raffles and giveaways. It is designed to run as a static site on GitHub Pages with no paid API or hosted database.

## How the free feed works

- `.github/workflows/update.yml` runs every 30 minutes and can also be started manually from the GitHub Actions tab.
- `scripts/update.mjs` collects public headlines from Google News RSS searches, classifies feed categories, removes duplicates and keeps the most recent 45 days of coverage.
- The same collector searches for TCG raffles and giveaways across general coverage, Pokémon Center, major retailers and local card shops.
- `posts.json` stores the regular alerts. `raffles.json` stores raffle/giveaway headlines with a best-effort status of **Upcoming**, **Open**, **Closed** or **Verify**.
- The raffle board has status, store and text filters. Status is inferred from the headline/snippet; unclear entries are marked **Verify** instead of being guessed as open.
- `index.html`, `style.css` and `app.js` display the feeds. Search and filters run in the browser.

**Important:** this is a free public-news radar, not a live retailer inventory or official raffle-registration integration. Google News may miss store-run giveaways or surface coverage that is no longer active. The status is not confirmed by the retailer. Open the source and check the official entry page for dates, rules, eligibility and availability.

## Upload a ZIP to update the repository automatically

1. Open the repository on GitHub and open the `uploads/` folder.
2. Choose **Add file → Upload files**, select your repository ZIP, and commit the upload.
3. The **Extract uploaded ZIP** GitHub Actions workflow runs automatically. It extracts the ZIP into the matching repository paths, strips a single outer project folder when present (such as `PokeDrop-main/`), removes the uploaded ZIP, commits the extracted files, and requests a GitHub Pages rebuild.

Upload one complete project ZIP at a time. Do not put the ZIP in the repository root; use `uploads/`. The importer protects its own workflow and extraction script, ignores ZIP paths inside `uploads/`, and rejects unsafe archive paths. GitHub Actions must have **Read and write permissions** under **Settings → Actions → General → Workflow permissions**. No API key, AI provider, or paid token is required.

## Publish on GitHub Pages

1. Keep the files and folders in this repository structure, including `fonts/`, `scripts/` and `.github/workflows/`.
2. In GitHub, open **Settings → Pages** and make sure Pages is configured to deploy from the branch containing these files (usually the root of `main`).
3. Open **Settings → Actions → General → Workflow permissions** and select **Read and write permissions** so the updater can commit `posts.json`.
4. Open **Actions → Update feed → Run workflow** to test the collector. Scheduled runs follow every 30 minutes.

If the workflow cannot push its updated feed, check the repository's workflow permissions and the Actions run log.

## Customize the sources/searches

Edit the `FEEDS` and `RAFFLE_FEEDS` arrays near the top of `scripts/update.mjs` to adjust headline and giveaway searches. Each entry uses a Google News RSS search query. The site uses no paid key or paid external API.

## Design and attribution

- The bundled `fonts/PKMN-RBYGSC.ttf` font is used throughout the interface.
- The Poké Ball mark is drawn as crisp pixel art directly in `index.html`.
- The layout is responsive for mobile, tablet and desktop.
- Pokémon and related product names are trademarks of their respective owners. PokeDrop is a fan-made project and is not affiliated with Nintendo, Game Freak or The Pokémon Company.
- Review the font's license before using it commercially. Update the affiliate disclosure in `index.html` to match the links and monetization actually used by the site.
