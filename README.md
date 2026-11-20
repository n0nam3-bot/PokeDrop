# Pokémon TCG Alerts

An 8-bit Pokémon news and restock feed. Static site, free on GitHub Pages.

## Put it online

1. Create a new public repo on github.com.
2. Click Add file, then Upload files. Drag in everything from this folder, including the `fonts` folder, then commit.
3. Go to Settings, then Pages. Under Build and deployment, choose Deploy from a branch, pick `main` and `/ (root)`, then Save.
4. After about a minute the site is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

## Add a post

Open `posts.json` on GitHub, click the pencil icon, add an entry, and commit. The site updates in about a minute.

## Notes

- Font: PKMN RBYGSC from dafont.com. Check its license on the dafont page before using it commercially.
- The font has no `%`, `+`, `#` or arrow glyphs, so avoid them in post text.
- Edit the footer in `index.html` to set your own affiliate disclosure.
- To test locally, run `python3 -m http.server` in this folder and open http://localhost:8000.
