const $ = (selector) => document.querySelector(selector);
const state = { products: [], activity: [], settings: {}, busy: false, timer: null };

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
    cache: 'no-store'
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function setMessage(element, text, isError = false) {
  element.textContent = text;
  element.classList.toggle('error', isError);
}

function formatDate(value, includeDate = false) {
  if (!value) return 'Not run yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString([], includeDate ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } : { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function statusLabel(product) {
  if (product.checkState === 'checking') return 'CHECKING';
  if (product.checkState === 'blocked') return 'BLOCKED';
  if (product.checkState === 'error') return 'ERROR';
  if (product.checkState === 'unrecognized' || product.lastStatus === 'unknown') return 'UNKNOWN';
  return ({ 'in-stock': 'IN STOCK', 'out-of-stock': 'OUT OF STOCK', 'preorder': 'PREORDER' })[product.lastStatus] || 'UNKNOWN';
}

function statusClass(product) {
  if (['checking', 'blocked', 'error', 'unrecognized'].includes(product.checkState)) return product.checkState;
  return product.lastStatus || 'unknown';
}

function safeExternalUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : '#'; }
  catch { return '#'; }
}

function renderProducts() {
  const list = $('#product-list');
  $('#tracked-count').textContent = state.products.length;
  $('#available-count').textContent = state.products.filter(p => ['in-stock', 'preorder'].includes(p.lastStatus)).length;
  $('#product-limit').textContent = `Up to ${state.maxProducts || 30} links`;
  if (!state.products.length) {
    list.innerHTML = '<div class="empty-state">No products yet. Add a direct retailer product page above to start monitoring.</div>';
    return;
  }
  list.innerHTML = state.products.map(product => {
    const name = escapeText(product.name || product.retailer || 'Tracked product');
    const retailer = escapeText(product.retailer || new URL(product.url).hostname.replace(/^www\./, ''));
    const url = safeExternalUrl(product.url);
    const price = product.lastPrice ? ` · ${escapeText(`${product.currency || ''} ${product.lastPrice}`.trim())}` : '';
    const checkText = product.lastCheckedAt ? `Last checked ${formatDate(product.lastCheckedAt, true)}` : 'Waiting for first check';
    const error = product.lastError ? `<div class="product-meta">${escapeText(product.lastError)}</div>` : '';
    return `<article class="product-card" data-id="${escapeText(product.id)}">
      <div class="product-main"><h3 class="product-title">${name}</h3><div class="product-retailer">${retailer}${price}</div><a class="product-url" href="${escapeText(url)}" target="_blank" rel="noopener noreferrer">OPEN RETAILER PRODUCT PAGE ↗</a><div class="product-meta">${escapeText(checkText)}${product.statusSource ? ` · ${escapeText(product.statusSource)}` : ''}</div>${error}</div>
      <div class="product-actions"><span class="status-pill ${statusClass(product)}">${statusLabel(product)}</span><div class="tiny-actions"><button type="button" data-action="check" data-id="${escapeText(product.id)}">CHECK</button><button type="button" data-action="remove" data-id="${escapeText(product.id)}">REMOVE</button></div></div>
    </article>`;
  }).join('');
}

function renderActivity() {
  const target = $('#activity-list');
  if (!state.activity.length) {
    target.innerHTML = '<p class="muted">Stock changes and check issues will appear here.</p>';
    return;
  }
  target.innerHTML = state.activity.slice(0, 12).map(item => `<div class="activity-item"><span class="activity-time">${escapeText(formatDate(item.at, true))}</span><span class="activity-detail"><strong>${escapeText(item.productName)}:</strong> ${escapeText(item.details)}</span></div>`).join('');
}

function renderSettings() {
  $('#interval').value = String(state.settings.checkIntervalMinutes || 3);
  const status = $('#discord-state');
  status.textContent = state.settings.discordConfigured ? 'CONNECTED' : 'NOT CONNECTED';
  status.classList.toggle('connected', Boolean(state.settings.discordConfigured));
  $('#test-discord').disabled = !state.settings.discordConfigured;
}

function renderRunStatus(data) {
  $('#last-scan').textContent = data.lastRunAt ? formatDate(data.lastRunAt) : 'Not run yet';
  $('#next-scan').textContent = data.runInProgress ? 'Scan is running' : `Next check ${formatDate(data.nextRunAt)}`;
  const banner = $('#scan-banner');
  if (data.runInProgress) {
    banner.className = 'scan-banner running';
    banner.innerHTML = '<span class="pulse"></span> Checking retailer product pages…';
  } else {
    banner.className = 'scan-banner';
    banner.innerHTML = `<span class="pulse"></span> ${data.lastRunAt ? `Last scan: ${escapeText(formatDate(data.lastRunAt, true))}. Next automatic scan: ${escapeText(formatDate(data.nextRunAt, true))}.` : 'Waiting for first scan…'}`;
  }
}

async function refresh() {
  try {
    const data = await api('/api/status');
    state.products = data.products || [];
    state.activity = data.activity || [];
    state.settings = data.settings || {};
    state.maxProducts = data.maxProducts;
    state.busy = data.runInProgress;
    renderProducts();
    renderActivity();
    renderSettings();
    renderRunStatus(data);
    $('#check-now').disabled = state.busy || state.products.length === 0;
  } catch (error) {
    $('#scan-banner').className = 'scan-banner error';
    $('#scan-banner').textContent = error.message;
  }
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

$('#add-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = $('#form-message');
  button.disabled = true;
  setMessage(message, 'Adding product…');
  try {
    await api('/api/products', { method: 'POST', body: JSON.stringify({
      name: $('#product-name').value.trim(),
      retailer: $('#retailer').value.trim(),
      url: $('#product-url').value.trim(),
      notifyOnFirstCheck: $('#notify-first').checked
    }) });
    event.currentTarget.reset();
    $('#notify-first').checked = true;
    setMessage(message, 'Product added. Its first check will start now.');
    await refresh();
  } catch (error) { setMessage(message, error.message, true); }
  finally { button.disabled = false; }
});

$('#product-list').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  button.disabled = true;
  try {
    if (button.dataset.action === 'remove') {
      if (!window.confirm('Remove this product from the local watchlist?')) return;
      await api(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } else {
      await api(`/api/products/${encodeURIComponent(id)}/check`, { method: 'POST' });
    }
    await refresh();
  } catch (error) { window.alert(error.message); }
  finally { button.disabled = false; }
});

$('#check-now').addEventListener('click', async () => {
  const button = $('#check-now');
  button.disabled = true;
  try { await api('/api/check-now', { method: 'POST' }); await refresh(); }
  catch (error) { window.alert(error.message); }
  finally { button.disabled = false; }
});

$('#save-settings').addEventListener('click', async () => {
  const message = $('#settings-message');
  const payload = { checkIntervalMinutes: Number($('#interval').value) };
  if ($('#webhook-url').value.trim()) payload.discordWebhookUrl = $('#webhook-url').value.trim();
  try {
    const response = await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    state.settings = response.settings;
    $('#webhook-url').value = '';
    setMessage(message, 'Settings saved on this PC.');
    await refresh();
  } catch (error) { setMessage(message, error.message, true); }
});

$('#clear-webhook').addEventListener('click', async () => {
  if (!window.confirm('Clear the saved Discord webhook from this PC?')) return;
  try {
    const response = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ clearWebhook: true }) });
    state.settings = response.settings;
    $('#webhook-url').value = '';
    setMessage($('#settings-message'), 'Saved Discord webhook cleared.');
    await refresh();
  } catch (error) { setMessage($('#settings-message'), error.message, true); }
});

$('#test-discord').addEventListener('click', async () => {
  const button = $('#test-discord');
  button.disabled = true;
  try { await api('/api/test-discord', { method: 'POST', body: '{}' }); setMessage($('#settings-message'), 'Test alert sent to Discord.'); }
  catch (error) { setMessage($('#settings-message'), error.message, true); }
  finally { button.disabled = !state.settings.discordConfigured; }
});

refresh();
state.timer = window.setInterval(refresh, 10_000);
