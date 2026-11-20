# PokeDrop

PokeDrop is a free, Pokémon-inspired 8-bit community feed for Pokémon TCG restocks, exclusive deals, rare drops, new releases and promos. It is designed to run as a static site on GitHub Pages with no paid API or hosted database.

## How the free feed works

- `.github/workflows/update.yml` runs every 30 minutes and can also be started manually from the GitHub Actions tab.
- `scripts/update.mjs` collects public headlines from Google News RSS searches, classifies them into the feed categories, removes duplicates and keeps the most recent 45 days of coverage.
- The workflow updates `posts.json` in the repository.
- `index.html`, `style.css` and `app.js` display the feed. Search, category filters and retailer filters run in the browser.

**Important:** the current free collector is a news and deal-coverage radar, not a live stock checker. It does not query retailer inventory or guarantee that an item is available. Links open the original publisher/source so trainers can confirm product details, price and availability before buying. A true live-stock feature would need supported retailer product feeds or inventory integrations.

## Publish on GitHub Pages

1. Keep the files and folders in this repository structure, including `fonts/`, `scripts/` and `.github/workflows/`.
2. In GitHub, open **Settings → Pages** and make sure Pages is configured to deploy from the branch containing these files (usually the root of `main`).
3. Open **Settings → Actions → General → Workflow permissions** and select **Read and write permissions** so the updater can commit `posts.json`.
4. Open **Actions → Update feed → Run workflow** to test the collector. Scheduled runs follow every 30 minutes.

If the workflow cannot push its updated feed, check the repository's workflow permissions and the Actions run log.

## Customize the sources/searches

Edit the `FEEDS` array near the top of `scripts/update.mjs`. Each entry contains a visible category and a Google News RSS search query. The site uses no paid key or paid external API.

## Design and attribution

- The bundled `fonts/PKMN-RBYGSC.ttf` font is used throughout the interface.
- The Poké Ball mark is drawn as crisp pixel art directly in `index.html`.
- The layout is responsive for mobile, tablet and desktop.
- Pokémon and related product names are trademarks of their respective owners. PokeDrop is a fan-made project and is not affiliated with Nintendo, Game Freak or The Pokémon Company.
- Review the font's license before using it commercially. Update the affiliate disclosure in `index.html` to match the links and monetization actually used by the site.
