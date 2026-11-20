# PokeDrop

An 8-bit Pokémon TCG news feed. Free static site on GitHub Pages, filled automatically with real headlines.

## How it works

A GitHub Action (`.github/workflows/update.yml`) runs every 30 minutes. It runs `scripts/update.mjs`, which collects recent Pokémon TCG headlines from Google News RSS, sorts them into Restock, Release, Promo and Collab, and saves them to `posts.json`. The site reads that file. Each post shows the headline, the source and a link to the original article.

## Setup

1. Upload these files to the repo root, keeping the `scripts` and `.github` folders.
2. If you can't upload the `.github` folder, use Add file, then Create new file, type `.github/workflows/update.yml` as the name, and paste the contents.
3. Open the Actions tab and run Update feed once with Run workflow. It also runs by itself when the files are first committed.
4. If the commit step fails with a 403, go to Settings, Actions, General, Workflow permissions, and choose Read and write.

## Change what it collects

Edit the `FEEDS` list at the top of `scripts/update.mjs`. Each entry is a category and a Google News search query.

## Notes

- Font: PKMN RBYGSC from dafont.com. Check its license before using it commercially.
- The script converts `%`, `+` and `#` and strips other characters the font lacks.
- Edit the footer in `index.html` for your affiliate disclosure.
- Scheduled runs can lag by several minutes, and GitHub pauses them after 60 days with no repo activity.
