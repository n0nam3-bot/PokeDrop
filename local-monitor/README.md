# PokeDrop Local Monitor (Windows)

A free, personal product-page monitor that runs on your Windows PC. It complements the PokeDrop GitHub Pages news/raffle feed; it does not replace or change that website.

## What it does

- Tracks up to 30 direct product-page URLs that you add.
- Checks the pages every 2–30 minutes (3 minutes by default; 2 minutes is the fastest setting).
- Reads structured product availability data (Schema.org / JSON-LD and common availability metadata).
- Supports public Shopify product JSON as a fallback when the product page identifies itself as Shopify.
- Sends a Discord webhook alert when a first scan finds an available item (optional) or when a previously unavailable/unknown item becomes available.
- Stores your watchlist, current status, activity log, and Discord webhook locally in `local-monitor/data/`.
- Uses Node.js built-ins only. No AI, paid APIs, database service, proxy, or third-party package is required.

The monitor checks the exact product URLs you supply. It does **not** automatically discover every product across every retailer. Use PokeDrop's news feed to find products, then paste the retailer's direct product page into this local monitor.

## One-time setup

1. Install **Node.js 20 LTS or later** from [nodejs.org](https://nodejs.org/). No paid plan is needed.
2. Get the latest PokeDrop files onto your Windows PC (download the repository ZIP from GitHub, or pull your updated repository if you use Git).
3. Open the `local-monitor` folder and double-click **`start.bat`**.
4. Your browser opens `http://127.0.0.1:8787`. Keep the black terminal window open while monitoring. Closing it stops checks; the product list and settings remain saved.
5. Paste the **direct product page URL** for an item, add an optional name/retailer, and select **Track Product**.

The monitor runs only on `127.0.0.1` (this computer). It is not exposed as a public website or network server.

## Connect free Discord alerts

1. In Discord, open a server where you have permission to manage webhooks.
2. Open **Server Settings → Integrations → Webhooks → New Webhook**. Name it PokeDrop and choose the channel where alerts should appear.
3. Copy the webhook URL and paste it into **Configure Discord Notifications** in the local dashboard.
4. Choose a scan interval and select **Save Settings**.
5. Select **Send Test Alert**. Confirm the message arrives in your Discord channel.

Treat the webhook URL like a password. It is saved only to `local-monitor/data/settings.json` on your computer and is excluded from Git by the included `.gitignore`. Do not paste it into GitHub, a public issue, or a screenshot.

## Understanding stock statuses

- **IN STOCK** — the page exposed a supported structured signal such as `InStock`.
- **PREORDER** — the page exposed a preorder/backorder signal.
- **OUT OF STOCK** — the page exposed a supported `OutOfStock` / sold-out signal.
- **UNKNOWN** — the page loaded but did not expose a stock signal the monitor can safely interpret. It will not send a stock alert based on a guess.
- **BLOCKED** — the retailer returned HTTP 403 or 429. The monitor does not attempt to defeat its protection.
- **ERROR** — the request failed, timed out, or returned an unsupported response.

Retailer pages change often. A store may render inventory only in JavaScript or require a session, and some stores actively limit automated requests. A product showing UNKNOWN/BLOCKED is not evidence that it is sold out. Open the retailer page to confirm availability and checkout details.

## Operating notes

- Keep your PC awake and the monitor terminal open for scheduled checks.
- The default interval is 3 minutes. The minimum is 2 minutes; faster polling is intentionally not offered to avoid excessive requests.
- Add the retailer's actual product detail page, not a search page, homepage, cart, or category listing.
- The first check can alert if an item is already available; uncheck **Alert me if the first scan finds it available** to disable that first-check alert for that product.
- Alerts are sent on the first available result (when enabled) and on a later transition from OUT OF STOCK/UNKNOWN to IN STOCK/PREORDER. Repeated checks of an item that remains in stock do not spam Discord.
- The app does not automate purchasing, create accounts, solve CAPTCHAs, bypass queues, or circumvent retailer controls.

## Data and privacy

Runtime data is created automatically in `local-monitor/data/`:

- `products.json` — tracked product URLs and observed statuses.
- `settings.json` — scan interval and Discord webhook URL.
- `activity.json` — recent status changes and check errors.

These files are ignored by Git. Keep them on your PC and do not upload them with a repository ZIP. Removing the `data` folder resets the local watchlist and settings.

## Troubleshooting

- **`node` not found:** install Node.js 20+ and reopen the terminal, then run `start.bat` again.
- **Port 8787 is already in use:** close the other process using it, or start from Command Prompt with `set PORT=8788` followed by `node server.mjs`, then open `http://127.0.0.1:8788`.
- **No alert:** confirm Discord with **Send Test Alert**; check that the product status is IN STOCK/PREORDER and that the webhook is configured.
- **UNKNOWN/BLOCKED:** the retailer did not expose a reliable public stock signal to this simple monitor. It will not guess. You can still open the saved product link manually.
