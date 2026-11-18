// Small Shop Portal front-end. Plain JavaScript, hash-based routing.
'use strict';

const state = { user: null, settings: {}, branding: {}, cart: [], route: '' };

// ---------- utilities ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Sent with every request that changes data; the server refuses changes without it (stops
// other websites from submitting forms to the portal in a signed-in browser).
const PORTAL_HEADER = { 'X-Requested-With': 'shop-portal' };

// fetch(), but when the portal server can't be reached (stopped, or the network is down) the error
// says so in plain words instead of the browser's "Failed to fetch".
async function portalFetch(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw new Error("Can't reach the shop portal. Check that it is running on the shop computer, then try again.");
  }
}

async function api(method, url, body) {
  const res = await portalFetch(url, {
    method,
    headers: { ...PORTAL_HEADER, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.user) {
    state.user = null;
    renderAuth();
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function money(cents) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency || 'USD' }).format((cents || 0) / 100);
  } catch {
    return `${state.settings.currency || ''} ${((cents || 0) / 100).toFixed(2)}`;
  }
}

// The shop currency's symbol, e.g. "$" for USD (falls back to the code itself).
function currencySymbol() {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency || 'USD' }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value || state.settings.currency;
  } catch {
    return state.settings.currency || '';
  }
}

const toMajor = (cents) => ((cents || 0) / 100).toFixed(2);
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const isAdmin = () => state.user?.role === 'admin';
// Permissions come from the user's role (admins have all). The server enforces them; this only hides what can't be used.
const can = (...perms) => isAdmin() || perms.some((p) => (state.user?.permissions || []).includes(p));

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtDate(s) {
  if (!s) return '';
  return new Date(s.slice(0, 10) + 'T00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function datePresets() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return {
    today: [localDate(now), localDate(now)],
    week: [localDate(new Date(y, m, now.getDate() - 6)), localDate(now)],
    month: [localDate(new Date(y, m, 1)), localDate(now)],
    lastmonth: [localDate(new Date(y, m - 1, 1)), localDate(new Date(y, m, 0))],
    year: [localDate(new Date(y, 0, 1)), localDate(now)],
  };
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast-root').append(el);
  setTimeout(() => el.remove(), 3000);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

// Opens a modal. `onSubmit` receives form data; throw to show an error in the modal.
function modal({ title, body, submitLabel = 'Save', onSubmit, wide = false, footer }) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal ${wide ? 'wide' : ''}" novalidate>
        <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <div class="modal-body"><div class="error-msg hidden"></div>${body}</div>
        <div class="modal-foot">${
          footer ?? `<button type="button" class="btn" data-close>Cancel</button>${onSubmit ? `<button class="btn primary" type="submit">${esc(submitLabel)}</button>` : ''}`
        }</div>
      </form>
    </div>`;
  const form = $('form', root);
  const close = () => (root.innerHTML = '');
  $$('[data-close]', root).forEach((b) => (b.onclick = close));
  $('.modal-backdrop', root).addEventListener('mousedown', (e) => e.target === e.currentTarget && close());
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    const btn = $('button[type=submit]', form);
    btn && (btn.disabled = true);
    try {
      const keep = await onSubmit(formData(form), form);
      if (keep !== true) close();
    } catch (err) {
      const box = $('.error-msg', form);
      box.textContent = err.message;
      box.classList.remove('hidden');
    } finally {
      btn && (btn.disabled = false);
    }
  };
  setTimeout(() => $('input:not([type=hidden]), select', form)?.focus(), 30);
  return { form, close };
}

function confirmBox(title, message, label = 'Confirm', extra = '') {
  return new Promise((resolve) => {
    let done = false;
    const { form } = modal({
      title,
      body: `<p style="margin-top:0">${esc(message)}</p>${extra}`,
      submitLabel: label,
      onSubmit: (data) => {
        done = true;
        resolve(data);
      },
    });
    const observer = new MutationObserver(() => {
      if (!form.isConnected) {
        observer.disconnect();
        if (!done) resolve(null);
      }
    });
    observer.observe($('#modal-root'), { childList: true });
  });
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  sell: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.5L22 7H6"/>',
  sales: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-1 .7-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  suppliers: '<path d="M1 4h14v12H1z"/><path d="M15 9h4l3 3v4h-7z"/><circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="18.5" r="2"/>',
  products: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  inventory: '<path d="M3 21V8l9-5 9 5v13"/><path d="M7 21v-8h10v8M7 17h10"/>',
  accounting: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h2M14 18h2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  subscription: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>',
  users: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/><path d="m16.5 12.5 1.2 1.2 2.6-2.6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  bag: '<path d="M5 8h14l-1.3 11.2a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  chevrons: '<path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/>',
  shifts: '<rect x="3" y="10" width="18" height="10" rx="2"/><path d="M7 10V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4M7 15h2M11 15h2M15 15h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  money: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  owe: '<path d="M12 3v18M17 7.5C17 5.6 14.8 4 12 4S7 5.6 7 7.5 9.2 11 12 11.5s5 2 5 4-2.2 3.5-5 3.5-5-1.6-5-3.5"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function dateRangeControls(from, to) {
  return `
    <div class="toolbar">
      <select data-preset style="width:auto">
        <option value="">Custom range</option>
        <option value="today">Today</option>
        <option value="week">Last 7 days</option>
        <option value="month">This month</option>
        <option value="lastmonth">Last month</option>
        <option value="year">This year</option>
      </select>
      <input type="date" data-from value="${from}" style="width:auto">
      <span class="muted">to</span>
      <input type="date" data-to value="${to}" style="width:auto">
    </div>`;
}

// Wires up a dateRangeControls block; calls onChange(from, to).
function bindDateRange(root, onChange) {
  const fromEl = $('[data-from]', root);
  const toEl = $('[data-to]', root);
  const preset = $('[data-preset]', root);
  const presets = datePresets();
  for (const [k, [f, t]] of Object.entries(presets)) if (f === fromEl.value && t === toEl.value) preset.value = k;
  preset.onchange = () => {
    if (!preset.value) return;
    [fromEl.value, toEl.value] = presets[preset.value];
    onChange(fromEl.value, toEl.value);
  };
  fromEl.onchange = toEl.onchange = () => {
    preset.value = '';
    if (fromEl.value && toEl.value) onChange(fromEl.value, toEl.value);
  };
}

// Turns a text input into a product search: matches name, SKU or category,
// arrow keys + Enter or click to pick, exact SKU (barcode scan) is preselected.
// `tag(p)` can return a short note shown next to a result (e.g. "added").
function bindProductPicker(input, list, products, onPick, tag = () => '') {
  let matches = [];
  let active = 0;
  const hide = () => list.classList.add('hidden');
  const pick = (p) => {
    hide();
    onPick(p);
  };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) return hide();
    matches = products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)).slice(0, 8);
    active = Math.max(0, matches.findIndex((p) => p.sku.toLowerCase() === q));
    list.classList.remove('hidden');
    list.innerHTML = matches.length
      ? matches.map((p, i) => `<button type="button" class="picker-item ${i === active ? 'active' : ''}" data-id="${p.id}">
          <span><strong>${esc(p.name)}</strong> <span class="muted">${esc(p.sku)}${p.category ? ` · ${esc(p.category)}` : ''}</span></span>
          <span class="muted">${p.stock} ${esc(p.unit)}${tag(p) ? ` · ${esc(tag(p))}` : ''}</span></button>`).join('')
      : '<div class="empty" style="padding:12px">No matching products</div>';
    $$('.picker-item', list).forEach((b) => (b.onmousedown = (e) => {
      e.preventDefault();
      pick(products.find((p) => p.id === Number(b.dataset.id)));
    }));
  };
  input.oninput = draw;
  input.onblur = hide;
  input.onfocus = () => input.select();
  input.onkeydown = (e) => {
    const open = !list.classList.contains('hidden');
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && matches[active]) pick(matches[active]);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && open && matches.length) {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      $$('.picker-item', list).forEach((b, i) => b.classList.toggle('active', i === active));
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      hide();
    }
  };
}

// ---------- export any page to PDF / Excel ----------
// Reads what the page is showing (summary cards and tables, with the current filters and tab)
// and asks the server to turn it into a file.

const NUM_PARTS = (() => {
  const parts = new Intl.NumberFormat(undefined).formatToParts(1234.5);
  return { group: parts.find((p) => p.type === 'group')?.value || ',', decimal: parts.find((p) => p.type === 'decimal')?.value || '.' };
})();

// "$1,234.50" → { v: 1234.5, dp: true }; "36" → { v: 36 }; anything else → null.
function parseShownNumber(text) {
  let s = text.replace(/\s/g, '').replace(/[−–]/g, '-');
  const sym = currencySymbol();
  if (sym) s = s.split(sym).join('');
  s = s.split(NUM_PARTS.group).join('');
  if (NUM_PARTS.decimal !== '.') s = s.replace(NUM_PARTS.decimal, '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return { v: Number(s), dp: s.includes('.') };
}

function cellText(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll('button, input, select, svg').forEach((x) => x.remove());
  return c.textContent.replace(/\s+/g, ' ').trim();
}

const visible = (el) => !!el.offsetParent || el.getClientRects().length > 0;

function pageExportData() {
  const page = $('#page');
  const h1 = $('h1', page);
  const title = h1 ? cellText(h1) : PAGES[state.route]?.title || 'Report';
  const from = $('[data-from]', page)?.value;
  const to = $('[data-to]', page)?.value;
  const tab = $('.tabs button.active', page)?.textContent.trim();
  const subtitle = [tab, from && to ? `${fmtDate(from)} – ${fmtDate(to)}` : ''].filter(Boolean).join(' · ');
  const sections = [];

  const kpis = $$('.kpis .kpi', page).filter(visible);
  if (kpis.length) {
    sections.push({
      title: 'Summary',
      columns: [{ label: 'Item' }, { label: 'Value', align: 'right' }, { label: 'Detail' }],
      rows: kpis.map((k) => {
        const value = cellText($('.value', k));
        return [{ text: cellText($('.label', k)) }, { text: value, ...(parseShownNumber(value) || {}) }, { text: $('.sub', k) ? cellText($('.sub', k)) : '' }];
      }),
    });
  }

  for (const table of $$('table', page).filter(visible)) {
    if (table.closest('.rs-lines')) continue;
    const card = table.closest('.card');
    const heading = card && $('.card-head h2', card);
    const ths = $$('thead th', table);
    const bodyRows = $$('tbody tr', table).filter((tr) => !(tr.cells.length === 1 && tr.cells[0].classList.contains('empty')));
    if (!bodyRows.length) continue;
    const width = Math.max(ths.length, ...bodyRows.map((tr) => [...tr.cells].reduce((a, c) => a + (c.colSpan || 1), 0)));
    // Drop action columns (no header, e.g. "Edit ›", delete buttons).
    const keep = [];
    for (let i = 0; i < width; i++) if (!ths.length || cellText(ths[i] || document.createElement('th'))) keep.push(i);
    const right = new Array(width).fill(false);
    const columns = keep.map((i) => {
      right[i] = ths[i]?.classList.contains('num');
      return { label: ths.length ? cellText(ths[i]) : i === 0 ? 'Item' : '', align: right[i] ? 'right' : 'left' };
    });
    const bold = [];
    const rows = bodyRows.map((tr, ri) => {
      const cells = [];
      for (const td of tr.cells) {
        cells.push(td);
        for (let k = 1; k < (td.colSpan || 1); k++) cells.push(null);
      }
      if (tr.classList.contains('subtotal') || tr.classList.contains('total')) bold.push(ri);
      return keep.map((i) => {
        const td = cells[i];
        if (!td) return { text: '' };
        const text = cellText(td);
        const isNum = td.classList.contains('num') || right[i];
        if (!ths.length && i > 0) columns[keep.indexOf(i)].align = isNum ? 'right' : columns[keep.indexOf(i)].align;
        return { text, ...((isNum && parseShownNumber(text)) || {}) };
      });
    });
    sections.push({ title: heading ? cellText(heading) : tab || '', columns, rows, bold });
  }
  return { title, subtitle, sections };
}

async function exportPage(kind) {
  const data = pageExportData();
  if (!data.sections.length) return toast('Nothing on this page to export', 'error');
  const res = await portalFetch(`/api/export/${kind}`, { method: 'POST', headers: { ...PORTAL_HEADER, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) return toast((await res.json().catch(() => ({}))).error || 'Export failed', 'error');
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || `export.${kind}`;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(`Downloaded ${name}`);
}

// Pages re-render their header often (filters, tabs), so the menu is re-added whenever it goes missing.
// Data-entry pages (Pos Sales, New sale) mark their header data-no-export.
function ensureExportMenu() {
  const head = $('#page .page-head');
  if (!head || head.hasAttribute('data-no-export') || $('.export-menu', head)) return;
  const menu = document.createElement('details');
  menu.className = 'export-menu';
  menu.innerHTML = `<summary class="btn">Export ▾</summary>
    <div class="export-list"><button type="button" data-exp="pdf">PDF</button><button type="button" data-exp="xlsx">Excel</button></div>`;
  $$('[data-exp]', menu).forEach((b) => (b.onclick = async () => {
    menu.open = false;
    b.disabled = true;
    try {
      await exportPage(b.dataset.exp);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      b.disabled = false;
    }
  }));
  // Open towards whichever side has room.
  menu.addEventListener('toggle', () => {
    if (!menu.open) return;
    menu.classList.remove('flip');
    if ($('.export-list', menu).getBoundingClientRect().right > window.innerWidth - 8) menu.classList.add('flip');
  });
  const toolbar = $(':scope > .toolbar', head);
  if (toolbar) toolbar.prepend(menu);
  else head.append(menu);
}

document.addEventListener('click', (e) => {
  for (const m of $$('.export-menu[open]')) if (!m.contains(e.target)) m.open = false;
});

// ---------- logo & icon ----------

// Address of the shop's uploaded logo / icon (Settings → Logo & icon), or null. "v" makes the
// browser fetch the new picture after a change.
const brandUrl = (kind) => (state.branding?.[kind] ? `/api/branding/${kind}?v=${encodeURIComponent(state.branding[kind])}` : null);

// The shop's logo, or the default bag mark.
function brandMark(alt = '') {
  const url = brandUrl('logo');
  return url ? `<img class="brand-img" src="${url}" alt="${esc(alt)}">` : `<div class="brand-logo">${icon('bag')}</div>`;
}

// Logo line at the top of receipts and printed statements (nothing if no logo).
const printLogo = () => (brandUrl('logo') ? `<div class="c print-logo"><img src="${brandUrl('logo')}" alt=""></div>` : '');

// Browser tab icon: the uploaded icon, else the logo, else the built-in one.
function applyFavicon() {
  const link = $('link[rel="icon"]');
  if (!link.dataset.builtin) link.dataset.builtin = link.href;
  link.href = brandUrl('icon') || brandUrl('logo') || link.dataset.builtin;
}

async function loadBranding() {
  try {
    state.branding = await api('GET', '/api/branding');
  } catch {
    state.branding = {};
  }
  applyFavicon();
  applyColours();
}

// ---------- theme ----------

// Saved per browser; "system" follows the computer's light/dark setting.
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
const THEMES = { system: ['monitor', 'System'], light: ['sun', 'Light'], dark: ['moon', 'Dark'] };
const currentTheme = () => (THEMES[store.get('theme')] ? store.get('theme') : 'system');
function applyTheme(theme = currentTheme()) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}
applyTheme();

// ---------- shop colours (Settings → Appearance) ----------
// The owner picks an accent colour and a menu colour. From them the page works out every shade it
// needs, for light and dark mode, keeping text readable (WCAG contrast) whatever was picked.

const DEFAULT_PRIMARY = '#0f766e';
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
const mixHex = (a, b, t) => rgbHex(hexRgb(a).map((v, i) => v + (hexRgb(b)[i] - v) * t)); // t = share of b
const rgba = (hex, alpha) => `rgba(${hexRgb(hex).join(', ')}, ${alpha})`;
function luminance(hex) {
  const [r, g, b] = hexRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
// Moves a colour towards black (darker) or white (lighter) until it reads well on `bg`.
function readableOn(hex, bg, ratio) {
  const towards = luminance(bg) > 0.4 ? '#000000' : '#ffffff';
  let c = hex;
  for (let t = 0.05; contrast(c, bg) < ratio && t <= 1; t += 0.05) c = mixHex(hex, towards, t);
  return c;
}
// Text on a coloured button: white or near-black, whichever reads better.
const onColour = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#111827') ? '#ffffff' : '#111827');

// CSS that overrides the built-in colour tokens; '' when the shop uses the built-in colours.
function colourCss({ primary = '', sidebar = '' } = {}) {
  if (!primary && !sidebar) return '';
  const base = primary || DEFAULT_PRIMARY;
  const accent = (surface, isDark) => {
    const p = readableOn(base, surface, 4.5);
    return {
      '--primary': p,
      '--primary-hover': isDark ? mixHex(p, '#ffffff', 0.12) : mixHex(p, '#000000', 0.15),
      '--primary-light': mixHex(p, '#ffffff', 0.25),
      '--primary-soft': isDark ? mixHex(surface, p, 0.2) : mixHex('#ffffff', p, 0.1),
      '--primary-ring': rgba(p, isDark ? 0.32 : 0.22),
      '--on-primary': onColour(p),
    };
  };
  const menu = (side) => {
    const light = luminance(side) > 0.4;
    const accentOnMenu = readableOn(base, side, 3);
    return {
      '--side-bg': side,
      '--side-text': light ? mixHex(side, '#0f172a', 0.8) : mixHex(side, '#ffffff', 0.8),
      '--side-muted': light ? mixHex(side, '#0f172a', 0.55) : mixHex(side, '#ffffff', 0.5),
      '--side-strong': light ? '#0f172a' : '#ffffff',
      '--side-hover': light ? 'rgba(15, 23, 42, .06)' : 'rgba(255, 255, 255, .07)',
      '--side-line': light ? 'rgba(15, 23, 42, .1)' : 'rgba(255, 255, 255, .09)',
      '--side-accent': accentOnMenu,
      '--side-active': rgba(accentOnMenu, light ? 0.14 : 0.18),
    };
  };
  const block = (vars) => Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ');
  const lightVars = { ...accent('#ffffff', false), ...menu(sidebar || '#0f1a19') };
  const darkVars = { ...accent('#151b1a', true), ...menu(sidebar || '#0a0f0e') };
  return `:root { ${block(lightVars)} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${block(darkVars)} } }
:root[data-theme="dark"] { ${block(darkVars)} }`;
}

// Applies the shop's colours (or a preview of them) to the whole page.
function applyColours(colors = state.branding?.colors) {
  let el = document.getElementById('shop-colours');
  if (!el) {
    el = document.createElement('style');
    el.id = 'shop-colours';
    document.head.append(el);
  }
  el.textContent = colourCss(colors || {});
}

// ---------- auth screens ----------

async function renderAuth() {
  const { needsSetup, setupAllowed } = await api('GET', '/api/setup');
  $('#modal-root').innerHTML = '';
  // The owner account can only be created on the shop computer itself.
  if (needsSetup && !setupAllowed) {
    $('#app').innerHTML = `
      <div class="auth"><div class="auth-main"><div class="auth-card">
        ${brandMark('Shop logo')}
        <h1>Shop not set up yet</h1>
        <p class="muted">For safety, the owner account can only be created on the computer running the portal.
          Open <strong>http://localhost:${esc(location.port || '80')}</strong> on that computer to finish setup.</p>
      </div></div></div>`;
    return;
  }
  $('#app').innerHTML = `
    <div class="auth"><div class="auth-main">
      <form class="auth-card" novalidate>
        ${brandMark('Shop logo')}
        <h1>${needsSetup ? 'Set up your shop' : 'Sign in'}</h1>
        ${needsSetup ? '<p class="muted">Create the owner (admin) account to get started.</p>' : ''}
        <div class="error-msg hidden"></div>
        ${needsSetup ? `
          <div class="field"><label>Shop name</label><input name="shop_name" placeholder="e.g. Corner Market" required></div>
          <div class="field"><label>Your name</label><input name="name"></div>` : ''}
        <div class="field"><label>Username</label><input name="username" autocomplete="username" required></div>
        <div class="field"><label>Password${needsSetup ? ' (min. 8 characters)' : ''}</label><input name="password" type="password" autocomplete="${needsSetup ? 'new-password' : 'current-password'}" required></div>
        <button class="btn primary block lg" type="submit">${needsSetup ? 'Create account' : 'Sign in'}</button>
      </form>
    </div></div>`;
  const form = $('#app form');
  $('input', form).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', needsSetup ? '/api/setup' : '/api/login', formData(form));
      if (r.two_step) return renderTwoStep(r.ticket);
      boot();
    } catch (err) {
      const box = $('.error-msg', form);
      box.textContent = err.message;
      box.classList.remove('hidden');
    }
  };
}

// Second sign-in step: the 6-digit code from the authenticator app, or a recovery code.
function renderTwoStep(ticket) {
  let recovery = false;
  $('#app').innerHTML = `
    <div class="auth"><div class="auth-main">
      <form class="auth-card" novalidate>
        ${brandMark('Shop logo')}
        <h1>Two-step login</h1>
        <p class="muted" id="ts-help"></p>
        <div class="error-msg hidden"></div>
        <div class="field"><label id="ts-label"></label><input name="code" id="ts-code" autocomplete="one-time-code" required></div>
        <button class="btn primary block lg" type="submit">Verify</button>
        <div class="toolbar" style="justify-content:space-between;margin-top:14px;font-size:13px">
          <a href="#" id="ts-switch"></a><a href="#" id="ts-back">Back to sign in</a>
        </div>
      </form>
    </div></div>`;
  const form = $('#app form');
  const input = $('#ts-code');
  const draw = () => {
    $('#ts-help').textContent = recovery
      ? 'Enter one of the recovery codes you saved when you set up two-step login. Each code works once.'
      : 'Open your authenticator app and enter the 6-digit code shown for this shop.';
    $('#ts-label').textContent = recovery ? 'Recovery code' : '6-digit code';
    $('#ts-switch').textContent = recovery ? 'Use the code from the app' : 'Lost your phone? Use a recovery code';
    input.inputMode = recovery ? 'text' : 'numeric';
    input.maxLength = recovery ? 12 : 6;
    input.placeholder = recovery ? 'xxxx-xxxx' : '123456';
    input.value = '';
    input.focus();
  };
  $('#ts-switch').onclick = (e) => {
    e.preventDefault();
    recovery = !recovery;
    draw();
  };
  $('#ts-back').onclick = (e) => {
    e.preventDefault();
    renderAuth();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const box = $('.error-msg', form);
    try {
      const r = await api('POST', '/api/login/verify', { ticket, code: input.value.trim() });
      await boot();
      if (r.recovery_codes_left !== undefined) {
        toast(`Recovery code used. ${r.recovery_codes_left} left. Create new ones in Settings if you're running low.`, r.recovery_codes_left < 3 ? 'error' : '');
      }
    } catch (err) {
      box.textContent = err.message;
      box.classList.remove('hidden');
      if (/again\.$/.test(err.message) && /sign in|password/i.test(err.message)) setTimeout(renderAuth, 2500);
      input.select();
    }
  };
  draw();
}

// ---------- shell & routing ----------

const PAGES = {
  dashboard: { title: 'Dashboard', render: pageDashboard, group: '' },
  sell: { title: 'Pos Sales', render: pageSell, perms: ['sell'], group: 'Sales' },
  sales: { title: 'Sales', render: pageSales, perms: ['sales.view'], group: 'Sales' },
  shifts: { title: 'Cash closing', render: pageShifts, perms: ['sell', 'accounting', 'shifts.close'], group: 'Sales' },
  customers: { title: 'Customers', render: pageCustomers, perms: ['customers.manage'], group: 'Sales' },
  products: { title: 'Products', render: pageProducts, perms: ['products.view', 'products.manage'], group: 'Stock' },
  inventory: { title: 'Inventory', render: pageInventory, perms: ['inventory.view', 'inventory.manage'], group: 'Stock' },
  suppliers: { title: 'Suppliers', render: pageSuppliers, perms: ['suppliers.manage'], group: 'Stock' },
  accounting: { title: 'Accounting', render: pageAccounting, perms: ['accounting'], group: 'Finance' },
  activity: { title: 'Activity log', render: pageActivity, perms: ['activity.view'], group: 'Admin' },
  users: { title: 'Users & roles', render: pageUsers, adminOnly: true, group: 'Admin' },
  subscription: { title: 'Subscription', render: pageSubscription, adminOnly: true, billingOnly: true, group: 'Admin' },
  settings: { title: 'Settings', render: pageSettings, group: 'Admin' },
};

const initials = (name) => String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

function renderShell() {
  const allowed = Object.entries(PAGES).filter(([, p]) => (p.adminOnly ? isAdmin() : !p.perms || can(...p.perms)) && (!p.billingOnly || state.billing?.enabled));
  const groups = [...new Set(allowed.map(([, p]) => p.group))];
  const nav = groups
    .map((g) => `<div class="nav-group">${g ? `<div class="nav-label">${g}</div>` : ''}${allowed
      .filter(([, p]) => p.group === g)
      .map(([k, p]) => `<a href="#/${k}" data-route="${k}" title="${p.title}">${icon(k)}<span>${p.title}</span></a>`)
      .join('')}</div>`)
    .join('');
  const who = state.user.name || state.user.username;
  const roleName = state.user.is_owner ? 'Owner' : state.user.role_name || state.user.role;
  $('#app').innerHTML = `
    <div class="shell ${store.get('nav') === 'collapsed' ? 'collapsed' : ''}">
      <div class="nav-backdrop"></div>
      <aside class="sidebar">
        <div class="brand">${brandMark()}<span>${esc(state.settings.shop_name)}</span>
          <button type="button" class="nav-collapse" id="nav-collapse" title="Collapse / expand the menu" aria-label="Collapse menu">${icon('chevrons', 18)}</button></div>
        <nav class="nav">${nav}</nav>
      </aside>
      <div class="content">
        <header class="topbar">
          <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menu">${icon('menu', 22)}</button>
          <div class="crumbs"><span class="crumb-shop">${esc(state.settings.shop_name)}</span><span class="crumb-sep">/</span><span id="crumb-page"></span></div>
          <div class="topbar-actions">
            <button type="button" class="icon-btn" id="theme-btn" aria-label="Colour theme"></button>
            <details class="user-menu">
              <summary><span class="avatar">${esc(initials(who))}</span><span class="user-meta"><strong>${esc(who)}</strong><small>${esc(roleName)}</small></span>${icon('chevron', 16)}</summary>
              <div class="menu-list">
                <div class="menu-head"><strong>${esc(who)}</strong><small>${esc(state.user.username)} · ${esc(roleName)}</small></div>
                <a href="#/settings">${icon('settings', 16)} Settings</a>
                <button type="button" id="logout">${icon('logout', 16)} Sign out</button>
              </div>
            </details>
          </div>
        </header>
        <div id="billing-banner"></div>
        <main class="main" id="page"></main>
      </div>
    </div>`;
  $('#logout').onclick = async () => {
    await api('POST', '/api/logout');
    state.user = null;
    location.hash = '';
    renderAuth();
  };
  // Theme button cycles System → Light → Dark.
  const themeBtn = $('#theme-btn');
  const drawTheme = () => {
    const [ic, label] = THEMES[currentTheme()];
    themeBtn.innerHTML = icon(ic);
    themeBtn.title = `Theme: ${label} (click to change)`;
  };
  themeBtn.onclick = () => {
    const order = Object.keys(THEMES);
    store.set('theme', order[(order.indexOf(currentTheme()) + 1) % order.length]);
    applyTheme();
    drawTheme();
  };
  drawTheme();
  $('#nav-collapse').onclick = () => {
    const collapsed = $('.shell').classList.toggle('collapsed');
    store.set('nav', collapsed ? 'collapsed' : 'open');
  };
  new MutationObserver(ensureExportMenu).observe($('#page'), { childList: true });
  $('#menu-btn').onclick = () => $('.shell').classList.toggle('nav-open');
  $('.nav-backdrop').onclick = () => $('.shell').classList.remove('nav-open');
  $$('.nav a, .menu-list a').forEach((a) => (a.onclick = () => {
    $('.shell').classList.remove('nav-open');
    $('.user-menu').open = false;
  }));
}

document.addEventListener('click', (e) => {
  const m = $('.user-menu[open]');
  if (m && !m.contains(e.target)) m.open = false;
});

// Subscription reminder (payment due) or read-only notice (overdue), from the Waxool admin portal.
function drawBilling() {
  const box = $('#billing-banner');
  if (!box) return;
  const b = state.billing || { state: 'ok' };
  box.className = b.state === 'ok' ? '' : `billing-banner ${b.state}`;
  box.innerHTML = b.state === 'ok' ? '' : `<strong>${b.state === 'locked' ? 'Read-only:' : 'Payment due:'}</strong> ${esc(b.message || '')}${isAdmin() ? ' <a href="#/subscription">View invoices</a>' : ''}`;
}

// ---------- subscription (what this shop owes its portal provider) ----------

async function pageSubscription(page) {
  const a = await api('GET', '/api/billing/account');
  const cur = a.plan.currency;
  const fee = (c) => {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format((c || 0) / 100);
    } catch {
      return `${cur} ${((c || 0) / 100).toFixed(2)}`;
    }
  };
  const status = { ok: ['ok', 'Paid up'], warn: ['warn', 'Payment due'], locked: ['danger', 'Read-only'] }[a.state] || ['', a.state];
  const invBadge = (i) => (i.status === 'paid' ? '<span class="badge ok">Paid</span>' : i.due_on < localDate() ? '<span class="badge danger">Overdue</span>' : '<span class="badge warn">Due</span>');
  page.innerHTML = `
    <div class="page-head"><div><h1>Subscription</h1><div class="muted" style="font-size:13px">Your portal plan with ${esc(a.business_name)}</div></div></div>
    <div class="grid kpis" style="margin-bottom:18px">
      <div class="card kpi"><div class="label">Status</div><div class="value" style="font-size:20px"><span class="badge ${status[0]}" style="font-size:14px;text-transform:none">${status[1]}</span></div>
        <div class="sub">${a.state === 'warn' && a.lock_on ? `Pay before ${fmtDate(a.lock_on)}` : a.state === 'locked' ? 'Changes are paused until payment' : 'Nothing to do'}</div></div>
      <div class="card kpi"><div class="label">Balance due</div><div class="value ${a.balance_cents ? 'neg-num' : ''}">${fee(a.balance_cents)}</div></div>
      <div class="card kpi"><div class="label">Monthly fee</div><div class="value">${fee(a.plan.monthly_fee_cents)}</div><div class="sub">billed on day ${a.plan.billing_day} of each month</div></div>
    </div>
    ${a.payment_instructions ? `<div class="card" style="margin-bottom:18px"><div class="card-pad">
      <p style="margin:0"><strong>How to pay:</strong> ${esc(a.payment_instructions)}</p>
      <p class="muted" style="font-size:12.5px;margin:10px 0 0">After ${esc(a.business_name)} records your payment, the portal updates within about 15 minutes. If the portal becomes read-only, nothing is deleted: you can still view everything and download backups.</p>
    </div></div>` : ''}
    <div class="card table-wrap" style="margin-bottom:18px"><div class="card-head"><h2>Invoices</h2></div>
      ${a.invoices.length ? `<table><thead><tr><th>Invoice</th><th>Description</th><th>Issued</th><th>Due</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Balance</th><th>Status</th></tr></thead><tbody>
        ${a.invoices.map((i) => `<tr><td><strong>${esc(i.number)}</strong></td><td>${esc(i.description)}</td><td>${fmtDate(i.issued_on)}</td><td>${fmtDate(i.due_on)}</td>
          <td class="num">${fee(i.amount_cents)}</td><td class="num">${fee(i.paid_cents)}</td><td class="num">${fee(i.balance_cents)}</td><td>${invBadge(i)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No invoices yet</div>'}
    </div>
    <div class="card table-wrap"><div class="card-head"><h2>Payments received</h2></div>
      ${a.payments.length ? `<table><thead><tr><th>Date</th><th>Invoice</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>
        ${a.payments.map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td>${esc(p.invoice_number)}</td><td>${esc(p.method)}</td><td class="muted">${esc(p.reference) || '—'}</td><td class="num">${fee(p.amount_cents)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No payments yet</div>'}
    </div>`;
  state.billing = { ...(state.billing || {}), state: a.state, message: a.message };
  drawBilling();
}

async function router() {
  if (!state.user) return;
  applyColours();
  api('GET', '/api/billing').then((b) => ((state.billing = b), drawBilling())).catch(() => {});
  let [name, arg] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const pg = PAGES[name];
  if (!pg || (pg.adminOnly && !isAdmin()) || (pg.perms && !can(...pg.perms)) || (pg.billingOnly && !state.billing?.enabled)) name = 'dashboard';
  state.routeArg = arg;
  state.route = name;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  document.title = `${PAGES[name].title} · ${state.settings.shop_name}`;
  $('#crumb-page').textContent = PAGES[name].title;
  const page = $('#page');
  page.innerHTML = '<div class="loading"><span class="spinner"></span> Loading…</div>';
  try {
    await PAGES[name].render(page);
  } catch (err) {
    page.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
  }
}

async function boot() {
  await loadBranding();
  try {
    const me = await api('GET', '/api/me');
    state.user = me.user;
    state.settings = me.settings;
    state.billing = me.billing;
  } catch {
    return renderAuth();
  }
  renderShell();
  drawBilling();
  router();
}

window.addEventListener('hashchange', router);

// ---------- dashboard ----------

function barChart(daily) {
  const days = [];
  const map = Object.fromEntries(daily.map((d) => [d.day, d.total]));
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = localDate(d);
    days.push({ key, total: map[key] || 0, d });
  }
  const max = Math.max(...days.map((d) => d.total), 1);
  const W = 600, H = 200, pad = 22, bw = W / days.length;
  const bars = days
    .map((d, i) => {
      const h = ((H - pad - 8) * d.total) / max;
      const label = i % 5 === 4 || i === 0 ? `<text x="${i ? i * bw + bw / 2 : 0}" y="${H - 6}" text-anchor="${i ? 'middle' : 'start'}">${d.d.getDate()}/${d.d.getMonth() + 1}</text>` : '';
      return `<rect class="bar" x="${i * bw + 2}" y="${H - pad - h}" width="${bw - 4}" height="${Math.max(h, d.total ? 2 : 0)}" rx="2"><title>${fmtDate(d.key)}: ${money(d.total)}</title></rect>${label}`;
    })
    .join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}"/>${bars}</svg>`;
}

async function pageDashboard(page) {
  const d = await api('GET', '/api/reports/dashboard');
  const m = d.month;
  const kpi = (label, value, sub = '', ic = '', tone = '') =>
    `<div class="card kpi">${ic ? `<span class="kpi-icon ${tone}">${icon(ic, 18)}</span>` : ''}<div class="label">${label}</div><div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  page.innerHTML = `
    <div class="page-head"><h1>Dashboard</h1>${can('sell') ? `<a class="btn primary" href="#/sell">${icon('sell', 16)} Pos Sales</a>` : ''}</div>
    <div class="grid kpis">
      ${kpi("Today's sales", money(d.today.total - (d.today.refunds || 0)), `${d.today.count} transaction${d.today.count === 1 ? '' : 's'}${d.today.refunds ? ` · ${money(d.today.refunds)} refunded` : ''}`, 'sales', 'info')}
      ${m ? kpi('Sales this month', money(m.net_sales), `${m.sales_count} sales`, 'money', 'info') : ''}
      ${m ? kpi('Gross profit (month)', money(m.gross_profit), `${pct(m.gross_margin)} margin`, 'trend', 'ok') : ''}
      ${m ? kpi('Net profit (month)', `<span class="${m.net_profit < 0 ? 'neg-num' : ''}">${money(m.net_profit)}</span>`, `after ${money(m.total_expenses)} expenses`, 'accounting', m.net_profit < 0 ? 'danger' : 'ok') : ''}
      ${d.inventory_value != null ? kpi('Stock value', money(d.inventory_value), `${d.product_count} products`, 'inventory') : kpi('Products', d.product_count, '', 'products')}
      ${m ? kpi('Owed by customers', `<a href="#/customers" style="color:inherit;text-decoration:none">${money(m.receivables.total)}</a>`, `${m.receivables.customers} customer${m.receivables.customers === 1 ? '' : 's'} on credit`, 'customers', 'warn') : ''}
      ${m ? kpi('You owe suppliers', `<a href="#/suppliers" style="color:inherit;text-decoration:none">${money(m.payables.total)}</a>`, `to ${m.payables.suppliers} supplier${m.payables.suppliers === 1 ? '' : 's'}`, 'suppliers', 'warn') : ''}
      ${kpi('Low stock', `<span class="${d.low_stock.length ? 'neg-num' : ''}">${d.low_stock.length}</span>`, 'at or below reorder level', 'alert', d.low_stock.length ? 'danger' : '')}
      ${d.expiring ? kpi('Expiring soon', `<a href="#/inventory/expiry" style="color:inherit;text-decoration:none" class="${d.expiring.expired ? 'neg-num' : ''}">${d.expiring.batches}</a>`,
        d.expiring.expired ? `${d.expiring.expired} batch${d.expiring.expired === 1 ? '' : 'es'} already expired` : `expired or due within ${d.expiring.warning_days} days`, 'clock', d.expiring.expired ? 'danger' : d.expiring.batches ? 'warn' : '') : ''}
    </div>
    <div class="grid two-col" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h2>Sales, last 30 days</h2></div><div class="card-pad">${barChart(d.daily)}</div></div>
      <div class="card"><div class="card-head"><h2>Top products this month</h2></div>
        ${d.top_products.length ? `<table><tbody>${d.top_products.map((p) => `<tr><td>${esc(p.name)}<div class="muted" style="font-size:12px">${p.qty} sold</div></td><td class="num">${money(p.revenue)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No sales yet this month</div>'}
      </div>
    </div>
    <div class="grid two-col">
      <div class="card"><div class="card-head"><h2>Recent sales</h2>${can('sales.view') ? '<a href="#/sales">View all</a>' : ''}</div>
        <div class="table-wrap">${d.recent.length ? `<table><thead><tr><th>#</th><th>Time</th><th>Customer</th><th>Payment</th><th class="num">Total</th></tr></thead><tbody>
          ${d.recent.map((s) => `<tr class="clickable ${s.status === 'void' ? 'void' : ''}" data-sale="${s.id}"><td>${s.id}</td><td>${fmtDateTime(s.created_at)}</td><td>${esc(s.customer) || '<span class="muted">Walk-in</span>'}</td><td><span class="badge">${esc(s.payment_method)}</span></td><td class="num">${money(s.total_cents)}</td></tr>`).join('')}
        </tbody></table>` : `<div class="empty">No sales yet.${can('sell') ? ' <a href="#/sell">Make your first sale</a>' : ''}</div>`}</div>
      </div>
      <div class="card"><div class="card-head"><h2>Low stock</h2><a href="#/inventory">Inventory</a></div>
        ${d.low_stock.length ? `<table><tbody>${d.low_stock.map((p) => `<tr><td>${esc(p.name)}<div class="muted" style="font-size:12px">${esc(p.sku)}</div></td><td class="num"><span class="badge ${p.stock <= 0 ? 'danger' : 'warn'}">${p.stock} ${esc(p.unit)}</span></td></tr>`).join('')}</tbody></table>` : '<div class="empty">All products are well stocked</div>'}
      </div>
    </div>`;
  $$('[data-sale]', page).forEach((r) => (r.onclick = () => showSale(r.dataset.sale)));
}

// ---------- point of sale ----------

// ---------- shared by Pos Sales and New sale ----------

const SALE_PAYMENT_OPTIONS =
  '<option value="cash">Cash</option><option value="card">Card</option><option value="mobile">Mobile money</option><option value="credit">On credit (pay later)</option>';

// Paying or receiving money outside a sale (account payments, deliveries, expenses).
const PAYMENT_OPTIONS = '<option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="mobile">Mobile money</option><option value="card">Card</option>';

const customerOptions = (customers) =>
  '<option value="">Walk-in customer</option>' +
  customers.map((c) => `<option value="${c.id}">${esc(c.name)}${c.phone ? ` · ${esc(c.phone)}` : ''}</option>`).join('');

// Same rules the server applies: discount as money or %, tax on the discounted amount, and a cap on
// discounts for roles without "discount.unlimited".
function saleTotals(subtotal, discount) {
  const taxRate = Number(state.settings.tax_rate) || 0;
  const disc = discount.type === 'percent'
    ? Math.round((subtotal * Math.min(discount.value, 100)) / 100)
    : Math.min(Math.round(discount.value * 100), subtotal);
  const tax = Math.round(((subtotal - disc) * taxRate) / 100);
  const maxPct = Number(state.settings.max_staff_discount ?? 10);
  const overLimit = !can('discount.unlimited') && disc > 0 && disc * 100 > subtotal * maxPct;
  const html = `
    <div><span class="muted">Subtotal</span><span class="num">${money(subtotal)}</span></div>
    ${disc ? `<div><span class="muted">Discount${discount.type === 'percent' ? ` (${Math.min(discount.value, 100)}%)` : ''}</span><span class="num">−${money(disc)}</span></div>` : ''}
    ${taxRate ? `<div><span class="muted">Tax (${taxRate}%)</span><span class="num">${money(tax)}</span></div>` : ''}
    <div class="grand"><span>Total</span><span class="num">${money(subtotal - disc + tax)}</span></div>
    ${overLimit ? `<div class="neg-num" style="font-size:13px">Discount is over the ${maxPct}% staff limit.</div>` : ''}`;
  return { total: subtotal - disc + tax, overLimit, html };
}

const discountFieldHtml = () => `
  <div class="field" style="margin:0"><label>Discount${can('discount.unlimited') ? '' : ` (max ${esc(state.settings.max_staff_discount ?? '10')}%)`}</label>
    <div class="discount-field">
      <input name="discount" type="number" min="0" step="0.01" value="0" aria-label="Discount">
      <input type="hidden" name="discount_type" value="amount">
      <div class="seg" role="group" aria-label="Discount type">
        <button type="button" data-dt="amount" class="active" title="Money amount">${esc(currencySymbol())}</button>
        <button type="button" data-dt="percent" title="Percentage">%</button>
      </div>
    </div>
  </div>`;

// Wires the discount field in `form`; returns the live { value, type }.
function bindDiscountField(form, onChange) {
  const discount = { value: 0, type: 'amount' };
  const input = $('[name=discount]', form);
  input.oninput = () => {
    discount.value = Math.max(0, Number(input.value) || 0);
    if (discount.type === 'percent' && discount.value > 100) {
      discount.value = 100;
      input.value = 100;
    }
    onChange();
  };
  // Switching between money and % clears the value so 10 (money) never silently becomes 10%.
  $$('[data-dt]', form).forEach((b) => (b.onclick = () => {
    if (discount.type === b.dataset.dt) return;
    discount.type = b.dataset.dt;
    $('[name=discount_type]', form).value = discount.type;
    $$('[data-dt]', form).forEach((x) => x.classList.toggle('active', x === b));
    input.max = discount.type === 'percent' ? '100' : '';
    input.step = discount.type === 'percent' ? '0.5' : '0.01';
    input.value = 0;
    discount.value = 0;
    onChange();
    input.select();
  }));
  return discount;
}

// Under the customer picker: what they owe, and whether a sale of `total` fits their credit limit.
// Returns true when the server would refuse the sale (credit without a customer, or over the limit).
function drawCustomerCredit(info, customer, onCredit, total) {
  if (!customer) {
    info.classList.toggle('hidden', !onCredit);
    info.innerHTML = '<span class="neg-num">Choose a registered customer to sell on credit.</span>' +
      (can('customers.manage') ? ' <a href="#/customers/new">Register a customer</a>' : '');
    return onCredit;
  }
  let blocked = false;
  info.classList.remove('hidden');
  const owes = customer.balance_cents;
  let msg = owes > 0 ? `Owes <strong>${money(owes)}</strong>` : owes < 0 ? `Has <strong>${money(-owes)}</strong> in advance` : 'No balance owed';
  if (customer.credit_limit_cents > 0) {
    const avail = customer.credit_limit_cents - owes;
    msg += ` · limit ${money(customer.credit_limit_cents)} · available ${money(Math.max(avail, 0))}`;
    if (onCredit && total > avail) {
      msg += '<br><span class="neg-num">This sale is over the credit limit.</span>';
      blocked = true;
    }
  }
  info.innerHTML = `<span class="muted">${msg}</span>`;
  return blocked;
}

// Line value in cents: quantity × the line's price (or cost), which is kept in major units.
const lineCents = (l, field) => Math.round((l.qty || 0) * (l[field] || 0) * 100);

// Editable product lines in a table body (New sale, Receive stock). Each line is { p, qty, [field] }.
//   field: 'price' or 'cost'; editable: false shows the price as text; warnShort: stock turns red
//   when qty is more than in stock; enterToPrice: Enter in Qty moves to the price box (else back to
//   the search box, so a barcode scanner never submits the form); onChange: after any change.
// Returns { draw, add(p, qty) }.
function lineEditor({ body, search, lines, field, editable = true, warnShort = false, enterToPrice = false, expiry = false, emptyText, onChange }) {
  const short = (l) => warnShort && l.qty > l.p.stock;
  const draw = () => {
    body.innerHTML = lines.length
      ? lines.map((l, i) => `<tr data-i="${i}">
          <td><strong>${esc(l.p.name)}</strong><div class="muted" style="font-size:12px">${esc(l.p.sku)}</div></td>
          <td class="num ${short(l) ? 'neg-num' : ''}" data-stock>${l.p.stock} ${esc(l.p.unit)}</td>
          <td class="num"><input data-f="qty" type="number" min="1" step="1" value="${l.qty ?? ''}" style="text-align:right"></td>
          <td class="num">${editable
            ? `<input data-f="${field}" type="number" min="0" step="0.01" value="${l[field] ?? ''}" style="text-align:right">`
            : money(lineCents({ qty: 1, [field]: l[field] }, field))}</td>
          ${expiry ? `<td><input data-f="expiry" type="date" value="${l.expiry || ''}" min="${localDate()}" aria-label="Expiry date" title="Leave empty if it doesn't expire"></td>` : ''}
          <td class="num" data-total>${money(lineCents(l, field))}</td>
          <td class="num"><button type="button" class="icon-btn" data-rm aria-label="Remove line" title="Remove">${icon('x', 16)}</button></td></tr>`).join('')
      : `<tr><td colspan="${expiry ? 7 : 6}" class="empty">${emptyText}</td></tr>`;
    $$('tr[data-i]', body).forEach((row) => {
      const l = lines[Number(row.dataset.i)];
      $$('input', row).forEach((inp) => {
        inp.oninput = () => {
          l[inp.dataset.f] = inp.value === '' ? null : inp.type === 'date' ? inp.value : Number(inp.value);
          $('[data-total]', row).textContent = money(lineCents(l, field));
          $('[data-stock]', row).classList.toggle('neg-num', short(l));
          onChange();
        };
        inp.onkeydown = (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const price = $(`input[data-f=${field}]`, row);
          if (enterToPrice && inp.dataset.f === 'qty' && price) price.select();
          else search.focus();
        };
      });
      $('[data-rm]', row).onclick = () => {
        lines.splice(Number(row.dataset.i), 1);
        draw();
      };
    });
    onChange();
  };
  // Adds the product (or finds its line) and puts the cursor in its Qty box.
  const add = (p, qty) => {
    let i = lines.findIndex((l) => l.p.id === p.id);
    if (i < 0) {
      lines.push({ p, qty, [field]: Number(toMajor(field === 'cost' ? p.cost_cents : p.price_cents)) });
      i = lines.length - 1;
      draw();
    }
    search.value = '';
    const input = $(`tr[data-i="${i}"] [data-f=qty]`, body);
    input.focus();
    input.select();
  };
  return { draw, add };
}

async function pageSell(page) {
  const [products, customers, shift] = await Promise.all([api('GET', '/api/products'), api('GET', '/api/customers'), api('GET', '/api/shifts/current').catch(() => ({}))]);
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  let cartTotal = 0;

  page.innerHTML = `
    <div class="page-head" data-no-export><h1>Pos Sales</h1><span id="pos-shift"></span></div>
    ${shiftRequired() && !shift.shift ? openShiftBoxHtml() : ''}
    <div class="pos">
      <div class="card">
        <div class="card-head" style="gap:8px">
          <input id="pos-search" placeholder="Search by name or SKU (Enter adds the first match)" autocomplete="off">
          <select id="pos-cat" style="width:auto"><option value="">All categories</option>${categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        </div>
        <div class="product-grid" id="pos-grid"></div>
      </div>
      <form class="card cart" id="cart" novalidate>
        <div class="card-head"><h2>Cart</h2><button type="button" class="btn sm" id="cart-clear">Clear</button></div>
        <div class="cart-lines" id="cart-lines"></div>
        <div class="card-pad" style="border-top:1px solid var(--border)">
          <div class="row">
            <div class="field"><label>Customer</label><select name="customer_id">${customerOptions(customers)}</select></div>
            <div class="field"><label>Payment</label><select name="payment_method">${SALE_PAYMENT_OPTIONS}</select></div>
          </div>
          <div class="field hidden" id="cust-info" style="font-size:12.5px"></div>
          ${discountFieldHtml()}
        </div>
        <div class="totals" id="cart-totals"></div>
        <div class="card-pad" style="padding-top:0"><button class="btn primary block" type="submit" id="checkout" style="min-height:44px;font-size:15px">Complete sale</button></div>
      </form>
    </div>
    <button type="button" class="btn primary cart-jump hidden" id="cart-jump"></button>`;

  const grid = $('#pos-grid');
  const search = $('#pos-search');
  const cat = $('#pos-cat');
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  state.cart = state.cart.filter((l) => byId[l.id]);

  const filtered = () => {
    const q = search.value.trim().toLowerCase();
    return products.filter((p) => (!cat.value || p.category === cat.value) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)));
  };

  const drawGrid = () => {
    const list = filtered();
    grid.innerHTML = list.length
      ? list.map((p) => `<button type="button" class="tile" data-id="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>
          <span class="t-name">${esc(p.name)}</span><span class="t-stock">${p.stock <= 0 ? 'Out of stock' : `${p.stock} ${esc(p.unit)} in stock`}</span><span class="t-price">${money(p.price_cents)}</span></button>`).join('')
      : `<div class="empty" style="grid-column:1/-1">${products.length ? 'No matching products' : 'No products yet. <a href="#/products">Add products</a> first.'}</div>`;
    $$('.tile', grid).forEach((t) => (t.onclick = () => add(Number(t.dataset.id))));
  };

  const add = (id) => {
    const p = byId[id];
    const line = state.cart.find((l) => l.id === id);
    const qty = (line?.qty || 0) + 1;
    if (qty > p.stock) return toast(`Only ${p.stock} ${p.unit} of ${p.name} in stock`, 'error');
    line ? (line.qty = qty) : state.cart.push({ id, qty });
    drawCart();
  };

  const drawCart = () => {
    const lines = $('#cart-lines');
    lines.innerHTML = state.cart.length
      ? state.cart.map((l) => {
          const p = byId[l.id];
          return `<div class="cart-line" data-id="${l.id}">
            <div><div style="font-weight:550">${esc(p.name)}</div><div class="muted" style="font-size:12px">${money(p.price_cents)} each</div></div>
            <div class="qty"><button type="button" data-dec>−</button><input value="${l.qty}" inputmode="numeric" aria-label="Quantity"><button type="button" data-inc>+</button></div>
            <div class="num" style="min-width:70px">${money(p.price_cents * l.qty)}</div>
          </div>`;
        }).join('')
      : '<div class="empty">Tap a product to add it</div>';
    $$('.cart-line', lines).forEach((row) => {
      const id = Number(row.dataset.id);
      const line = state.cart.find((l) => l.id === id);
      const setQty = (q) => {
        if (q <= 0) state.cart = state.cart.filter((l) => l.id !== id);
        else if (q > byId[id].stock) toast(`Only ${byId[id].stock} in stock`, 'error');
        else line.qty = q;
        drawCart();
      };
      $('[data-dec]', row).onclick = () => setQty(line.qty - 1);
      $('[data-inc]', row).onclick = () => setQty(line.qty + 1);
      $('input', row).onchange = (e) => setQty(parseInt(e.target.value, 10) || 0);
    });
    const totals = saleTotals(state.cart.reduce((s, l) => s + byId[l.id].price_cents * l.qty, 0), discount);
    $('#cart-totals').innerHTML = totals.html;
    cartTotal = totals.total;
    const count = state.cart.reduce((a, l) => a + l.qty, 0);
    $('#cart-jump').classList.toggle('hidden', !count);
    $('#cart-jump').innerHTML = `<span>View cart · ${count} item${count === 1 ? '' : 's'}</span><span>${money(cartTotal)}</span>`;
    const creditBlocked = drawCustomer();
    $('#checkout').disabled = !state.cart.length || totals.overLimit || creditBlocked || (shiftRequired() && !shift.shift);
  };

  const custSel = $('#cart [name=customer_id]');
  const methodSel = $('#cart [name=payment_method]');
  const drawCustomer = () =>
    drawCustomerCredit($('#cust-info'), customers.find((x) => x.id === Number(custSel.value)), methodSel.value === 'credit', cartTotal);
  custSel.onchange = methodSel.onchange = () => drawCart();
  const discount = bindDiscountField($('#cart'), () => drawCart());
  if (state.routeArg && customers.some((c) => c.id === Number(state.routeArg))) {
    custSel.value = state.routeArg;
    methodSel.value = 'credit';
  }

  search.oninput = cat.onchange = drawGrid;
  search.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = search.value.trim().toLowerCase();
    const exact = products.find((p) => p.sku.toLowerCase() === q);
    const first = exact || filtered().find((p) => p.stock > 0);
    if (first) {
      add(first.id);
      search.value = '';
      drawGrid();
    }
  };
  $('#cart-jump').onclick = () => $('#cart').scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Hide the floating bar once the cart's totals are on screen.
  const cartObserver = new IntersectionObserver(([e]) => $('#cart-jump')?.style.setProperty('visibility', e.isIntersecting ? 'hidden' : 'visible'));
  cartObserver.observe($('#cart-totals'));
  $('#cart-clear').onclick = () => {
    state.cart = [];
    drawCart();
  };
  $('#cart').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#checkout');
    const data = formData(e.target);
    if (data.payment_method === 'credit' && !data.customer_id) return toast('Choose a registered customer for a credit sale', 'error');
    btn.disabled = true;
    try {
      const sale = await api('POST', '/api/sales', { ...data, items: state.cart.map((l) => ({ product_id: l.id, qty: l.qty })) });
      state.cart = [];
      state.routeArg = null;
      toast(`Sale #${sale.id} completed: ${money(sale.total_cents)}`);
      await pageSell(page);
      showSale(sale.id, true);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  };
  drawGrid();
  drawCart();
  bindOpenShiftBox(page, () => pageSell(page));
  $('#pos-shift').innerHTML = shift.shift
    ? `<a class="badge ok" style="text-transform:none" href="#/shifts" title="Close it from Cash closing">Shift open since ${fmtDateTime(shift.shift.opened_at)}</a>`
    : '<a class="btn sm" href="#/shifts">No shift open · Open shift</a>';
  search.focus();
}

function receiptHtml(s) {
  return `<div class="receipt">
    ${printLogo()}
    <div class="c"><strong>${esc(state.settings.shop_name)}</strong></div>
    <div class="c">Receipt #${s.id}</div>
    <div class="c">${esc(s.created_at)}</div>
    ${s.customer ? `<div class="c">Customer: ${esc(s.customer)}</div>` : ''}
    <hr>
    ${s.items.map((i) => `<div>${esc(i.name)}</div><div class="r"><span>${i.qty} × ${toMajor(i.price_cents)}</span><span>${toMajor(i.qty * i.price_cents)}</span></div>`).join('')}
    <hr>
    <div class="r"><span>Subtotal</span><span>${toMajor(s.subtotal_cents)}</span></div>
    ${s.discount_cents ? `<div class="r"><span>Discount${s.discount_percent != null ? ` (${s.discount_percent}%)` : ''}</span><span>-${toMajor(s.discount_cents)}</span></div>` : ''}
    ${s.tax_cents ? `<div class="r"><span>Tax</span><span>${toMajor(s.tax_cents)}</span></div>` : ''}
    <div class="r"><strong>TOTAL ${esc(state.settings.currency)}</strong><strong>${toMajor(s.total_cents)}</strong></div>
    <div class="r"><span>Paid by</span><span>${esc(s.payment_method)}</span></div>
    ${s.status === 'void' ? '<hr><div class="c"><strong>*** VOID ***</strong></div>' : ''}
    ${(s.returns || []).length ? `<hr>${s.returns.map((r) => `<div class="r"><span>Returned ${esc(r.ref)}</span><span>-${toMajor(r.total_cents)}</span></div>`).join('')}` : ''}
    <hr><div class="c">Thank you!</div>
  </div>`;
}

const REFUND_LABEL = { cash: 'Cash', card: 'Card', mobile: 'Mobile money', credit: "Customer's account" };

function returnReceiptHtml(s, r) {
  return `<div class="receipt">
    ${printLogo()}
    <div class="c"><strong>${esc(state.settings.shop_name)}</strong></div>
    <div class="c">RETURN / REFUND</div>
    <div class="c"><strong>${esc(r.ref)}</strong></div>
    <div class="c">${esc(r.created_at)}</div>
    <div class="c">For receipt #${s.id} of ${esc(s.created_at.slice(0, 10))}</div>
    ${s.customer ? `<div class="c">Customer: ${esc(s.customer)}</div>` : ''}
    <hr>
    ${r.items.map((i) => `<div>${esc(i.name)}${i.restocked ? '' : ' (damaged)'}</div><div class="r"><span>${i.qty} × ${toMajor(i.price_cents)}</span><span>${toMajor(i.qty * i.price_cents)}</span></div>`).join('')}
    <hr>
    <div class="r"><span>Items</span><span>${toMajor(r.subtotal_cents)}</span></div>
    ${r.discount_cents ? `<div class="r"><span>Less discount given</span><span>-${toMajor(r.discount_cents)}</span></div>` : ''}
    ${r.tax_cents ? `<div class="r"><span>Tax</span><span>${toMajor(r.tax_cents)}</span></div>` : ''}
    <div class="r"><strong>REFUND ${esc(state.settings.currency)}</strong><strong>${toMajor(r.total_cents)}</strong></div>
    <div class="r"><span>Refunded by</span><span>${esc(REFUND_LABEL[r.refund_method] || r.refund_method)}</span></div>
    ${r.reason ? `<div class="r"><span>Reason</span><span>${esc(r.reason)}</span></div>` : ''}
    <hr><div class="c">Signature: ______________</div>
  </div>`;
}

function printHtml(html) {
  $('#print-root').innerHTML = html;
  document.body.classList.add('printing-receipt');
  window.print();
  document.body.classList.remove('printing-receipt');
}

function showReturnReceipt(s, r) {
  modal({
    title: `Return ${r.ref}`,
    body: returnReceiptHtml(s, r),
    footer: '<button type="button" class="btn" data-print>Print</button><button type="button" class="btn primary" data-close>Done</button>',
  });
  $('#modal-root [data-print]').onclick = () => printHtml(returnReceiptHtml(s, r));
}

// Choose how many of each item come back. The refund is worked out by the server (preview),
// as the exact share of what the customer paid, including discount and tax.
function openReturn(s) {
  const lines = s.items.filter((i) => i.qty > i.returned_qty);
  const credit = s.payment_method === 'credit';
  const methodField = credit
    ? `<div class="field"><label>Refund</label><div class="muted" style="padding:8px 0">This was a credit sale: the refund comes off what ${esc(s.customer)} owes.</div></div>`
    : `<div class="field"><label>Refund by</label><select name="refund_method">
        ${['cash', 'card', 'mobile'].map((m) => `<option value="${m}" ${m === s.payment_method ? 'selected' : ''}>${REFUND_LABEL[m]}</option>`).join('')}
        ${s.customer_id ? `<option value="credit">Customer's account (store credit)</option>` : ''}
      </select></div>`;
  const { form } = modal({
    title: `Return items from sale #${s.id}`,
    wide: true,
    submitLabel: 'Return and refund',
    body: `
      <div class="table-wrap"><table class="rs-lines"><thead><tr><th>Item</th><th class="num">Sold</th><th class="num">Already returned</th><th class="num">Return now</th><th>Damaged?</th></tr></thead><tbody>
        ${lines.map((i) => `<tr data-item="${i.id}">
          <td><strong>${esc(i.name)}</strong><div class="muted" style="font-size:12px">${money(i.price_cents)} each</div></td>
          <td class="num">${i.qty}</td><td class="num">${i.returned_qty || '—'}</td>
          <td class="num"><input type="number" data-qty min="0" max="${i.qty - i.returned_qty}" step="1" value="0" style="text-align:right"></td>
          <td><label class="inline" style="margin:0;color:var(--text);font-weight:400"><input type="checkbox" data-damaged style="width:auto;min-height:0"> not resellable</label></td></tr>`).join('')}
      </tbody></table></div>
      <p class="muted" style="font-size:12.5px;margin:8px 0 14px">Returned items go back into stock, unless ticked as damaged (then they are written off as a loss).</p>
      <div class="row">${methodField}<div class="field"><label>Reason *</label><input name="reason" required maxlength="200" placeholder="e.g. wrong size, faulty"></div></div>
      <div class="totals" id="ret-preview" style="padding:4px 0 0"><div class="muted">Choose how many to return.</div></div>`,
    onSubmit: async (data) => {
      const body = { items: collect(), refund_method: data.refund_method, reason: data.reason };
      const res = await api('POST', `/api/sales/${s.id}/returns`, body);
      toast(`${res.ref}: ${money(res.total_cents)} refunded`);
      const fresh = await api('GET', `/api/sales/${s.id}`);
      setTimeout(() => showReturnReceipt(fresh, fresh.returns.find((r) => r.id === res.id)), 0);
      if (state.route !== 'sell') router();
    },
  });
  const collect = () =>
    $$('tr[data-item]', form)
      .map((tr) => ({ sale_item_id: Number(tr.dataset.item), qty: Number($('[data-qty]', tr).value) || 0, damaged: $('[data-damaged]', tr).checked }))
      .filter((x) => x.qty > 0);
  const box = $('#ret-preview', form);
  let timer;
  let latest = 0; // only the newest preview is shown, even if answers arrive out of order
  const preview = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const mine = ++latest;
      const items = collect();
      if (!items.length) return (box.innerHTML = '<div class="muted">Choose how many to return.</div>');
      try {
        const p = await api('POST', `/api/sales/${s.id}/returns`, { items, refund_method: $('[name=refund_method]', form)?.value, preview: true });
        if (mine !== latest) return;
        box.innerHTML = `
          <div><span class="muted">Items</span><span class="num">${money(p.subtotal_cents)}</span></div>
          ${p.discount_cents ? `<div><span class="muted">Less their share of the discount</span><span class="num">−${money(p.discount_cents)}</span></div>` : ''}
          ${p.tax_cents ? `<div><span class="muted">Tax</span><span class="num">${money(p.tax_cents)}</span></div>` : ''}
          <div class="grand"><span>Refund (${esc(REFUND_LABEL[p.refund_method])})</span><span class="num">${money(p.total_cents)}</span></div>`;
      } catch (err) {
        if (mine !== latest) return;
        box.innerHTML = `<div class="neg-num">${esc(err.message)}</div>`;
      }
    }, 200);
  };
  $$('input, select', form).forEach((el) => el.addEventListener('input', preview));
  $$('select, [data-damaged]', form).forEach((el) => el.addEventListener('change', preview));
  setTimeout(() => $('[data-qty]', form)?.focus(), 40);
}

async function showSale(id, justSold = false) {
  const s = await api('GET', `/api/sales/${id}`);
  const profit = s.subtotal_cents - s.discount_cents - s.cogs_cents;
  const returned = s.returns.reduce((a, r) => a + r.total_cents, 0);
  const anyReturned = s.items.some((i) => i.returned_qty > 0);
  const canReturn = can('sales.refund') && s.status === 'completed' && s.items.some((i) => i.qty > i.returned_qty);
  modal({
    title: justSold ? 'Sale completed' : `Sale #${s.id}`,
    wide: true,
    body: `
      <div class="toolbar" style="margin-bottom:12px">
        <span class="badge ${s.status === 'void' ? 'danger' : 'ok'}">${s.status}</span>
        ${returned ? `<span class="badge warn">${returned === s.total_cents ? 'fully returned' : 'part returned'}</span>` : ''}
        <span class="muted">${esc(s.created_at)} · by ${esc(s.username || '—')} · ${esc(s.payment_method)}</span>
        ${s.customer ? `<span class="muted">· ${s.customer_id && can('customers.manage') ? `<a href="#/customers/${s.customer_id}" data-close>${esc(s.customer)}</a>` : esc(s.customer)}</span>` : ''}
      </div>
      <table><thead><tr><th>Item</th><th class="num">Qty</th>${anyReturned ? '<th class="num">Returned</th>' : ''}<th class="num">Price</th><th class="num">Amount</th></tr></thead><tbody>
        ${s.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${i.qty}</td>${anyReturned ? `<td class="num">${i.returned_qty || ''}</td>` : ''}<td class="num">${money(i.price_cents)}</td><td class="num">${money(i.qty * i.price_cents)}</td></tr>`).join('')}
      </tbody></table>
      <div class="totals" style="padding:12px 14px 0">
        <div><span class="muted">Subtotal</span><span class="num">${money(s.subtotal_cents)}</span></div>
        ${s.discount_cents ? `<div><span class="muted">Discount${s.discount_percent != null ? ` (${s.discount_percent}%)` : ''}</span><span class="num">−${money(s.discount_cents)}</span></div>` : ''}
        ${s.tax_cents ? `<div><span class="muted">Tax</span><span class="num">${money(s.tax_cents)}</span></div>` : ''}
        <div class="grand"><span>Total</span><span class="num">${money(s.total_cents)}</span></div>
        ${returned ? `<div><span class="muted">Refunded for returns</span><span class="num neg-num">−${money(returned)}</span></div><div><span><strong>Kept by customer</strong></span><span class="num"><strong>${money(s.total_cents - returned)}</strong></span></div>` : ''}
        ${can('costs.view') ? `<div style="margin-top:6px"><span class="muted">Cost of goods / profit (as sold)</span><span class="num">${money(s.cogs_cents)} / ${money(profit)}</span></div>` : ''}
      </div>
      ${s.returns.length ? `<h3 style="margin:16px 0 6px">Returns</h3>
        <div class="table-wrap"><table><thead><tr><th>Return</th><th>Date</th><th>Items</th><th>Refunded by</th><th class="num">Refund</th></tr></thead><tbody>
        ${s.returns.map((r) => `<tr class="clickable" data-ret="${r.id}"><td><span class="badge warn">${esc(r.ref)}</span></td><td>${fmtDateTime(r.created_at)}</td>
          <td class="wrap">${esc(r.items.map((i) => `${i.qty} × ${i.name}${i.restocked ? '' : ' (damaged)'}`).join(', '))}</td>
          <td>${esc(REFUND_LABEL[r.refund_method] || r.refund_method)}</td><td class="num">${money(r.total_cents)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}`,
    footer: `
      ${can('sales.refund') && s.status !== 'void' && !s.returns.length ? '<button type="button" class="btn danger" data-void>Void sale</button>' : ''}
      ${canReturn ? '<button type="button" class="btn" data-return>Return items</button>' : ''}
      <span style="margin-right:auto"></span>
      <button type="button" class="btn" data-print>Print receipt</button>
      <button type="button" class="btn primary" data-close>${justSold ? 'Next sale' : 'Close'}</button>`,
  });
  $('[data-print]').onclick = () => printHtml(receiptHtml(s));
  $$('#modal-root [data-ret]').forEach((tr) => (tr.onclick = () => showReturnReceipt(s, s.returns.find((r) => r.id === Number(tr.dataset.ret)))));
  const retBtn = $('#modal-root [data-return]');
  if (retBtn) retBtn.onclick = () => openReturn(s);
  const voidBtn = $('[data-void]');
  if (voidBtn) {
    voidBtn.onclick = async () => {
      const r = await confirmBox(`Void sale #${s.id}?`, 'Cancels the whole sale: every item goes back to stock and the sale is removed from reports. To take back only some items, use Return items instead.', 'Void sale',
        '<div class="field"><label>Reason</label><input name="reason" placeholder="e.g. rung up by mistake"></div>');
      if (!r) return;
      try {
        await api('POST', `/api/sales/${s.id}/void`, r);
        toast(`Sale #${s.id} voided`);
        await router();
        showSale(s.id);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }
}

// ---------- sales history ----------

async function pageSales(page, from = datePresets().month[0], to = localDate()) {
  if (state.routeArg === 'new' && can('sell')) return pageNewSale(page);
  const sales = await api('GET', `/api/sales?from=${from}&to=${to}`);
  const done = sales.filter((s) => s.status === 'completed');
  const refunded = done.reduce((a, s) => a + (s.returned_cents || 0), 0);
  const total = done.reduce((a, s) => a + s.total_cents, 0) - refunded;
  page.innerHTML = `
    <div class="page-head"><h1>Sales</h1>
      <div class="toolbar">${dateRangeControls(from, to)}
        ${can('accounting') ? `<a class="btn" href="/api/export/sales.csv?from=${from}&to=${to}">Export CSV</a>` : ''}
        ${can('sell') ? '<a class="btn primary" href="#/sales/new">New sale</a>' : ''}</div>
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Total sales</div><div class="value">${money(total)}</div>${refunded ? `<div class="sub">after ${money(refunded)} refunded for returns</div>` : ''}</div>
      <div class="card kpi"><div class="label">Transactions</div><div class="value">${done.length}</div></div>
      <div class="card kpi"><div class="label">Average sale</div><div class="value">${money(done.length ? Math.round(total / done.length) : 0)}</div></div>
      <div class="card kpi"><div class="label">Voided</div><div class="value">${sales.length - done.length}</div></div>
    </div>
    <div class="card table-wrap">${sales.length ? `<table><thead><tr><th>#</th><th>Date</th><th>Customer</th><th>Items</th><th>Payment</th><th>Cashier</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
      ${sales.map((s) => `<tr class="clickable ${s.status === 'void' ? 'void' : ''}" data-sale="${s.id}">
        <td>${s.id}</td><td>${fmtDateTime(s.created_at)}</td><td>${esc(s.customer) || '<span class="muted">Walk-in</span>'}</td><td>${s.item_count}</td>
        <td><span class="badge">${esc(s.payment_method)}</span></td><td>${esc(s.username || '')}</td>
        <td class="keep"><span class="badge ${s.status === 'void' ? 'danger' : 'ok'}">${s.status}</span>${s.returned_cents ? ` <span class="badge warn">${s.returned_cents >= s.total_cents ? 'returned' : 'part returned'}</span>` : ''}</td>
        <td class="num">${money(s.total_cents)}${s.returned_cents ? `<div class="neg-num" style="font-size:12px">−${money(s.returned_cents)} refunded</div>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No sales in this period</div>'}</div>`;
  bindDateRange(page, (f, t) => pageSales(page, f, t));
  $$('[data-sale]', page).forEach((r) => (r.onclick = () => showSale(r.dataset.sale)));
}

// ---------- cash closing (shifts / Z-report) ----------

const shiftRequired = () => state.settings.require_shift !== '0';

// Shown where people sell when the shop requires a shift and theirs isn't open: open it right here.
function openShiftBoxHtml() {
  return `<div class="card open-shift-box">
      <div class="card-pad">
        <div class="osb-text"><strong>Open your shift to start selling.</strong>
          <span class="muted">Count the cash in the drawer and enter it. Your sales are added up until you close the shift in Cash closing.</span></div>
        <form class="toolbar osb-form" novalidate>
          <div class="field" style="margin:0;width:180px"><label>Cash in the drawer (float)</label><input name="float" type="number" min="0" step="0.01" value="0" required></div>
          <button class="btn primary" type="submit">Open shift</button>
        </form>
      </div>
    </div>`;
}
function bindOpenShiftBox(root, onOpened) {
  const form = $('.osb-form', root);
  if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/shifts/open', { float: formData(form).float });
      toast('Shift opened. You can sell now.');
      onOpened();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
}

const CASH_LINES = [
  ['opening_float', 'Opening float', 1],
  ['cash_sales', 'Cash sales', 1],
  ['cash_voids', 'Voided cash sales (paid back)', -1],
  ['cash_refunds', 'Cash refunds (returns)', -1],
  ['customer_payments_cash', 'Cash from credit customers', 1],
  ['supplier_payments_cash', 'Cash paid to suppliers', -1],
  ['deliveries_paid_cash', 'Deliveries paid in cash', -1],
  ['expenses_cash', 'Cash expenses', -1],
];
const differenceLabel = (d) => (d === 0 ? 'Exact' : d < 0 ? `Short ${money(-d)}` : `Over ${money(d)}`);
const differenceBadge = (d) => (d == null ? '<span class="muted">—</span>' : `<span class="badge ${d === 0 ? 'ok' : d < 0 ? 'danger' : 'warn'}">${differenceLabel(d)}</span>`);

// Receipt-style Z-report (also printed). Open shifts (seen by Accounting) show the figures so far.
function zReportHtml(sh) {
  const m = { ...sh.summary, opening_float: sh.opening_float_cents };
  const closed = sh.status === 'closed';
  const line = ([key, label, sign]) => (m[key] || key === 'opening_float' || key === 'cash_sales' ? `<div class="r"><span>${sign < 0 ? '− ' : key === 'opening_float' ? '' : '+ '}${label}</span><span>${toMajor(m[key] || 0)}</span></div>` : '');
  return `<div class="receipt">
    ${printLogo()}
    <div class="c"><strong>${esc(state.settings.shop_name)}</strong></div>
    <div class="c">${closed ? 'Z-REPORT' : 'SHIFT SO FAR'} · SHIFT #${sh.id}</div>
    <div class="c">${esc(sh.user_name || sh.username)}</div>
    <hr>
    <div class="r"><span>Opened</span><span>${esc(sh.opened_at)}</span></div>
    <div class="r"><span>Closed</span><span>${closed ? esc(sh.closed_at) : 'still open'}</span></div>
    ${closed && sh.closed_by_username && sh.closed_by_username !== sh.username ? `<div class="r"><span>Closed by</span><span>${esc(sh.closed_by_username)}</span></div>` : ''}
    <hr>
    ${m.expected_cash !== undefined ? `${CASH_LINES.map(line).join('')}
      <div class="r"><strong>Expected cash</strong><strong>${toMajor(m.expected_cash)}</strong></div>` : ''}
    ${closed ? `<div class="r"><strong>Counted cash</strong><strong>${toMajor(sh.counted_cents)}</strong></div>
      <div class="r"><strong>Difference</strong><strong>${sh.difference_cents === 0 ? '0.00' : (sh.difference_cents > 0 ? '+' : '−') + toMajor(Math.abs(sh.difference_cents))}</strong></div>
      <div class="c" style="margin-top:4px">${differenceLabel(sh.difference_cents).toUpperCase()}</div>` : ''}
    <hr>
    <div class="c">SALES</div>
    ${(m.sales_by_method || []).map((x) => `<div class="r"><span>${esc(METHOD_LABEL[x.method] || x.method)} (${x.count})</span><span>${toMajor(x.amount)}</span></div>`).join('') || '<div class="c">No sales</div>'}
    <div class="r"><strong>Total (${m.sales_count || 0} sales)</strong><strong>${toMajor(m.sales_total || 0)}</strong></div>
    ${sh.note ? `<hr><div>Note: ${esc(sh.note)}</div>` : ''}
    ${closed ? '<hr><div class="c">Signature: ______________</div>' : ''}
  </div>`;
}

async function showShift(id) {
  const sh = await api('GET', `/api/shifts/${id}`);
  modal({
    title: sh.status === 'closed' ? `Z-report · shift #${sh.id}` : `Shift #${sh.id} (open)`,
    body: zReportHtml(sh),
    footer: '<button type="button" class="btn" data-print>Print</button><button type="button" class="btn primary" data-close>Done</button>',
  });
  $('#modal-root [data-print]').onclick = () => printHtml(zReportHtml(sh));
}

async function pageShifts(page, from = datePresets().week[0], to = localDate()) {
  const [cur, shifts] = await Promise.all([can('sell') ? api('GET', '/api/shifts/current') : { shift: null }, api('GET', `/api/shifts?from=${from}&to=${to}`)]);
  const sh = cur.shift;
  const all = can('accounting', 'shifts.close');
  const reload = () => pageShifts(page, from, to);
  page.innerHTML = `
    <div class="page-head"><h1>Cash closing</h1><div class="toolbar">${dateRangeControls(from, to)}</div></div>
    ${can('sell') ? `<div class="card" style="margin-bottom:18px">
      <div class="card-head"><h2>Your shift</h2>${sh ? '<span class="badge ok">Open</span>' : '<span class="badge">Closed</span>'}</div>
      <div class="card-pad">${sh ? `
        <div class="grid kpis" style="margin-bottom:14px">
          <div class="card kpi"><div class="label">Open since</div><div class="value" style="font-size:18px">${fmtDateTime(sh.opened_at)}</div><div class="sub">float ${money(sh.opening_float_cents)}</div></div>
          <div class="card kpi"><div class="label">Sales this shift</div><div class="value">${money(sh.summary.sales_total)}</div><div class="sub">${sh.summary.sales_count} sale${sh.summary.sales_count === 1 ? '' : 's'}</div></div>
          ${(sh.summary.sales_by_method || []).map((x) => `<div class="card kpi"><div class="label">${esc(METHOD_LABEL[x.method] || x.method)}</div><div class="value">${money(x.amount)}</div><div class="sub">${x.count} sale${x.count === 1 ? '' : 's'}</div></div>`).join('')}
        </div>
        <div class="toolbar"><button class="btn primary" id="sh-close">Close shift &amp; count cash</button>
          <span class="muted" style="font-size:12.5px">At the end of the shift, count all the cash in the drawer (including the float).</span></div>` : `
        <form id="sh-open" class="toolbar" style="align-items:end" novalidate>
          <div class="field" style="margin:0;max-width:220px"><label>Cash in the drawer now (float)</label><input name="float" type="number" min="0" step="0.01" value="0" required></div>
          <button class="btn primary" type="submit">Open shift</button>
        </form>
        <p class="muted" style="font-size:12.5px;margin:10px 0 0">Open a shift when you start at the till. Your cash sales, refunds and cash payments are added up until you close it.</p>`}
      </div>
    </div>` : ''}
    <div class="card table-wrap">
      <div class="card-head"><h2>${all ? 'All shifts' : 'Your shifts'}</h2></div>
      ${shifts.length ? `<table><thead><tr>${all ? '<th>Cashier</th>' : ''}<th>Opened</th><th>Closed</th><th class="num">Float</th><th class="num">Sales</th><th class="num">Expected</th><th class="num">Counted</th><th>Difference</th></tr></thead><tbody>
        ${shifts.map((x) => `<tr class="clickable" data-shift="${x.id}">${all ? `<td><strong>${esc(x.user_name || x.username)}</strong></td>` : ''}
          <td>${fmtDateTime(x.opened_at)}</td><td>${x.closed_at ? fmtDateTime(x.closed_at) : '<span class="badge ok">open</span>'}</td>
          <td class="num">${money(x.opening_float_cents)}</td>
          <td class="num">${money(x.sales_total)}<div class="muted" style="font-size:12px">${x.sales_count} sale${x.sales_count === 1 ? '' : 's'}</div></td>
          <td class="num">${x.expected_cents != null ? money(x.expected_cents) : x.expected_so_far != null ? `${money(x.expected_so_far)}<div class="muted" style="font-size:12px">so far</div>` : '<span class="muted">—</span>'}</td>
          <td class="num">${x.counted_cents == null ? '<span class="muted">—</span>' : money(x.counted_cents)}</td>
          <td class="keep">${x.status === 'closed' ? differenceBadge(x.difference_cents) : can('shifts.close') ? `<button class="btn sm" data-close-shift="${x.id}">Close</button>` : '<span class="muted">—</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No shifts in this period</div>'}
    </div>`;

  bindDateRange(page, (f, t) => pageShifts(page, f, t));
  $$('[data-shift]', page).forEach((r) => (r.onclick = () => showShift(r.dataset.shift)));
  $$('[data-close-shift]', page).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const x = shifts.find((s) => s.id === Number(b.dataset.closeShift));
    const mine = x.user_id === state.user.id;
    modal({
      title: mine ? 'Close your shift' : `Close ${x.user_name || x.username}'s shift`,
      submitLabel: 'Close shift',
      body: `<p style="margin-top:0">Count <strong>all</strong> the cash in ${mine ? 'your' : 'their'} drawer, including the float of ${money(x.opening_float_cents)}, and enter the total.
          ${mine ? '' : 'The Z-report will show that you closed it.'}</p>
        <div class="field"><label>Counted cash</label><input name="counted" type="number" min="0" step="0.01" required></div>
        <div class="field"><label>Note (optional)</label><input name="note" maxlength="200" placeholder="${mine ? 'e.g. 5.00 taken for change' : 'e.g. cashier left without closing'}"></div>`,
      onSubmit: async (data) => {
        if (data.counted === '') throw new Error('Enter the cash you counted');
        const z = await api('POST', `/api/shifts/${x.id}/close`, { counted: data.counted, note: data.note });
        toast(`Shift closed: ${differenceLabel(z.difference_cents).toLowerCase()}`, z.difference_cents < 0 ? 'error' : '');
        setTimeout(() => showShift(z.id), 0);
        reload();
      },
    });
  }));
  const openForm = $('#sh-open');
  if (openForm) openForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', '/api/shifts/open', { float: formData(openForm).float });
      toast('Shift opened');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  if ($('#sh-close')) $('#sh-close').onclick = () =>
    modal({
      title: 'Close your shift',
      submitLabel: 'Close shift',
      body: `<p style="margin-top:0">Count <strong>all</strong> the cash in the drawer, including the float, and enter the total.
          The expected amount is shown after you close, so count carefully.</p>
        <div class="field"><label>Counted cash</label><input name="counted" type="number" min="0" step="0.01" required></div>
        <div class="field"><label>Note (optional)</label><input name="note" maxlength="200" placeholder="e.g. 5.00 taken for change"></div>`,
      onSubmit: async (data) => {
        if (data.counted === '') throw new Error('Enter the cash you counted');
        const z = await api('POST', '/api/shifts/close', { counted: data.counted, note: data.note });
        toast(`Shift closed: ${differenceLabel(z.difference_cents).toLowerCase()}`, z.difference_cents < 0 ? 'error' : '');
        setTimeout(() => showShift(z.id), 0);
        reload();
      },
    });
}

// Invoice-style sale entry (Sales → New sale): customer, product lines, discount, Save.
// Saves through the same API as Pos Sales, so stock, reports and receipts work the same way.
async function pageNewSale(page) {
  const [products, customers, shift] = await Promise.all([api('GET', '/api/products'), api('GET', '/api/customers'), api('GET', '/api/shifts/current').catch(() => ({}))]);
  const blocked = shiftRequired() && !shift.shift;
  // The server only accepts a changed price from users who may give unlimited discounts.
  const canPrice = can('discount.unlimited');
  const lines = []; // { p, qty, price } — price in major units
  page.innerHTML = `
    <div class="page-head" data-no-export><h1>New sale</h1><a class="btn" href="#/sales">Back to sales</a></div>
    ${blocked ? openShiftBoxHtml() : ''}
    <form class="card" id="ns-form" novalidate>
      <div class="card-pad">
        <div class="row">
          <div class="field"><label>Customer</label><select name="customer_id">${customerOptions(customers)}</select></div>
          <div class="field"><label>Payment</label><select name="payment_method">${SALE_PAYMENT_OPTIONS}</select></div>
        </div>
        <div class="field hidden" id="ns-cust-info" style="font-size:12.5px"></div>
        <div class="field picker">
          <label>Add product</label>
          <input id="ns-search" placeholder="Type name or SKU, or scan barcode…" autocomplete="off">
          <div class="picker-list hidden" id="ns-results"></div>
        </div>
        <div class="table-wrap" style="border:1px solid var(--border);border-radius:8px">
          <table class="rs-lines"><thead><tr><th>Product</th><th class="num">In stock</th><th class="num" style="width:96px">Qty</th><th class="num" style="width:110px">Price</th><th class="num">Line total</th><th></th></tr></thead>
          <tbody id="ns-lines"></tbody></table>
        </div>
        <div class="ns-bottom">
          ${discountFieldHtml()}
          <div class="totals" id="ns-totals"></div>
        </div>
      </div>
      <div class="card-pad toolbar" style="justify-content:flex-end;border-top:1px solid var(--border)">
        <a class="btn" href="#/sales">Cancel</a>
        <button class="btn primary" type="submit" id="ns-save">Save sale</button>
      </div>
    </form>`;

  const form = $('#ns-form');
  const search = $('#ns-search');
  const body = $('#ns-lines');
  const custSel = $('[name=customer_id]', form);
  const methodSel = $('[name=payment_method]', form);
  let total = 0;

  const drawTotals = () => {
    const totals = saleTotals(lines.reduce((a, l) => a + lineCents(l, 'price'), 0), discount);
    total = totals.total;
    $('#ns-totals').innerHTML = totals.html;
    const short = lines.find((l) => l.qty > l.p.stock);
    const creditBlocked = drawCustomerCredit($('#ns-cust-info'), customers.find((c) => c.id === Number(custSel.value)), methodSel.value === 'credit', total);
    $('#ns-save').disabled = !lines.length || totals.overLimit || !!short || creditBlocked || blocked;
  };
  const discount = bindDiscountField(form, drawTotals);
  custSel.onchange = methodSel.onchange = drawTotals;

  const editor = lineEditor({
    body, search, lines, field: 'price', editable: canPrice, warnShort: true,
    emptyText: 'Search above to add the products being sold', onChange: drawTotals,
  });
  const addLine = (p) => {
    if (p.stock <= 0 && !lines.some((l) => l.p.id === p.id)) return toast(`${p.name} is out of stock`, 'error');
    editor.add(p, 1);
  };
  bindOpenShiftBox(page, () => pageNewSale(page));
  bindProductPicker(search, $('#ns-results'), products, addLine, (p) => (lines.some((l) => l.p.id === p.id) ? 'added' : p.stock <= 0 ? 'out of stock' : ''));

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = formData(form);
    const bad = lines.find((l) => !Number.isInteger(l.qty) || l.qty < 1);
    if (bad) return toast(`Enter a whole-number quantity for ${bad.p.name}`, 'error');
    const short = lines.find((l) => l.qty > l.p.stock);
    if (short) return toast(`Only ${short.p.stock} ${short.p.unit} of ${short.p.name} in stock`, 'error');
    if (data.payment_method === 'credit' && !data.customer_id) return toast('Choose a registered customer for a credit sale', 'error');
    const btn = $('#ns-save');
    btn.disabled = true;
    try {
      const sale = await api('POST', '/api/sales', {
        ...data,
        items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty, ...(canPrice ? { price: l.price ?? 0 } : {}) })),
      });
      toast(`Sale #${sale.id} saved: ${money(sale.total_cents)}`);
      history.replaceState(null, '', '#/sales');
      await router();
      showSale(sale.id, true);
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  };

  editor.draw();
  search.focus();
}

// Receipt for a customer payment (money in) or voucher for a supplier payment (money out).
// `balance` is what is still owed after this payment.
function showPaymentReceipt(kind, party, p, balance = party.balance_cents) {
  const isCustomer = kind === 'customer';
  const html = `<div class="receipt">
    ${printLogo()}
    <div class="c"><strong>${esc(state.settings.shop_name)}</strong></div>
    <div class="c">${isCustomer ? 'PAYMENT RECEIPT' : 'PAYMENT VOUCHER'}</div>
    <div class="c"><strong>${esc(p.ref)}</strong></div>
    <div class="c">${esc(p.created_at)}</div>
    <hr>
    <div class="r"><span>${isCustomer ? 'Received from' : 'Paid to'}</span><span>${esc(party.name)}</span></div>
    ${party.phone ? `<div class="r"><span>Phone</span><span>${esc(party.phone)}</span></div>` : ''}
    <div class="r"><span>Method</span><span>${esc(METHOD_LABEL[p.method] || p.method)}</span></div>
    ${p.note ? `<div class="r"><span>Reference</span><span>${esc(p.note)}</span></div>` : ''}
    <hr>
    <div class="r"><strong>AMOUNT ${esc(state.settings.currency)}</strong><strong>${toMajor(p.amount_cents)}</strong></div>
    <div class="r"><span>${balance < 0 ? 'Advance held' : 'Balance still owed'}</span><span>${toMajor(Math.abs(balance))}</span></div>
    ${p.reversed ? `<hr><div class="c"><strong>*** REVERSED — NOT VALID ***</strong></div>${p.reverse_reason ? `<div class="c">${esc(p.reverse_reason)}</div>` : ''}` : ''}
    <hr><div class="c">${isCustomer ? 'Thank you!' : 'Signature: ______________'}</div>
  </div>`;
  modal({
    title: `Payment ${p.ref}${p.reversed ? ' (reversed)' : ''}`,
    body: html,
    footer: '<button type="button" class="btn" data-print>Print</button><button type="button" class="btn primary" data-close>Done</button>',
  });
  $('#modal-root [data-print]').onclick = () => printHtml(html);
}

// Asks for a reason, then reverses a payment or expense. Nothing is deleted: the entry stays
// on record marked "reversed" and stops counting in balances and reports.
async function reverseWithReason(what, effect, url, onDone) {
  const data = await confirmBox(`Reverse this ${what}?`, `Use this if it was recorded by mistake. ${effect} It stays on record, marked as reversed.`, 'Reverse',
    '<div class="field"><label>Reason *</label><input name="reason" required maxlength="200" placeholder="e.g. entered twice"></div>');
  if (!data) return;
  try {
    await api('POST', url, { reason: data.reason });
    toast(`${what[0].toUpperCase() + what.slice(1)} reversed`);
    onDone();
  } catch (err) {
    toast(err.message, 'error');
  }
}

const reversedNote = (e) => (e.status === 'reversed' ? ` <span class="badge danger">reversed</span>${e.reverse_reason ? ` <span class="muted">${esc(e.reverse_reason)}</span>` : ''}` : '');

// ---------- shared by customer and supplier accounts ----------

// The "Details" card: [label, value] rows; empty values show a dash.
const detailsCard = (rows) => `<div class="card">
    <div class="card-head"><h2>Details</h2></div>
    <table class="statement"><tbody>
      ${rows.map(([k, v]) => `<tr><td class="muted" style="width:40%">${k}</td><td>${v ? esc(v) : '<span class="muted">—</span>'}</td></tr>`).join('')}
    </tbody></table>
  </div>`;

// The statement card: opening balance, one row per entry, closing balance.
//   chargeLabel / balanceLabel: column headings; csvUrl: the CSV download; note: text under the table;
//   txn(e): the Transaction cell; rowAttr(e, i): data-* attributes (clicking a row opens it);
//   charged(e): the charge cell.
function statementCard(st, { chargeLabel, balanceLabel, csvUrl, note, txn, rowAttr, charged = (e) => (e.charge_cents ? money(e.charge_cents) : '') }) {
  return `<div class="card">
    <div class="card-head" style="flex-wrap:wrap"><h2>Statement of account</h2>
      <div class="toolbar">${dateRangeControls(st.from, st.to)}
        <button class="btn sm" data-print-statement>Print</button>
        <a class="btn sm" href="${csvUrl}?from=${st.from}&to=${st.to}">Export CSV</a></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Date</th><th>Transaction</th><th>Details</th><th class="num">${chargeLabel}</th><th class="num">Paid</th><th class="num">${balanceLabel}</th><th></th></tr></thead><tbody>
      <tr><td>${fmtDate(st.from)}</td><td colspan="4"><strong>Opening balance</strong></td><td class="num"><strong>${money(st.opening_balance)}</strong></td><td></td></tr>
      ${st.entries.map((e, i) => `<tr class="clickable ${e.status === 'void' || e.status === 'reversed' ? 'void' : ''}" ${rowAttr(e, i)}>
        <td>${fmtDateTime(e.date)}</td>
        <td class="keep">${txn(e)}</td>
        <td class="wrap" style="max-width:270px">${esc(e.description)}</td>
        <td class="num">${charged(e)}</td>
        <td class="num pos-num">${e.paid_cents ? money(e.paid_cents) : ''}</td>
        <td class="num">${money(e.balance_cents)}</td>
        <td class="num keep">${e.kind === 'payment' && e.status !== 'reversed' ? `<button class="btn sm" data-revpay="${e.id}" title="Reverse a payment recorded by mistake">Reverse</button>` : ''}</td></tr>`).join('')}
      ${st.entries.length ? '' : '<tr><td colspan="7" class="empty">No transactions in this period</td></tr>'}
      <tr class="subtotal" style="background:var(--surface-2)"><td>${fmtDate(st.to)}</td><td colspan="2"><strong>Closing balance</strong></td>
        <td class="num">${money(st.total_charges)}</td><td class="num">${money(st.total_paid)}</td><td class="num"><strong>${money(st.closing_balance)}</strong></td><td></td></tr>
    </tbody></table></div>
    <div class="card-pad muted" style="font-size:12.5px;border-top:1px solid var(--border)">${note}</div>
  </div>`;
}

// Printed statement. who: the line under the title; txnText(e): plain-text Transaction cell.
function printStatement({ title, who, st, chargeLabel, totalLabel, txnText }) {
  printHtml(`<div class="print-doc">
    ${printLogo()}
    <h2>${esc(state.settings.shop_name)}</h2>
    <h3 style="margin:6px 0 2px">${title}</h3>
    <div>${who}</div>
    <div>${fmtDate(st.from)} – ${fmtDate(st.to)}</div>
    <table style="margin-top:12px"><thead><tr><th>Date</th><th>Transaction</th><th>Details</th><th class="num">${chargeLabel}</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>
      <tr><td>${esc(st.from)}</td><td colspan="4">Opening balance</td><td class="num">${toMajor(st.opening_balance)}</td></tr>
      ${st.entries.map((e) => `<tr><td>${esc(e.date.slice(0, 16))}</td><td>${txnText(e)}</td><td>${esc(e.description)}</td>
        <td class="num">${e.charge_cents ? toMajor(e.charge_cents) : ''}</td><td class="num">${e.paid_cents ? toMajor(e.paid_cents) : ''}</td><td class="num">${toMajor(e.balance_cents)}</td></tr>`).join('')}
      <tr><td colspan="3"><strong>${totalLabel} (${esc(state.settings.currency)})</strong></td><td class="num">${toMajor(st.total_charges)}</td><td class="num">${toMajor(st.total_paid)}</td><td class="num"><strong>${toMajor(st.closing_balance)}</strong></td></tr>
    </tbody></table></div>`);
}

// Everything a statement card does when clicked, plus the "Record payment" form.
//   kind: 'customer' | 'supplier'; party: the customer or supplier; st: their statement;
//   reload(from, to): redraws the page; text: the wording that differs between the two.
function bindAccount(page, { kind, party, st, reload, text, print }) {
  const base = `/api/${kind}s/${party.id}`;
  bindDateRange(page, (f, t) => reload(f, t));
  $$('[data-pay]', page).forEach((r) => (r.onclick = () => {
    const e = st.entries[r.dataset.pay];
    showPaymentReceipt(kind, party, { ref: e.ref, amount_cents: e.amount_cents, method: e.method, reversed: e.status === 'reversed', reverse_reason: e.reverse_reason,
      note: e.description === text.defaultNote ? '' : e.description, created_at: e.date }, e.balance_cents);
  }));
  $$('[data-revpay]', page).forEach((b) => (b.onclick = (ev) => {
    ev.stopPropagation();
    reverseWithReason('payment', text.reverseEffect, `${base}/payments/${b.dataset.revpay}/reverse`, () => reload(st.from, st.to));
  }));
  $('[data-print-statement]', page).onclick = print;
  $('[data-record-payment]', page).onclick = () =>
    modal({
      title: text.paymentTitle,
      submitLabel: 'Record payment',
      body: `
        <p style="margin-top:0" ${party.balance_cents > 0 ? '' : 'class="muted"'}>${party.balance_cents > 0 ? text.owes(money(party.balance_cents)) : text.owesNothing}</p>
        <div class="row">
          <div class="field"><label>${text.amountLabel}</label><input name="amount" type="number" min="0.01" step="0.01" value="${party.balance_cents > 0 ? toMajor(party.balance_cents) : ''}" required></div>
          <div class="field"><label>Paid by</label><select name="method">${PAYMENT_OPTIONS}</select></div>
        </div>
        <div class="field"><label>Note / reference</label><input name="note" placeholder="${text.notePlaceholder}"></div>`,
      onSubmit: async (data) => {
        const updated = await api('POST', `${base}/payments`, data);
        toast(`Payment ${updated.payment.ref} recorded`);
        setTimeout(() => showPaymentReceipt(kind, updated, updated.payment), 0);
        reload(st.from, st.to);
      },
    });
}

// ---------- customers (credit accounts) ----------

function balanceBadge(c) {
  const b = c.balance_cents;
  const over = c.credit_limit_cents > 0 && b > c.credit_limit_cents;
  if (b > 0) return `<span class="badge ${over ? 'danger' : 'warn'}">${money(b)}</span>`;
  if (b < 0) return `<span class="badge info">${money(-b)} advance</span>`;
  return '<span class="badge ok">Paid up</span>';
}

function customerForm(c = {}) {
  return `
    <div class="row">
      <div class="field"><label>Full name *</label><input name="name" value="${esc(c.name)}" required></div>
      <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(c.phone)}"></div>
    </div>
    <div class="row">
      <div class="field"><label>ID / national ID number</label><input name="id_number" value="${esc(c.id_number)}"></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${esc(c.email)}"></div>
    </div>
    <div class="field"><label>Address / location</label><input name="address" value="${esc(c.address)}"></div>
    <div class="field"><label>Credit limit (0 = no limit)</label><input name="credit_limit" type="number" min="0" step="0.01" value="${toMajor(c.credit_limit_cents)}"></div>
    <div class="field"><label>Notes</label><textarea name="notes" rows="2" placeholder="e.g. pays at the end of each month">${esc(c.notes)}</textarea></div>
    ${c.id ? `<label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${c.active ? 'checked' : ''} style="width:auto;min-height:0"> Active (can buy on credit)</label>` : ''}`;
}

function editCustomer(c, onSaved) {
  modal({
    title: c ? `Edit ${c.name}` : 'Register customer',
    body: customerForm(c || {}),
    submitLabel: c ? 'Save' : 'Register',
    onSubmit: async (data) => {
      const saved = c
        ? await api('PUT', `/api/customers/${c.id}`, { ...data, active: data.active === 'on' })
        : await api('POST', '/api/customers', data);
      toast(c ? 'Customer updated' : `${saved.name} registered`);
      onSaved(saved);
    },
  });
}

async function pageCustomers(page) {
  if (state.routeArg && state.routeArg !== 'new') return pageCustomer(page, Number(state.routeArg));
  const customers = await api('GET', '/api/customers?all=1');
  const active = customers.filter((c) => c.active);
  const owing = customers.filter((c) => c.balance_cents > 0);
  const overLimit = owing.filter((c) => c.credit_limit_cents > 0 && c.balance_cents > c.credit_limit_cents);
  page.innerHTML = `
    <div class="page-head"><h1>Customers</h1>
      <div class="toolbar">
        <input id="c-search" placeholder="Search name, phone, ID…" style="width:220px">
        <select id="c-filter" style="width:auto"><option value="">Active customers</option><option value="owing">Owing money</option><option value="over">Over credit limit</option><option value="inactive">Inactive</option></select>
        <button class="btn primary" id="c-add">Register customer</button>
      </div>
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Credit customers</div><div class="value">${active.length}</div></div>
      <div class="card kpi"><div class="label">Total owed to you</div><div class="value">${money(owing.reduce((a, c) => a + c.balance_cents, 0))}</div><div class="sub">by ${owing.length} customer${owing.length === 1 ? '' : 's'}</div></div>
      <div class="card kpi"><div class="label">Over credit limit</div><div class="value ${overLimit.length ? 'neg-num' : ''}">${overLimit.length}</div></div>
    </div>
    <div class="card table-wrap" id="c-table"></div>`;

  const draw = () => {
    const q = $('#c-search').value.trim().toLowerCase();
    const f = $('#c-filter').value;
    const list = customers.filter((c) => {
      if (f === 'inactive' ? c.active : f === '' && !c.active) return false;
      if (f === 'owing' && c.balance_cents <= 0) return false;
      if (f === 'over' && !(c.credit_limit_cents > 0 && c.balance_cents > c.credit_limit_cents)) return false;
      return !q || [c.name, c.phone, c.id_number, c.email].some((v) => v.toLowerCase().includes(q));
    });
    $('#c-table').innerHTML = list.length ? `<table><thead><tr><th>Customer</th><th>Phone</th><th>ID number</th><th class="num">Credit limit</th><th class="num">Balance owed</th><th>Last purchase</th><th></th></tr></thead><tbody>
      ${list.map((c) => `<tr class="clickable" data-id="${c.id}">
        <td><strong>${esc(c.name)}</strong>${c.active ? '' : ' <span class="badge">inactive</span>'}</td><td>${esc(c.phone)}</td><td class="muted">${esc(c.id_number)}</td>
        <td class="num">${c.credit_limit_cents ? money(c.credit_limit_cents) : '<span class="muted">No limit</span>'}</td>
        <td class="num">${balanceBadge(c)}</td><td class="muted">${c.last_purchase ? fmtDateTime(c.last_purchase) : '—'}</td><td class="num muted">View ›</td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">${customers.length ? 'No matching customers' : 'No customers yet. Register customers who buy on credit to track what they owe.'}</div>`;
    $$('#c-table tr[data-id]').forEach((r) => (r.onclick = () => (location.hash = `#/customers/${r.dataset.id}`)));
  };
  $('#c-search').oninput = $('#c-filter').onchange = draw;
  const add = () => editCustomer(null, (c) => (location.hash = `#/customers/${c.id}`));
  $('#c-add').onclick = add;
  draw();
  if (state.routeArg === 'new') {
    history.replaceState(null, '', '#/customers');
    add();
  }
}

const METHOD_LABEL = { cash: 'Cash', card: 'Card', mobile: 'Mobile money', credit: 'On credit', bank: 'Bank transfer' };

async function pageCustomer(page, id, from, to = localDate()) {
  const first = await api('GET', `/api/customers/${id}`);
  from = from || first.created_at.slice(0, 10);
  const st = await api('GET', `/api/customers/${id}/statement?from=${from}&to=${to}`);
  const c = st.customer;
  const avail = c.credit_limit_cents ? c.credit_limit_cents - c.balance_cents : null;
  const txnName = (e) => (e.kind === 'sale' ? `Sale #${e.id}` : `${e.ref} ${e.kind === 'return' ? 'Return' : 'Payment'}`);
  const txnMethod = (e) => (e.kind === 'sale' && e.status === 'void' ? 'void' : e.kind === 'return' ? REFUND_LABEL[e.method] || e.method : METHOD_LABEL[e.method] || e.method);

  page.innerHTML = `
    <div class="page-head">
      <div><a href="#/customers" style="font-size:13px;text-decoration:none">‹ All customers</a><h1 style="margin-top:4px">${esc(c.name)} ${c.active ? '' : '<span class="badge">inactive</span>'}</h1></div>
      <div class="toolbar">
        <button class="btn" id="cu-edit">Edit</button>
        ${c.active ? `<a class="btn" href="#/sell/${c.id}">New credit sale</a>` : ''}
        <button class="btn primary" data-record-payment>Record payment</button>
      </div>
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Balance owed</div><div class="value ${c.balance_cents > 0 ? 'neg-num' : ''}">${money(Math.max(c.balance_cents, 0))}</div>
        <div class="sub">${c.balance_cents < 0 ? `${money(-c.balance_cents)} paid in advance` : c.last_payment ? `last payment ${fmtDateTime(c.last_payment)}` : 'no payments yet'}</div></div>
      <div class="card kpi"><div class="label">Credit available</div><div class="value ${avail !== null && avail < 0 ? 'neg-num' : ''}">${avail === null ? 'No limit' : money(avail)}</div>
        <div class="sub">${c.credit_limit_cents ? `limit ${money(c.credit_limit_cents)}` : ''}</div></div>
      <div class="card kpi"><div class="label">Total purchases</div><div class="value">${money(c.total_purchases_cents)}</div><div class="sub">${c.sale_count} sales · ${money(c.total_credit_cents)} on credit</div></div>
      <div class="card kpi"><div class="label">Total paid on account</div><div class="value">${money(c.total_paid_cents)}</div></div>
    </div>
    <div class="grid side-main">
      ${detailsCard([['Phone', c.phone], ['ID number', c.id_number], ['Email', c.email], ['Address', c.address], ['Customer since', fmtDate(c.created_at)], ['Notes', c.notes]])}
      ${statementCard(st, {
        chargeLabel: 'Charged',
        balanceLabel: 'Balance',
        csvUrl: `/api/customers/${c.id}/statement.csv`,
        note: 'Credit sales add to the balance; payments and returns to the account reduce it. Sales paid at the till, and refunds paid out, are listed too with equal amounts charged and paid.',
        rowAttr: (e, i) => (e.kind === 'sale' ? `data-sale="${e.id}"` : e.kind === 'return' ? `data-sale="${e.sale_id}"` : `data-pay="${i}"`),
        charged: (e) => (e.charge_cents ? money(e.charge_cents) : e.status === 'void' ? money(e.amount_cents) : ''),
        txn: (e) =>
          e.kind === 'return'
            ? `<span class="badge warn">${esc(e.ref)}</span> Return <span class="muted">${esc(txnMethod(e))}</span>`
            : e.kind === 'sale'
            ? `Sale #${e.id} <span class="badge ${e.status === 'void' ? 'danger' : e.method === 'credit' ? 'warn' : ''}">${esc(txnMethod(e))}</span>`
            : `<span class="badge ok">${esc(e.ref)}</span> Payment <span class="muted">${esc(txnMethod(e))}</span>${reversedNote(e)}`,
      })}
    </div>`;

  $$('[data-sale]', page).forEach((r) => (r.onclick = () => showSale(r.dataset.sale)));
  $('#cu-edit').onclick = () => editCustomer(c, () => pageCustomer(page, id, from, to));
  bindAccount(page, {
    kind: 'customer',
    party: c,
    st,
    reload: (f, t) => pageCustomer(page, id, f, t),
    text: {
      defaultNote: 'Payment received',
      reverseEffect: 'The amount will be added back to what the customer owes.',
      paymentTitle: `Payment from ${c.name}`,
      owes: (amount) => `Currently owes <strong>${amount}</strong>.`,
      owesNothing: 'This customer owes nothing. A payment now is kept as an advance.',
      amountLabel: 'Amount received',
      notePlaceholder: 'e.g. receipt no. or transaction ID',
    },
    print: () =>
      printStatement({
        title: 'Statement of account',
        who: `${esc(c.name)}${c.phone ? ` · ${esc(c.phone)}` : ''}${c.id_number ? ` · ID ${esc(c.id_number)}` : ''}`,
        st,
        chargeLabel: 'Charged',
        totalLabel: 'Balance due',
        txnText: (e) => `${esc(txnName(e))} (${esc(txnMethod(e))})${e.status === 'reversed' ? ' — REVERSED' : ''}`,
      }),
  });
}

// ---------- suppliers (accounts payable) ----------

function payableBadge(s) {
  const b = s.balance_cents;
  if (b > 0) return `<span class="badge warn">${money(b)}</span>`;
  if (b < 0) return `<span class="badge info">${money(-b)} advance</span>`;
  return '<span class="badge ok">Paid up</span>';
}

function editSupplier(s, onSaved) {
  modal({
    title: s ? `Edit ${s.name}` : 'Register supplier',
    submitLabel: s ? 'Save' : 'Register',
    body: `
      <div class="row">
        <div class="field"><label>Business name *</label><input name="name" value="${esc(s?.name)}" required></div>
        <div class="field"><label>Contact person</label><input name="contact_person" value="${esc(s?.contact_person)}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(s?.phone)}"></div>
        <div class="field"><label>Email</label><input name="email" type="email" value="${esc(s?.email)}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Address / location</label><input name="address" value="${esc(s?.address)}"></div>
        <div class="field"><label>Tax / business reg. no.</label><input name="tax_id" value="${esc(s?.tax_id)}"></div>
      </div>
      <div class="field"><label>Notes</label><textarea name="notes" rows="2" placeholder="e.g. delivers on Mondays, 30 days to pay">${esc(s?.notes)}</textarea></div>
      ${s ? `<label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} style="width:auto;min-height:0"> Active (shown when receiving stock)</label>` : ''}`,
    onSubmit: async (data) => {
      const saved = s
        ? await api('PUT', `/api/suppliers/${s.id}`, { ...data, active: data.active === 'on' })
        : await api('POST', '/api/suppliers', data);
      toast(s ? 'Supplier updated' : `${saved.name} registered`);
      onSaved(saved);
    },
  });
}

async function pageSuppliers(page) {
  if (state.routeArg && state.routeArg !== 'new') return pageSupplier(page, Number(state.routeArg));
  const suppliers = await api('GET', '/api/suppliers?all=1');
  const active = suppliers.filter((s) => s.active);
  const owed = suppliers.filter((s) => s.balance_cents > 0);
  page.innerHTML = `
    <div class="page-head"><h1>Suppliers</h1>
      <div class="toolbar">
        <input id="su-search" placeholder="Search name, phone, contact…" style="width:220px">
        <select id="su-filter" style="width:auto"><option value="">Active suppliers</option><option value="owed">You owe money</option><option value="inactive">Inactive</option></select>
        <button class="btn primary" id="su-add">Register supplier</button>
      </div>
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Suppliers</div><div class="value">${active.length}</div></div>
      <div class="card kpi"><div class="label">You owe suppliers</div><div class="value ${owed.length ? 'neg-num' : ''}">${money(owed.reduce((a, s) => a + s.balance_cents, 0))}</div><div class="sub">to ${owed.length} supplier${owed.length === 1 ? '' : 's'}</div></div>
    </div>
    <div class="card table-wrap" id="su-table"></div>`;

  const draw = () => {
    const q = $('#su-search').value.trim().toLowerCase();
    const f = $('#su-filter').value;
    const list = suppliers.filter((s) => {
      if (f === 'inactive' ? s.active : f === '' && !s.active) return false;
      if (f === 'owed' && s.balance_cents <= 0) return false;
      return !q || [s.name, s.phone, s.contact_person, s.email, s.tax_id].some((v) => v.toLowerCase().includes(q));
    });
    $('#su-table').innerHTML = list.length ? `<table><thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th class="num">You owe</th><th>Last delivery</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr class="clickable" data-id="${s.id}">
        <td><strong>${esc(s.name)}</strong>${s.active ? '' : ' <span class="badge">inactive</span>'}</td><td>${esc(s.contact_person)}</td><td>${esc(s.phone)}</td>
        <td class="num">${payableBadge(s)}</td><td class="muted">${s.last_purchase ? fmtDateTime(s.last_purchase) : '—'}</td><td class="num muted">View ›</td></tr>`).join('')}
    </tbody></table>` : `<div class="empty">${suppliers.length ? 'No matching suppliers' : 'No suppliers yet. Register the businesses you buy stock from to track deliveries and what you owe them.'}</div>`;
    $$('#su-table tr[data-id]').forEach((r) => (r.onclick = () => (location.hash = `#/suppliers/${r.dataset.id}`)));
  };
  $('#su-search').oninput = $('#su-filter').onchange = draw;
  const add = () => editSupplier(null, (s) => (location.hash = `#/suppliers/${s.id}`));
  $('#su-add').onclick = add;
  draw();
  if (state.routeArg === 'new') {
    history.replaceState(null, '', '#/suppliers');
    add();
  }
}

async function pageSupplier(page, id, from, to = localDate()) {
  const first = await api('GET', `/api/suppliers/${id}`);
  from = from || first.created_at.slice(0, 10);
  const st = await api('GET', `/api/suppliers/${id}/statement?from=${from}&to=${to}`);
  const s = st.supplier;
  const label = (e) => esc(METHOD_LABEL[e.method] || e.method);

  page.innerHTML = `
    <div class="page-head">
      <div><a href="#/suppliers" style="font-size:13px;text-decoration:none">‹ All suppliers</a><h1 style="margin-top:4px">${esc(s.name)} ${s.active ? '' : '<span class="badge">inactive</span>'}</h1></div>
      <div class="toolbar">
        <button class="btn" id="sp-edit">Edit</button>
        ${s.active ? '<button class="btn" id="sp-receive">Receive stock</button>' : ''}
        <button class="btn primary" data-record-payment>Record payment</button>
      </div>
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">You owe</div><div class="value ${s.balance_cents > 0 ? 'neg-num' : ''}">${money(Math.max(s.balance_cents, 0))}</div>
        <div class="sub">${s.balance_cents < 0 ? `${money(-s.balance_cents)} paid in advance` : s.last_payment ? `last payment ${fmtDateTime(s.last_payment)}` : 'no payments yet'}</div></div>
      <div class="card kpi"><div class="label">Total bought</div><div class="value">${money(s.total_purchases_cents)}</div><div class="sub">${s.purchase_count} deliveries · ${money(s.total_credit_cents)} on credit</div></div>
      <div class="card kpi"><div class="label">Total paid on account</div><div class="value">${money(s.total_paid_cents)}</div></div>
    </div>
    <div class="grid side-main">
      ${detailsCard([['Contact', s.contact_person], ['Phone', s.phone], ['Email', s.email], ['Address', s.address], ['Tax / reg. no.', s.tax_id], ['Supplier since', fmtDate(s.created_at)], ['Notes', s.notes]])}
      ${statementCard(st, {
        chargeLabel: 'Received',
        balanceLabel: 'You owe',
        csvUrl: `/api/suppliers/${s.id}/statement.csv`,
        note: 'Deliveries on credit add to what you owe and payments reduce it. Deliveries paid on the spot are listed too, with the same amount received and paid.',
        rowAttr: (e, i) => (e.kind === 'purchase' ? `data-purchase="${e.id}"` : `data-pay="${i}"`),
        txn: (e) =>
          e.kind === 'purchase'
            ? `Delivery #${e.id} <span class="badge ${e.method === 'credit' ? 'warn' : ''}">${label(e)}</span>`
            : `<span class="badge ok">${esc(e.ref)}</span> Payment <span class="muted">${label(e)}</span>${reversedNote(e)}`,
      })}
    </div>`;

  $$('[data-purchase]', page).forEach((r) => (r.onclick = () => showPurchase(r.dataset.purchase)));
  const reload = () => pageSupplier(page, id, from, to);
  $('#sp-edit').onclick = () => editSupplier(s, reload);
  $('#sp-receive') && ($('#sp-receive').onclick = () => openReceiveStock({ supplierId: s.id, onDone: reload }));
  bindAccount(page, {
    kind: 'supplier',
    party: s,
    st,
    reload: (f, t) => pageSupplier(page, id, f, t),
    text: {
      defaultNote: 'Payment made',
      reverseEffect: 'The amount will be added back to what you owe.',
      paymentTitle: `Payment to ${s.name}`,
      owes: (amount) => `You currently owe <strong>${amount}</strong>.`,
      owesNothing: 'You owe this supplier nothing. A payment now is kept as an advance.',
      amountLabel: 'Amount paid',
      notePlaceholder: 'e.g. cheque no. or transaction ID',
    },
    print: () =>
      printStatement({
        title: 'Supplier statement',
        who: `${esc(s.name)}${s.contact_person ? ` · ${esc(s.contact_person)}` : ''}${s.phone ? ` · ${esc(s.phone)}` : ''}`,
        st,
        chargeLabel: 'Received',
        totalLabel: 'Balance owed',
        txnText: (e) => (e.kind === 'purchase' ? `Delivery #${e.id} (${label(e)})` : `${esc(e.ref)} Payment (${label(e)})${e.status === 'reversed' ? ' — REVERSED' : ''}`),
      }),
  });
}

// ---------- products ----------

function productForm(p = {}) {
  const isNew = !p.id;
  return `
    <div class="row">
      <div class="field"><label>Name *</label><input name="name" value="${esc(p.name)}" required></div>
      <div class="field"><label>SKU / barcode *</label><input name="sku" value="${esc(p.sku)}" required></div>
    </div>
    <div class="row">
      <div class="field"><label>Category</label><input name="category" value="${esc(p.category)}" list="cat-list"></div>
      <div class="field"><label>Unit</label><input name="unit" value="${esc(p.unit || 'pcs')}" placeholder="pcs, kg, box…"></div>
    </div>
    <div class="row">
      ${isNew || can('costs.view') ? `<div class="field"><label>Cost price (what you pay)</label><input name="cost" type="number" min="0" step="0.01" value="${toMajor(p.cost_cents)}"></div>` : ''}
      <div class="field"><label>Selling price</label><input name="price" type="number" min="0" step="0.01" value="${toMajor(p.price_cents)}"></div>
    </div>
    <div class="row">
      ${isNew ? '<div class="field"><label>Opening stock</label><input name="stock" type="number" min="0" step="1" value="0"></div>' : ''}
      <div class="field"><label>Reorder level (alert when stock falls to)</label><input name="reorder_level" type="number" min="0" step="1" value="${p.reorder_level ?? 5}"></div>
    </div>
    ${isNew ? `<div class="row">
      <div class="field"><label>Production date</label><input name="production_date" type="date" max="${localDate()}"></div>
      <div class="field"><label>Expiry date</label><input name="expiry_date" type="date"></div>
    </div>
    <p class="muted" style="font-size:12.5px;margin:-4px 0 0">Optional: dates of the opening stock. With an expiry date it appears in Inventory → Expiry dates.</p>` : ''}
    ${isNew ? '' : `<label class="inline" style="color:var(--text)"><input type="checkbox" name="active" ${p.active ? 'checked' : ''} style="width:auto;min-height:0"> Active (shown in Pos Sales)</label>
      <p class="muted" style="font-size:12.5px;margin-bottom:0">Stock is changed from the Inventory page (receive stock or adjust count).</p>`}`;
}

// Import many products from an Excel (.xlsx) or CSV file: choose file → preview → import.
function openProductImport(onDone) {
  let file = null;
  let preview = null;
  const STATUS = { new: ['ok', 'New'], update: ['info', 'Update'], skip: ['', 'Skip'], error: ['danger', 'Error'] };
  const { form } = modal({
    title: 'Import products from Excel',
    wide: true,
    submitLabel: 'Import',
    body: `
      <p style="margin-top:0">Upload an Excel (.xlsx) or CSV file. The first row must hold the column names:
        <strong>Name</strong> and <strong>Selling price</strong> are required; SKU / Barcode, Category, Unit, Cost price, Opening stock and Reorder level are optional.</p>
      <p><a href="/api/products/import-template.xlsx">Download the Excel template</a> to fill in.</p>
      <div class="field"><label>File</label><input type="file" id="imp-file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"></div>
      <label class="inline" style="color:var(--text);margin-bottom:12px"><input type="checkbox" id="imp-update" style="width:auto;min-height:0"> Update products that already exist (same SKU): name, category, unit, prices and reorder level</label>
      <div id="imp-preview"></div>`,
    onSubmit: async () => {
      const importable = preview ? preview.summary.new + preview.summary.update : 0;
      if (!file) throw new Error('Choose a file first');
      if (!importable) throw new Error('There are no rows to import. Fix the errors in the file and choose it again.');
      const res = await upload(true);
      const s = res.summary;
      toast(`Imported: ${s.new} new, ${s.update} updated${s.skip ? `, ${s.skip} skipped` : ''}${s.error ? `, ${s.error} with errors not imported` : ''}`);
      onDone?.();
    },
  });
  const submitBtn = $('button[type=submit]', form);
  submitBtn.disabled = true;
  const box = $('#imp-preview', form);
  const upload = async (commit) => {
    const q = `?filename=${encodeURIComponent(file.name)}&update=${$('#imp-update', form).checked ? 1 : 0}&commit=${commit ? 1 : 0}`;
    const res = await portalFetch('/api/products/import' + q, { method: 'POST', headers: { ...PORTAL_HEADER, 'Content-Type': 'application/octet-stream' }, body: file });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Import failed');
    return data;
  };
  const showPreview = async () => {
    preview = null;
    submitBtn.disabled = true;
    if (!file) return (box.innerHTML = '');
    box.innerHTML = '<p class="muted">Reading file…</p>';
    try {
      preview = await upload(false);
    } catch (err) {
      box.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
      return;
    }
    const s = preview.summary;
    const importable = s.new + s.update;
    submitBtn.disabled = !importable;
    submitBtn.textContent = importable ? `Import ${importable} product${importable === 1 ? '' : 's'}` : 'Import';
    const cell = (v, isMoney) => (v === undefined || v === null ? '<span class="muted">—</span>' : isMoney ? money(Math.round(v * 100)) : esc(v));
    box.innerHTML = `
      <div class="toolbar" style="margin-bottom:10px">
        <span class="badge ok">${s.new} new</span><span class="badge info">${s.update} to update</span>
        ${s.skip ? `<span class="badge">${s.skip} skipped</span>` : ''}${s.error ? `<span class="badge danger">${s.error} with errors</span>` : ''}
      </div>
      ${s.error ? '<p class="muted" style="margin-top:0;font-size:12.5px">Rows with errors are not imported. Fix them in the file and choose it again, or import the rest now.</p>' : ''}
      <div class="table-wrap" style="border:1px solid var(--border);border-radius:8px;max-height:340px;overflow-y:auto">
        <table><thead><tr><th>Row</th><th>Status</th><th>Name</th><th>SKU</th><th>Category</th><th class="num">Cost</th><th class="num">Price</th><th class="num">Stock</th><th>Note</th></tr></thead><tbody>
        ${preview.rows.map((r) => `<tr>
          <td class="muted">${r.row}</td><td><span class="badge ${STATUS[r.status][0]}">${STATUS[r.status][1]}</span></td>
          <td>${cell(r.name)}</td><td>${cell(r.sku)}</td><td>${cell(r.category)}</td>
          <td class="num">${cell(r.cost, true)}</td><td class="num">${cell(r.price, true)}</td><td class="num">${cell(r.stock)}</td>
          <td class="wrap ${r.status === 'error' ? 'neg-num' : 'muted'}" style="font-size:12.5px">${esc(r.message)}</td></tr>`).join('')}
        </tbody></table>
      </div>`;
  };
  $('#imp-file', form).onchange = (e) => {
    file = e.target.files[0] || null;
    showPreview();
  };
  $('#imp-update', form).onchange = showPreview;
}

async function pageProducts(page) {
  const products = await api('GET', '/api/products?all=1');
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  page.innerHTML = `
    <div class="page-head"><h1>Products</h1>
      <div class="toolbar">
        <input id="p-search" placeholder="Search…" style="width:200px">
        <select id="p-cat" style="width:auto"><option value="">All categories</option>${categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <label class="inline" style="margin:0;color:var(--text)"><input type="checkbox" id="p-inactive" style="width:auto;min-height:0"> Show inactive</label>
        ${can('products.manage') ? '<button class="btn" id="p-import">Import from Excel</button><button class="btn primary" id="p-add">Add product</button>' : ''}
      </div>
    </div>
    <datalist id="cat-list">${categories.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
    <div class="card table-wrap" id="p-table"></div>`;

  const draw = () => {
    const q = $('#p-search').value.trim().toLowerCase();
    const c = $('#p-cat').value;
    const showInactive = $('#p-inactive').checked;
    const list = products.filter((p) => (showInactive || p.active) && (!c || p.category === c) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)));
    $('#p-table').innerHTML = list.length ? `<table><thead><tr><th>Product</th><th>SKU</th><th>Category</th>${can('costs.view') ? '<th class="num">Cost</th>' : ''}<th class="num">Price</th>${can('costs.view') ? '<th class="num">Margin</th>' : ''}<th class="num">Stock</th><th></th></tr></thead><tbody>
      ${list.map((p) => {
        const margin = p.price_cents ? (p.price_cents - p.cost_cents) / p.price_cents : 0;
        const low = p.stock <= p.reorder_level;
        return `<tr class="${can('products.manage') ? 'clickable' : ''}" data-id="${p.id}">
          <td><strong>${esc(p.name)}</strong>${p.active ? '' : ' <span class="badge">inactive</span>'}</td><td class="muted">${esc(p.sku)}</td><td>${esc(p.category)}</td>
          ${can('costs.view') ? `<td class="num">${money(p.cost_cents)}</td>` : ''}<td class="num">${money(p.price_cents)}</td>
          ${can('costs.view') ? `<td class="num ${margin < 0 ? 'neg-num' : ''}">${pct(margin)}</td>` : ''}
          <td class="num"><span class="badge ${p.stock <= 0 ? 'danger' : low ? 'warn' : 'ok'}">${p.stock} ${esc(p.unit)}</span></td>
          <td class="num">${can('products.manage') ? '<span class="muted">Edit ›</span>' : ''}</td></tr>`;
      }).join('')}</tbody></table>` : `<div class="empty">${products.length ? 'No matching products' : 'No products yet. Add your first product to start selling.'}</div>`;
    if (can('products.manage')) $$('#p-table tr[data-id]').forEach((r) => (r.onclick = () => editProduct(products.find((p) => p.id === Number(r.dataset.id)))));
  };

  const editProduct = (p) =>
    modal({
      title: p ? `Edit ${p.name}` : 'Add product',
      body: productForm(p || {}),
      onSubmit: async (data) => {
        if (p) await api('PUT', `/api/products/${p.id}`, { ...data, active: data.active === 'on' });
        else await api('POST', '/api/products', data);
        toast(p ? 'Product updated' : 'Product added');
        pageProducts(page);
      },
    });

  $('#p-search').oninput = $('#p-cat').onchange = $('#p-inactive').onchange = draw;
  if (can('products.manage')) {
    $('#p-add').onclick = () => editProduct(null);
    $('#p-import').onclick = () => openProductImport(() => pageProducts(page));
  }
  draw();
}

// ---------- inventory ----------

// Receive a delivery: one supplier, many products (search or scan a barcode to add each line).
// Paid on the spot, or on credit, which adds to what the shop owes that supplier.
async function openReceiveStock({ products, productId, supplierId, onDone }) {
  const suppliers = await api('GET', '/api/suppliers');
  if (!products) products = await api('GET', '/api/products');
  if (!products.length) return toast('Add a product first', 'error');
  const lines = [];
  const { form } = modal({
    title: 'Receive stock',
    submitLabel: 'Add to stock',
    wide: true,
    body: `
      <div class="row">
        <div class="field"><label>Supplier</label><select name="supplier_id"><option value="">Not registered</option>${suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Invoice # / note</label><input name="note"></div>
      </div>
      <div class="field" id="rs-free"><label>Supplier name (optional)</label><input name="supplier" placeholder="Or register them on the Suppliers page"></div>
      <div class="row">
        <div class="field"><label>Paid by</label><select name="payment_method">${PAYMENT_OPTIONS}<option value="credit">On credit (pay later)</option></select></div>
        <div class="field" id="rs-sup-info" style="font-size:12.5px;align-self:end"></div>
      </div>
      <div class="field picker">
        <label>Add product</label>
        <input id="rs-search" placeholder="Type name or SKU, or scan barcode…" autocomplete="off">
        <div class="picker-list hidden" id="rs-results"></div>
      </div>
      <div class="table-wrap" style="border:1px solid var(--border);border-radius:8px">
        <table class="rs-lines"><thead><tr><th>Product</th><th class="num">In stock</th><th class="num" style="width:96px">Qty</th><th class="num" style="width:110px">Unit cost</th><th style="width:150px">Expiry date</th><th class="num">Line total</th><th></th></tr></thead>
        <tbody id="rs-lines"></tbody></table>
      </div>
      <div class="totals" style="padding:10px 0 0"><div class="grand"><span>Purchase total</span><span class="num" id="rs-total">${money(0)}</span></div></div>`,
    onSubmit: async (data) => {
      if (!lines.length) throw new Error('Add at least one product to receive');
      const bad = lines.find((l) => !(l.qty >= 1) || !Number.isInteger(l.qty));
      if (bad) throw new Error(`Enter a whole-number quantity for ${bad.p.name}`);
      if (data.payment_method === 'credit' && !data.supplier_id) throw new Error('Choose a registered supplier to receive stock on credit');
      const res = await api('POST', '/api/inventory/restock', {
        supplier_id: data.supplier_id || null,
        supplier: data.supplier,
        payment_method: data.payment_method,
        note: data.note,
        items: lines.map((l) => ({ product_id: l.p.id, qty: l.qty, unit_cost: l.cost, ...(l.expiry ? { expiry: l.expiry } : {}) })),
      });
      toast(`Received ${res.products.length} product${res.products.length === 1 ? '' : 's'} · ${money(res.total_cents)}${data.payment_method === 'credit' ? ' on credit' : ''}`);
      onDone?.();
    },
  });
  const search = $('#rs-search', form);
  const results = $('#rs-results', form);
  const body = $('#rs-lines', form);
  const supSel = $('[name=supplier_id]', form);
  const methodSel = $('[name=payment_method]', form);
  const drawSupplier = () => {
    const s = suppliers.find((x) => x.id === Number(supSel.value));
    $('#rs-free', form).classList.toggle('hidden', !!s);
    const info = $('#rs-sup-info', form);
    if (!s) {
      info.innerHTML = methodSel.value === 'credit' ? '<span class="neg-num">Choose a registered supplier to buy on credit.</span>' : '';
      return;
    }
    const b = s.balance_cents;
    info.innerHTML = `<span class="muted">${b > 0 ? `You owe them <strong>${money(b)}</strong>` : b < 0 ? `You have <strong>${money(-b)}</strong> paid in advance` : 'Nothing owed to them'}</span>`;
  };
  supSel.onchange = methodSel.onchange = drawSupplier;
  if (supplierId) supSel.value = supplierId;
  drawSupplier();

  const editor = lineEditor({
    body, search, lines, field: 'cost', enterToPrice: true, expiry: true,
    emptyText: 'Search above to add the products in this delivery',
    onChange: () => ($('#rs-total', form).textContent = money(lines.reduce((a, l) => a + lineCents(l, 'cost'), 0))),
  });
  const addLine = (p) => editor.add(p, null);
  bindProductPicker(search, results, products, addLine, (p) => (lines.some((l) => l.p.id === p.id) ? 'added' : ''));
  editor.draw();
  // Wait until after modal() has done its own initial focus.
  const first = productId && products.find((p) => p.id === Number(productId));
  if (first) addLine(first);
  setTimeout(() => (first ? $('#rs-lines [data-f=qty]', form)?.focus() : search.focus()), 40);
}

// Shows one delivery with its product lines.
async function showPurchase(id) {
  const p = await api('GET', `/api/purchases/${id}`);
  modal({
    title: `Delivery #${p.id}`,
    wide: true,
    body: `
      <div class="toolbar" style="margin-bottom:12px">
        <span class="badge ${p.payment_method === 'credit' ? 'warn' : 'ok'}">${esc(METHOD_LABEL[p.payment_method] || p.payment_method)}</span>
        <span class="muted">${esc(p.created_at)} · by ${esc(p.username || '—')}${p.supplier ? ` · ${p.supplier_id ? `<a href="#/suppliers/${p.supplier_id}" data-close>${esc(p.supplier)}</a>` : esc(p.supplier)}` : ''}${p.invoice ? ` · Inv. ${esc(p.invoice)}` : ''}</span>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Unit cost</th><th class="num">Amount</th></tr></thead><tbody>
        ${p.items.map((i) => `<tr><td>${esc(i.name)} <span class="muted">${esc(i.sku)}</span></td><td class="num">${i.qty} ${esc(i.unit)}</td><td class="num">${money(i.unit_cost_cents)}</td><td class="num">${money(i.qty * i.unit_cost_cents)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="totals" style="padding:12px 0 0"><div class="grand"><span>Total</span><span class="num">${money(p.total_cents)}</span></div></div>`,
  });
}

const MOVE_LABEL = { opening: 'Opening', purchase: 'Received', adjustment: 'Adjustment', sale: 'Sale', void: 'Sale voided', return: 'Returned' };
const MOVE_BADGE = { opening: 'info', purchase: 'ok', adjustment: 'warn', sale: '', void: 'danger', return: 'info' };

async function pageInventory(page, tab = state.routeArg === 'expiry' ? 'expiry' : 'stock') {
  const [products, moves, batches] = await Promise.all([api('GET', '/api/products'), api('GET', '/api/inventory/movements?limit=300'), api('GET', '/api/inventory/batches')]);
  const expiring = batches.batches.filter((b) => b.state !== 'ok');
  const value = products.reduce((a, p) => a + Math.max(p.stock, 0) * p.cost_cents, 0);
  const retail = products.reduce((a, p) => a + Math.max(p.stock, 0) * p.price_cents, 0);
  const low = products.filter((p) => p.stock <= p.reorder_level);

  page.innerHTML = `
    <div class="page-head"><h1>Inventory</h1>
      ${can('inventory.manage') ? '<div class="toolbar"><button class="btn" id="i-adjust">Adjust count</button><button class="btn primary" id="i-restock">Receive stock</button></div>' : ''}
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Units in stock</div><div class="value">${products.reduce((a, p) => a + Math.max(p.stock, 0), 0)}</div></div>
      ${can('costs.view') ? `<div class="card kpi"><div class="label">Stock value (cost)</div><div class="value">${money(value)}</div></div>
      <div class="card kpi"><div class="label">Stock value (retail)</div><div class="value">${money(retail)}</div><div class="sub">${money(retail - value)} potential profit</div></div>` : ''}
      <div class="card kpi"><div class="label">Low / out of stock</div><div class="value ${low.length ? 'neg-num' : ''}">${low.length}</div></div>
      <div class="card kpi"><div class="label">Expired / expiring soon</div><div class="value ${expiring.some((b) => b.state === 'expired') ? 'neg-num' : ''}">${expiring.length}</div><div class="sub">batches within ${batches.warning_days} days</div></div>
    </div>
    <div class="tabs"><button data-tab="stock">Stock levels</button><button data-tab="moves">Stock movements</button><button data-tab="expiry">Expiry dates${expiring.length ? ` (${expiring.length})` : ''}</button></div>
    <div class="card table-wrap" id="i-body"></div>`;

  $$('.tabs button', page).forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.onclick = () => pageInventory(page, b.dataset.tab);
  });

  const body = $('#i-body');
  if (tab === 'stock') {
    const sorted = [...products].sort((a, b) => (a.stock - a.reorder_level) - (b.stock - b.reorder_level));
    body.innerHTML = sorted.length ? `<table><thead><tr><th>Product</th><th>SKU</th><th class="num">In stock</th><th class="num">Reorder at</th>${can('costs.view') ? '<th class="num">Avg. cost</th><th class="num">Value</th>' : ''}${can('inventory.manage') ? '<th></th>' : ''}</tr></thead><tbody>
      ${sorted.map((p) => `<tr><td><strong>${esc(p.name)}</strong></td><td class="muted">${esc(p.sku)}</td>
        <td class="num"><span class="badge ${p.stock <= 0 ? 'danger' : p.stock <= p.reorder_level ? 'warn' : 'ok'}">${p.stock} ${esc(p.unit)}</span></td>
        <td class="num">${p.reorder_level}</td>
        ${can('costs.view') ? `<td class="num">${money(p.cost_cents)}</td><td class="num">${money(Math.max(p.stock, 0) * p.cost_cents)}</td>` : ''}
        ${can('inventory.manage') ? `<td class="num"><button class="btn sm" data-restock="${p.id}">Receive</button> <button class="btn sm" data-adjust="${p.id}">Adjust</button></td>` : ''}</tr>`).join('')}
    </tbody></table>` : '<div class="empty">No products yet</div>';
  } else if (tab === 'expiry') {
    const label = (b) => (b.days_left < 0 ? `Expired ${-b.days_left} day${b.days_left === -1 ? '' : 's'} ago` : b.days_left === 0 ? 'Expires today' : `${b.days_left} day${b.days_left === 1 ? '' : 's'} left`);
    body.innerHTML = batches.batches.length
      ? `<table><thead><tr><th>Product</th><th>Expiry date</th><th>Status</th><th class="num">Left</th><th class="num">Received</th><th>Delivery</th>${can('inventory.manage') ? '<th></th>' : ''}</tr></thead><tbody>
        ${batches.batches.map((b) => `<tr><td><strong>${esc(b.product_name)}</strong><div class="muted" style="font-size:12px">${esc(b.sku)}</div></td>
          <td>${fmtDate(b.expiry_date)}${b.production_date ? `<div class="muted" style="font-size:12px">Made ${fmtDate(b.production_date)}</div>` : ''}</td>
          <td><span class="badge ${b.state === 'expired' ? 'danger' : b.state === 'soon' ? 'warn' : 'ok'}" style="text-transform:none">${label(b)}</span></td>
          <td class="num">${b.qty_left} ${esc(b.unit)}</td><td class="num muted">${b.qty_received}</td>
          <td class="muted">${b.purchase_id ? `#${b.purchase_id}${b.supplier ? ` · ${esc(b.supplier)}` : ''}${b.invoice ? ` · ${esc(b.invoice)}` : ''}` : 'Opening stock'}</td>
          ${can('inventory.manage') ? `<td class="num"><button class="btn sm ${b.state === 'expired' ? 'danger' : ''}" data-writeoff="${b.id}">Write off</button></td>` : ''}</tr>`).join('')}
        </tbody></table>
        <div class="card-pad muted" style="font-size:12.5px;border-top:1px solid var(--border)">Sales take stock from the batch that expires first. Stock received without an expiry date isn't listed here.
          Warning starts ${batches.warning_days} days before the date${can('settings.manage') ? ' (change it in Settings)' : ''}.</div>`
      : `<div class="empty">No stock with expiry dates yet. When you receive stock, enter the expiry date on each line that has one.</div>`;
    $$('[data-writeoff]', body).forEach((btn) => (btn.onclick = async () => {
      const b = batches.batches.find((x) => x.id === Number(btn.dataset.writeoff));
      const r = await confirmBox(`Write off ${b.qty_left} ${b.unit} of ${b.product_name}?`,
        `The batch expiring ${fmtDate(b.expiry_date)} is removed from stock and counted as a loss. Do this when the items are thrown away.`, 'Write off',
        '<div class="field"><label>Reason</label><select name="reason"><option>Expired</option><option>Spoiled / damaged</option><option>Returned to supplier</option></select></div>');
      if (!r) return;
      try {
        const res = await api('POST', `/api/inventory/batches/${b.id}/write-off`, { reason: r.reason });
        toast(`${res.qty} ${b.unit} of ${res.product} written off`);
        pageInventory(page, 'expiry');
      } catch (err) {
        toast(err.message, 'error');
      }
    }));
  } else {
    body.innerHTML = moves.length ? `<table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th class="num">Change</th>${can('costs.view') ? '<th class="num">Unit cost</th>' : ''}<th>Details</th><th>By</th></tr></thead><tbody>
      ${moves.map((m) => `<tr ${m.purchase_id && can('suppliers.manage', 'inventory.manage') ? `class="clickable" data-purchase="${m.purchase_id}"` : m.sale_id ? `class="clickable" data-sale="${m.sale_id}"` : ''}><td>${fmtDateTime(m.created_at)}</td><td>${esc(m.product_name)}</td>
        <td><span class="badge ${MOVE_BADGE[m.type]}">${MOVE_LABEL[m.type]}</span></td>
        <td class="num ${m.qty_change > 0 ? 'pos-num' : 'neg-num'}">${m.qty_change > 0 ? '+' : ''}${m.qty_change}</td>
        ${can('costs.view') ? `<td class="num">${money(m.unit_cost_cents)}</td>` : ''}
        <td class="wrap">${esc([m.supplier, m.note].filter(Boolean).join(' · '))}</td><td class="muted">${esc(m.username || '')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">No stock movements yet</div>';
    $$('[data-purchase]', body).forEach((r) => (r.onclick = () => showPurchase(r.dataset.purchase)));
    $$('[data-sale]', body).forEach((r) => (r.onclick = () => showSale(r.dataset.sale)));
  }

  if (!can('inventory.manage')) return;
  const restock = (id) => openReceiveStock({ products, productId: id, onDone: () => pageInventory(page, tab) });
  const adjust = (id) => {
    const { form } = modal({
      title: 'Adjust stock count',
      submitLabel: 'Save count',
      body: `
        <div class="field picker">
          <label>Product</label>
          <input id="adj-search" placeholder="Type name or SKU, or scan barcode…" autocomplete="off">
          <input type="hidden" name="product_id">
          <div class="picker-list hidden" id="adj-results"></div>
        </div>
        <div class="row">
          <div class="field"><label>Current (system)</label><input id="adj-cur" disabled></div>
          <div class="field"><label>Actual count</label><input name="new_count" type="number" min="0" step="1" required></div>
        </div>
        <div class="field"><label>Reason *</label><select name="note"><option>Stock count correction</option><option>Damaged</option><option>Expired</option><option>Lost / stolen</option><option>Own use</option><option>Returned to supplier</option><option>Other</option></select></div>`,
      onSubmit: async (data) => {
        if (!data.product_id) throw new Error('Search for and choose a product');
        const p = await api('POST', '/api/inventory/adjust', data);
        toast(`${p.name}: stock set to ${p.stock}`);
        pageInventory(page, tab);
      },
    });
    const search = $('#adj-search', form);
    const chosen = $('[name=product_id]', form);
    const cur = $('#adj-cur', form);
    const choose = (p) => {
      chosen.value = p.id;
      search.value = `${p.name} (${p.sku})`;
      cur.value = `${p.stock} ${p.unit}`;
      $('[name=new_count]', form).focus();
    };
    bindProductPicker(search, $('#adj-results', form), products, choose);
    // Typing again means a different product is being looked for.
    search.addEventListener('input', () => {
      chosen.value = '';
      cur.value = '';
    });
    const first = id && products.find((p) => p.id === Number(id));
    if (first) choose(first);
    setTimeout(() => (first ? $('[name=new_count]', form).focus() : search.focus()), 40);
  };
  $('#i-restock').onclick = () => restock();
  $('#i-adjust').onclick = () => (products.length ? adjust() : toast('Add a product first', 'error'));
  $$('[data-restock]', page).forEach((b) => (b.onclick = () => restock(b.dataset.restock)));
  $$('[data-adjust]', page).forEach((b) => (b.onclick = () => adjust(b.dataset.adjust)));
}

// ---------- accounting ----------

async function pageAccounting(page, from = datePresets().month[0], to = localDate(), tab = 'pl') {
  const [pl, ex] = await Promise.all([api('GET', `/api/reports/pl?from=${from}&to=${to}`), api('GET', `/api/expenses?from=${from}&to=${to}`)]);
  const line = (label, cents, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${money(cents)}</td></tr>`;
  const signed = (cents) => `<span class="${cents < 0 ? 'neg-num' : 'pos-num'}">${money(cents)}</span>`;

  page.innerHTML = `
    <div class="page-head"><h1>Accounting</h1>
      <div class="toolbar">${dateRangeControls(from, to)}<button class="btn primary" id="a-add">Record expense</button></div>
    </div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Net sales</div><div class="value">${money(pl.net_sales)}</div><div class="sub">${pl.sales_count} sales</div></div>
      <div class="card kpi"><div class="label">Gross profit</div><div class="value">${money(pl.gross_profit)}</div><div class="sub">${pct(pl.gross_margin)} margin</div></div>
      <div class="card kpi"><div class="label">Expenses</div><div class="value">${money(pl.total_expenses)}</div></div>
      <div class="card kpi"><div class="label">Net profit</div><div class="value">${signed(pl.net_profit)}</div></div>
    </div>
    <div class="tabs"><button data-tab="pl">Profit &amp; loss</button><button data-tab="cash">Cash flow</button><button data-tab="expenses">Expenses (${ex.expenses.length})</button><button data-tab="export">Export</button></div>
    <div id="a-body"></div>`;

  const body = $('#a-body');
  if (tab === 'pl') {
    body.innerHTML = `<div class="card" style="max-width:720px">
      <div class="card-head"><h2>Profit &amp; loss statement</h2><span class="muted">${fmtDate(from)} – ${fmtDate(to)}</span></div>
      <table class="statement"><tbody>
        ${line('Gross sales', pl.gross_sales)}
        ${line('Less: discounts', -pl.discounts, 'indent')}
        ${pl.returns ? line(`Less: returns (${pl.returns_count})`, -pl.returns, 'indent') : ''}
        ${line('Net sales (revenue)', pl.net_sales, 'subtotal')}
        ${line('Less: cost of goods sold', -pl.cogs, 'indent')}
        <tr class="subtotal"><td>Gross profit <span class="muted" style="font-weight:400">(${pct(pl.gross_margin)})</span></td><td class="num">${money(pl.gross_profit)}</td></tr>
        ${pl.inventory_adjustments ? line('Less: stock losses / adjustments', -pl.inventory_adjustments, 'indent') : ''}
        ${pl.returns_written_off ? line('Less: damaged returns written off', -pl.returns_written_off, 'indent') : ''}
        <tr><td colspan="2" style="padding-top:14px;font-weight:600">Operating expenses</td></tr>
        ${pl.expenses.length ? pl.expenses.map((e) => line(esc(e.category), -e.amount, 'indent')).join('') : '<tr class="indent"><td>None recorded</td><td></td></tr>'}
        ${line('Total expenses', -pl.total_expenses, 'subtotal')}
        <tr class="total"><td>Net profit</td><td class="num">${signed(pl.net_profit)}</td></tr>
      </tbody></table>
      ${pl.tax_collected ? `<div class="card-pad muted" style="font-size:13px;border-top:1px solid var(--border)">Sales tax collected (owed to tax authority, not included above): <strong>${money(pl.tax_collected)}</strong></div>` : ''}
    </div>`;
  } else if (tab === 'cash') {
    const c = pl.cash;
    body.innerHTML = `<div class="grid half">
      <div class="card"><div class="card-head"><h2>Cash in &amp; out</h2></div>
        <table class="statement"><tbody>
          ${line('Money received from sales (cash, card, mobile)', c.sales_collected)}
          ${c.refunds_paid ? line('Refunds paid out for returns', -c.refunds_paid, 'indent') : ''}
          ${line('Payments from credit customers', c.customer_payments)}
          ${line('Stock paid for on delivery', -c.inventory_purchases, 'indent')}
          ${line('Payments to suppliers', -c.supplier_payments, 'indent')}
          ${line('Paid for expenses', -c.expenses_paid, 'indent')}
          <tr class="total"><td>Net cash flow</td><td class="num">${signed(c.net)}</td></tr>
        </tbody></table>
        <div class="card-pad muted" style="font-size:12.5px;border-top:1px solid var(--border)">Stock purchases are cash spent but not an expense: they become cost of goods only when the items sell. Stock received on credit counts as cash only when you pay the supplier.
          Credit sales count as revenue when made but as cash only when the customer pays.</div>
      </div>
      <div class="card"><div class="card-head"><h2>Customer credit</h2><a href="#/customers">Customers</a></div>
        <table class="statement"><tbody>
          ${line('Sold on credit in this period', c.credit_sales)}
          ${c.returns_to_accounts ? line('Returns taken off customer accounts', -c.returns_to_accounts) : ''}
          ${line('Collected from customers in this period', c.customer_payments)}
          <tr class="total"><td>Owed to you now <span class="muted" style="font-weight:400">(${pl.receivables.customers} customer${pl.receivables.customers === 1 ? '' : 's'})</span></td><td class="num">${money(pl.receivables.total)}</td></tr>
        </tbody></table>
      </div>
      <div class="card"><div class="card-head"><h2>Supplier credit</h2><a href="#/suppliers">Suppliers</a></div>
        <table class="statement"><tbody>
          ${line('Stock received on credit in this period', c.credit_purchases)}
          ${line('Paid to suppliers in this period', c.supplier_payments)}
          <tr class="total"><td>You owe suppliers now <span class="muted" style="font-weight:400">(${pl.payables.suppliers} supplier${pl.payables.suppliers === 1 ? '' : 's'})</span></td><td class="num">${money(pl.payables.total)}</td></tr>
        </tbody></table>
      </div>
      <div class="card"><div class="card-head"><h2>Sales by payment method</h2></div>
        ${c.by_method.length ? `<table><thead><tr><th>Method</th><th class="num">Sales</th><th class="num">Amount</th></tr></thead><tbody>
          ${c.by_method.map((m) => `<tr><td style="text-transform:capitalize">${esc(m.method)}</td><td class="num">${m.count}</td><td class="num">${money(m.amount)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">No sales in this period</div>'}
      </div>
    </div>`;
  } else if (tab === 'expenses') {
    body.innerHTML = `<div class="card table-wrap">${ex.expenses.length ? `<table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Paid by</th><th class="num">Amount</th><th></th></tr></thead><tbody>
      ${ex.expenses.map((e) => `<tr class="${e.reversed_at ? 'void' : ''}"><td>${fmtDate(e.date)}</td><td class="keep"><span class="badge info">${esc(e.category)}</span>${e.reversed_at ? ` <span class="badge danger">reversed</span> <span class="muted">${esc(e.reverse_reason)}</span>` : ''}</td><td class="wrap">${esc(e.description)}</td><td style="text-transform:capitalize">${esc(e.payment_method)}</td>
        <td class="num">${money(e.amount_cents)}</td><td class="num keep">${e.reversed_at ? '' : `<button class="btn sm" data-rev="${e.id}" title="Reverse an expense recorded by mistake">Reverse</button>`}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No expenses recorded in this period</div>'}</div>`;
    $$('[data-rev]', body).forEach((b) => (b.onclick = () =>
      reverseWithReason('expense', 'It will no longer count in your expenses and profit.', `/api/expenses/${b.dataset.rev}/reverse`, () => pageAccounting(page, from, to, tab))));
  } else {
    const q = `from=${from}&to=${to}`;
    body.innerHTML = `<div class="card card-pad" style="max-width:720px">
      <p style="margin-top:0">Download spreadsheets (CSV, opens in Excel or Google Sheets) for ${fmtDate(from)} – ${fmtDate(to)}, for your records or your accountant.</p>
      <div class="toolbar">
        <a class="btn" href="/api/export/sales.csv?${q}">Sales</a>
        <a class="btn" href="/api/export/expenses.csv?${q}">Expenses</a>
        <a class="btn" href="/api/export/returns.csv?${q}">Returns</a>
        <a class="btn" href="/api/export/products.csv">Products &amp; stock value</a>
        <button class="btn" id="a-print">Print P&amp;L</button>
      </div></div>`;
    $('#a-print').onclick = () => pageAccounting(page, from, to, 'pl').then(() => window.print());
  }

  $$('.tabs button', page).forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.onclick = () => pageAccounting(page, from, to, b.dataset.tab);
  });
  bindDateRange(page, (f, t) => pageAccounting(page, f, t, tab));
  $('#a-add').onclick = () =>
    modal({
      title: 'Record expense',
      body: `
        <div class="row">
          <div class="field"><label>Date</label><input name="date" type="date" value="${localDate()}" required></div>
          <div class="field"><label>Amount</label><input name="amount" type="number" min="0.01" step="0.01" required></div>
        </div>
        <div class="row">
          <div class="field"><label>Category</label><select name="category">${ex.categories.map((c) => `<option>${c}</option>`).join('')}</select></div>
          <div class="field"><label>Paid by</label><select name="payment_method">${PAYMENT_OPTIONS}</select></div>
        </div>
        <div class="field"><label>Description</label><input name="description" placeholder="e.g. November electricity bill"></div>`,
      onSubmit: async (data) => {
        await api('POST', '/api/expenses', data);
        toast('Expense recorded');
        pageAccounting(page, from, to, tab === 'pl' || tab === 'export' ? tab : 'expenses');
      },
    });
}

// ---------- activity log (owner only) ----------

const AUDIT_LABEL = {
  'setup.owner_created': 'Owner account created',
  'login.success': 'Signed in',
  'login.failed': 'Failed sign-in',
  'user.password_changed': 'Changed own password',
  'user.signed_out_other_devices': 'Signed out other devices',
  'user.created': 'Added user',
  'user.updated': 'Changed user',
  'role.created': 'Created role',
  'role.updated': 'Changed role permissions',
  'role.deleted': 'Deleted role',
  'settings.updated': 'Changed settings',
  'product.created': 'Added product',
  'product.updated': 'Changed product',
  'products.imported': 'Imported products',
  'stock.received': 'Received stock',
  'stock.adjusted': 'Adjusted stock count',
  'stock.written_off': 'Wrote off expired stock',
  'shift.opened': 'Opened a shift',
  'shift.closed': 'Closed a shift (cash count)',
  'sale.discount': 'Sale with discount',
  'sale.voided': 'Voided sale',
  'sale.returned': 'Items returned',
  'customer.created': 'Added customer',
  'customer.updated': 'Changed customer',
  'customer_payment.recorded': 'Customer payment',
  'customer_payment.reversed': 'Reversed customer payment',
  'supplier.created': 'Added supplier',
  'supplier.updated': 'Changed supplier',
  'supplier_payment.recorded': 'Supplier payment',
  'supplier_payment.reversed': 'Reversed supplier payment',
  'expense.recorded': 'Recorded expense',
  'expense.reversed': 'Reversed expense',
  'login.2fa_failed': 'Wrong two-step code',
  '2fa.enabled': 'Two-step login switched on',
  '2fa.disabled': 'Two-step login switched off',
  '2fa.recovery_codes_replaced': 'New recovery codes',
  '2fa.reset_by_admin': 'Two-step login reset by admin',
  '2fa.reset_on_computer': 'Two-step login reset on shop PC',
  'branding.updated': 'Changed logo / icon',
  'branding.removed': 'Removed logo / icon',
  'backup.created': 'Backup made',
  'backup.downloaded': 'Downloaded a backup',
  'backup.uploaded': 'Uploaded a backup file',
  'backup.restored': 'Restored a backup',
};
const AUDIT_FILTERS = [
  ['', 'All activity'],
  ['login', 'Sign-ins'],
  ['2fa', 'Two-step login'],
  ['sale', 'Sales: discounts, voids & returns'],
  ['customer', 'Customers & their payments'],
  ['supplier', 'Suppliers & payments to them'],
  ['expense', 'Expenses'],
  ['product', 'Products & prices'],
  ['stock', 'Stock'],
  ['shift', 'Cash closing'],
  ['user', 'Users & passwords'],
  ['role', 'Roles & permissions'],
  ['settings', 'Settings'],
  ['branding', 'Logo & icon'],
  ['backup', 'Backups'],
];
const AUDIT_ALERT = /failed|reversed|voided|returned|password|user\.|role\.|settings|branding|restored|2fa/;

function auditDetails(json) {
  let d;
  try {
    d = JSON.parse(json || '{}');
  } catch {
    return esc(json);
  }
  const val = (k, v) => (v === null || v === undefined ? '—' : /_cents$/.test(k) && typeof v === 'number' ? money(v) : String(v));
  return Object.entries(d)
    .map(([k, v]) => {
      const label = k.replace(/_cents$/, '').replace(/_/g, ' ');
      if (v && typeof v === 'object' && 'from' in v) return `<strong>${esc(label)}</strong>: ${esc(val(k, v.from))} → ${esc(val(k, v.to))}`;
      return `<strong>${esc(label)}</strong>: ${esc(val(k, v))}`;
    })
    .join(' · ');
}

async function pageActivity(page, from = datePresets().week[0], to = localDate(), action = '') {
  const rows = await api('GET', `/api/audit?from=${from}&to=${to}&action=${encodeURIComponent(action)}`);
  page.innerHTML = `
    <div class="page-head"><h1>Activity log</h1>
      <div class="toolbar">${dateRangeControls(from, to)}
        <select id="act-filter" style="width:auto">${AUDIT_FILTERS.map(([v, l]) => `<option value="${v}" ${v === action ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
    </div>
    <p class="muted" style="margin-top:0">Every sign-in, payment, reversal, price change and settings or user change is recorded here and cannot be edited or deleted.</p>
    <div class="card table-wrap">${rows.length ? `<table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th><th>Device</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${fmtDateTime(r.created_at)}</td><td>${esc(r.username) || '<span class="muted">—</span>'}</td>
        <td class="keep"><span class="badge ${AUDIT_ALERT.test(r.action) ? 'warn' : ''}">${esc(AUDIT_LABEL[r.action] || r.action)}</span></td>
        <td class="wrap" style="font-size:13px">${auditDetails(r.details)}</td><td class="muted">${esc(r.ip)}</td></tr>`).join('')}
    </tbody></table>${rows.length >= 2000 ? '<div class="card-pad muted">Showing the latest 2,000 entries. Narrow the dates to see older ones.</div>' : ''}` : '<div class="empty">No activity in this period</div>'}</div>`;
  bindDateRange(page, (f, t) => pageActivity(page, f, t, action));
  $('#act-filter').onchange = (e) => pageActivity(page, from, to, e.target.value);
}

// ---------- settings ----------

// Shows recovery codes once, with print and copy.
function showRecoveryCodes(codes, onDone) {
  const html = `<div class="recovery-codes">${codes.map((c) => `<code>${esc(c)}</code>`).join('')}</div>`;
  modal({
    title: 'Save your recovery codes',
    body: `<p style="margin-top:0">If you lose your phone, each of these codes lets you sign in <strong>once</strong>.
      Print them or write them down and keep them somewhere safe, away from the phone. They will not be shown again.</p>${html}`,
    footer: '<button type="button" class="btn" data-copy>Copy</button><button type="button" class="btn" data-print>Print</button><button type="button" class="btn primary" data-close>I have saved them</button>',
  });
  $('#modal-root [data-copy]').onclick = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      toast('Recovery codes copied');
    } catch {
      toast('Could not copy. Please write them down.', 'error');
    }
  };
  $('#modal-root [data-print]').onclick = () =>
    printHtml(`<div class="receipt"><div class="c"><strong>${esc(state.settings.shop_name)}</strong></div>
      <div class="c">Recovery codes for ${esc(state.user.username)}</div><hr>${codes.map((c) => `<div class="c">${esc(c)}</div>`).join('')}<hr>
      <div class="c">Each code works once.</div></div>`);
  const observer = new MutationObserver(() => {
    if (!$('#modal-root .modal')) {
      observer.disconnect();
      onDone?.();
    }
  });
  observer.observe($('#modal-root'), { childList: true });
}

function setUpTwoStep(onDone) {
  modal({
    title: 'Set up two-step login',
    submitLabel: 'Continue',
    body: `<p style="margin-top:0">After your password, you will also enter a 6-digit code from an authenticator app on your phone
      (for example Google Authenticator or Microsoft Authenticator). Install one first if you don't have it.</p>
      <div class="field"><label>Your password</label><input name="password" type="password" autocomplete="current-password" required></div>`,
    onSubmit: async (data) => {
      const setup = await api('POST', '/api/2fa/setup', { password: data.password });
      setTimeout(() => confirmTwoStep(setup, onDone), 0);
    },
  });
}

function confirmTwoStep(setup, onDone) {
  modal({
    title: 'Scan with your authenticator app',
    submitLabel: 'Switch on',
    wide: true,
    body: `<div class="twostep-setup">
        <div class="qr-box">${setup.qr_svg}</div>
        <div>
          <ol style="margin-top:0;padding-left:18px">
            <li>In the app, add an account and scan this code.</li>
            <li>Can't scan? Choose "enter a setup key" and type:<div class="setup-key">${esc(setup.secret)}</div>
              <span class="muted" style="font-size:12px">Time-based, 6 digits.</span></li>
            <li>Enter the 6-digit code the app now shows:</li>
          </ol>
          <div class="field"><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required></div>
        </div>
      </div>`,
    onSubmit: async (data) => {
      const r = await api('POST', '/api/2fa/enable', { code: data.code });
      toast('Two-step login is on');
      setTimeout(() => showRecoveryCodes(r.recovery_codes, onDone), 0);
    },
  });
}

// Shrinks a picture to fit w×h (never enlarges) and returns it as PNG. square: centred on a
// transparent square, for the browser icon. Re-drawing also drops anything hidden in the file.
const ICON_SIZE = { w: 256, h: 256, square: true };

// Sends a logo / icon picture; returns the new { logo, icon } status.
async function uploadBranding(kind, png) {
  const res = await portalFetch(`/api/branding/${kind}`, { method: 'PUT', headers: { ...PORTAL_HEADER, 'Content-Type': 'application/octet-stream' }, body: png });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data;
}

// The part of a picture that isn't transparent, plus a 2% margin. Only see-through edges are cut:
// a logo on a white or coloured background keeps it.
function artworkBounds(ctx, width, height) {
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: width, h: height }; // nothing visible: keep as is
  const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.02);
  const x = Math.max(0, minX - pad), y = Math.max(0, minY - pad);
  return { x, y, w: Math.min(width, maxX + pad + 1) - x, h: Math.min(height, maxY + pad + 1) - y };
}

async function resizeImage(file, { w, h, square = false }) {
  if (!/^image\//.test(file.type)) throw new Error('Choose a picture (PNG, JPEG, WebP, SVG or GIF)');
  if (file.size > 10 * 1024 * 1024) throw new Error('The picture is too large (max 10 MB)');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => { throw new Error('This picture could not be opened'); });
    // Draw it once at up to 2000 px, then cut off empty transparent margins around the artwork
    // (logos are often exported with lots of empty space, which would make them look tiny).
    const fw = img.naturalWidth || w, fh = img.naturalHeight || h;
    const pre = Math.min(1, 2000 / fw, 2000 / fh);
    const src = document.createElement('canvas');
    src.width = Math.max(1, Math.round(fw * pre));
    src.height = Math.max(1, Math.round(fh * pre));
    const sctx = src.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(img, 0, 0, src.width, src.height);
    const { x: sx, y: sy, w: iw, h: ih } = artworkBounds(sctx, src.width, src.height);

    const scale = Math.min(1, w / iw, h / ih);
    const dw = Math.max(1, Math.round(iw * scale)), dh = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas');
    canvas.width = square ? Math.max(dw, dh) : dw;
    canvas.height = square ? Math.max(dw, dh) : dh;
    canvas.getContext('2d').drawImage(src, sx, sy, iw, ih, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('This picture could not be converted');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const ACCENT_PRESETS = [
  ['', 'Teal (default)', DEFAULT_PRIMARY], ['#2563eb', 'Blue'], ['#4f46e5', 'Indigo'], ['#7c3aed', 'Purple'], ['#db2777', 'Pink'],
  ['#dc2626', 'Red'], ['#ea580c', 'Orange'], ['#ca8a04', 'Gold'], ['#65a30d', 'Lime green'], ['#16a34a', 'Green'], ['#475569', 'Slate'],
];
const MENU_PRESETS = [
  ['', 'Charcoal (default)', '#0f1a19'], ['#0f172a', 'Midnight'], ['#1f2937', 'Graphite'], ['#172554', 'Navy'], ['#14532d', 'Forest'],
  ['#3b0764', 'Plum'], ['#450a0a', 'Maroon'], ['#f8fafc', 'Light'], ['#ffffff', 'White'],
];

function appearanceCard() {
  const row = (name, label, presets, help) => `
    <div class="field" data-colour="${name}">
      <label>${label}</label>
      <div class="swatches">
        ${presets.map(([value, title, show]) => `<button type="button" class="swatch" data-value="${value}" title="${esc(title)}" aria-label="${esc(title)}" style="--c:${show || value}"></button>`).join('')}
        <span class="swatch-custom" title="Any colour"><input type="color" aria-label="${label}: any colour"> <span data-code></span></span>
      </div>
      <div class="muted" style="font-size:12px">${help}</div>
    </div>`;
  return `<div class="card" id="s-appearance">
      <div class="card-head"><h2>Appearance</h2></div>
      <div class="card-pad">
        <div class="appearance-preview" aria-hidden="true">
          <div class="pv-side"><i class="on"></i><i></i><i></i><i></i></div>
          <div class="pv-main"><b></b><span>Button</span></div>
        </div>
        ${row('primary', 'Accent colour', ACCENT_PRESETS, 'Buttons, links, the selected page and highlights.')}
        ${row('sidebar', 'Menu colour', MENU_PRESETS, 'The menu on the left and the sign-in page. Text switches to dark on light colours.')}
        <div class="muted" style="font-size:12px;margin:-2px 0 12px">Colours apply to everyone, in light and dark mode. Shades are adjusted so text stays readable.</div>
        <div class="toolbar"><button type="button" class="btn primary" id="ap-save" disabled>Save colours</button>
          <button type="button" class="btn" id="ap-reset">Use default colours</button></div>
      </div>
    </div>`;
}

// Clicking a colour previews it on the whole page at once; Save keeps it for everyone.
function bindAppearance() {
  const saved = { primary: '', sidebar: '', ...(state.branding?.colors || {}) };
  const draft = { ...saved };
  const card = $('#s-appearance');
  const draw = () => {
    for (const box of $$('[data-colour]', card)) {
      const name = box.dataset.colour;
      const value = draft[name];
      const preset = $$('.swatch', box).find((b) => b.dataset.value === value);
      $$('.swatch', box).forEach((b) => b.classList.toggle('active', b === preset));
      $('input[type=color]', box).value = value || $$('.swatch', box)[0].style.getPropertyValue('--c').trim();
      $('[data-code]', box).textContent = preset ? '' : value;
    }
    $('#ap-save').disabled = draft.primary === saved.primary && draft.sidebar === saved.sidebar;
    $('#ap-reset').disabled = !draft.primary && !draft.sidebar;
    applyColours(draft);
  };
  for (const box of $$('[data-colour]', card)) {
    const name = box.dataset.colour;
    $$('.swatch', box).forEach((b) => (b.onclick = () => {
      draft[name] = b.dataset.value;
      draw();
    }));
    $('input[type=color]', box).oninput = (e) => {
      draft[name] = e.target.value.toLowerCase();
      draw();
    };
  }
  $('#ap-reset').onclick = () => {
    draft.primary = '';
    draft.sidebar = '';
    draw();
  };
  $('#ap-save').onclick = async () => {
    try {
      const settings = await api('PUT', '/api/settings', { primary_color: draft.primary, sidebar_color: draft.sidebar });
      // A portal server started before this feature existed ignores the colours: say so instead of failing quietly.
      if (settings.primary_color !== draft.primary || settings.sidebar_color !== draft.sidebar) {
        throw new Error('The colours were not saved. The portal server is running older code: restart it (Ctrl+C, then npm start) and try again.');
      }
      state.settings = settings;
      await loadBranding();
      toast('Colours saved for everyone');
      renderShell();
      router();
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  draw();
}

// ---------- Settings → Backups (admins; restoring is the owner's) ----------

const fileSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const BACKUP_KIND = { auto: ['info', 'Automatic'], manual: ['', 'Manual'], 'before-restore': ['warn', 'Before restore'], uploaded: ['', 'Uploaded'] };

async function drawBackups(showAll = false) {
  const box = $('#s-backups .card-pad');
  if (!box) return;
  let s;
  try {
    s = await api('GET', '/api/backups');
  } catch (err) {
    box.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
    return;
  }
  const last = s.last_auto;
  const rows = showAll ? s.backups : s.backups.slice(0, 6);
  box.innerHTML = `
    <div class="backup-status ${s.auto_error ? 'bad' : last ? 'ok' : 'warn'}">
      ${s.auto_error
        ? `<strong>The last automatic backup failed.</strong> ${esc(s.auto_error.message)}`
        : last
        ? `<strong>Automatic backup every day.</strong> Last one: ${fmtDateTime(last.created_at)} (${fileSize(last.size)}).`
        : '<strong>No automatic backup yet.</strong> One is made within a minute of the portal starting, then every day.'}
    </div>
    <div class="toolbar" style="margin:12px 0">
      <button type="button" class="btn primary sm" id="bk-now">Back up now</button>
      ${state.user.is_owner ? '<label class="btn sm">Upload a backup file<input type="file" id="bk-upload" accept=".gz,application/gzip" hidden></label>' : ''}
    </div>
    ${s.backups.length ? `<div class="table-wrap" style="border:1px solid var(--border);border-radius:8px"><table class="backup-list"><thead><tr><th>Made</th><th>Type</th><th class="num">Size</th><th></th></tr></thead><tbody>
      ${rows.map((b) => `<tr><td>${fmtDateTime(b.created_at)}</td><td><span class="badge ${BACKUP_KIND[b.kind][0]}">${BACKUP_KIND[b.kind][1]}</span></td><td class="num">${fileSize(b.size)}</td>
        <td class="num keep">${state.user.is_owner ? `<a class="btn sm" href="/api/backups/${encodeURIComponent(b.name)}/download" title="Save a copy (e.g. to a USB stick)">Download</a>` : ''}
        ${state.user.is_owner ? `<button type="button" class="btn sm danger" data-restore="${esc(b.name)}">Restore</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    ${s.backups.length > rows.length ? `<button type="button" class="btn sm" id="bk-all" style="margin-top:8px">Show all ${s.backups.length}</button>` : ''}` : ''}
    <p class="muted" style="font-size:12px;margin:12px 0 0">Kept: the last ${s.keep.auto} daily backups and ${s.keep.other} others, in <code>${esc(s.folder)}</code>.
      <strong>Also download one regularly to a USB stick or cloud drive</strong>: copies on this computer don't help if the computer is lost or broken.
      ${state.user.is_owner ? '' : 'Only the owner can download, upload or restore backups (they contain every password hash).'}</p>`;

  $('#bk-now').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const b = await api('POST', '/api/backups');
      toast(`Backup saved (${fileSize(b.size)})`);
    } catch (err) {
      toast(err.message, 'error');
    }
    drawBackups(showAll);
  };
  if ($('#bk-upload')) $('#bk-upload').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const res = await portalFetch('/api/backups/upload', { method: 'POST', headers: { ...PORTAL_HEADER, 'Content-Type': 'application/octet-stream' }, body: file });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      toast('Backup file added. Use Restore on it to put it back.');
    } catch (err) {
      toast(err.message, 'error');
    }
    drawBackups(showAll);
  };
  if ($('#bk-all')) $('#bk-all').onclick = () => drawBackups(true);
  $$('[data-restore]', box).forEach((b) => (b.onclick = () => restoreBackup(s.backups.find((x) => x.name === b.dataset.restore))));
}

function restoreBackup(b) {
  modal({
    title: 'Restore this backup?',
    submitLabel: 'Restore',
    body: `<p style="margin-top:0">All shop data will be replaced with the backup from <strong>${fmtDateTime(b.created_at)}</strong>:
        sales, stock, customers, payments, users, settings and the activity log. Anything entered after that time is removed.</p>
      <p>A backup of the data as it is now is saved first, so this can be undone by restoring that one.
        Everyone may need to sign in again.</p>
      <div class="field"><label>Type RESTORE to confirm</label><input name="confirm" autocomplete="off" placeholder="RESTORE" required></div>`,
    onSubmit: async (data) => {
      if (data.confirm.trim() !== 'RESTORE') throw new Error('Type RESTORE (in capitals) to confirm');
      const r = await api('POST', `/api/backups/${encodeURIComponent(b.name)}/restore`, { confirm: 'RESTORE' });
      toast(`Restored. The data from before was saved as a backup.`);
      setTimeout(boot, 600); // the restored data may have other users, settings or sign-ins
      return r;
    },
  });
  const btn = $('#modal-root button[type=submit]');
  btn.classList.remove('primary');
  btn.classList.add('danger');
}

async function pageSettings(page) {
  const twoStep = await api('GET', '/api/2fa');
  page.innerHTML = `
    <div class="page-head" data-no-export><h1>Settings</h1></div>
    <div class="settings-cols ${can('settings.manage') ? '' : 'single'}">
      ${can('settings.manage') ? `<section class="settings-col" aria-label="Shop">
        <div class="col-title">Shop</div>` : ''}
      ${can('settings.manage') ? `<form class="card" id="s-shop" novalidate>
        <div class="card-head"><h2>Shop</h2></div>
        <div class="card-pad">
          <div class="field"><label>Shop name</label><input name="shop_name" value="${esc(state.settings.shop_name)}"></div>
          <div class="row">
            <div class="field"><label>Currency code</label><input name="currency" value="${esc(state.settings.currency)}" maxlength="3" placeholder="USD, KES, EUR…"></div>
            <div class="field"><label>Sales tax / VAT %</label><input name="tax_rate" type="number" min="0" max="100" step="0.01" value="${esc(state.settings.tax_rate)}"></div>
          </div>
          <div class="field"><input type="hidden" name="require_shift" value="0">
            <label class="inline" style="color:var(--text);font-weight:500"><input type="checkbox" name="require_shift" value="1" ${state.settings.require_shift !== '0' ? 'checked' : ''} style="width:auto;min-height:0"> Require an open cash shift to sell</label>
            <div class="muted" style="font-size:12px;margin-top:4px">Everyone opens a shift (counting the float) before selling, so every sale is in a cash count.</div></div>
          <div class="field"><label>Warn about expiry dates (days before)</label><input name="expiry_warning_days" type="number" min="1" max="365" step="1" value="${esc(state.settings.expiry_warning_days ?? '30')}"></div>
          <div class="field"><label>Maximum discount staff may give (%)</label><input name="max_staff_discount" type="number" min="0" max="100" step="0.5" value="${esc(state.settings.max_staff_discount ?? '10')}">
            <div class="muted" style="font-size:12px;margin-top:4px">Bigger discounts are refused unless the user's role allows unlimited discounts. Admins have no limit. Set 0 to stop staff giving discounts.</div></div>
          <button class="btn primary" type="submit">Save</button>
        </div>
      </form>` : ''}
      ${can('settings.manage') ? `<div class="card" id="s-brand">
        <div class="card-head"><h2>Logo &amp; icon</h2></div>
        <div class="card-pad">${['logo', 'icon'].map((kind) => `
          <div class="brand-row" data-kind="${kind}">
            <div class="brand-preview ${kind}">${brandUrl(kind) ? `<img src="${brandUrl(kind)}" alt="">`
              : kind === 'icon' && brandUrl('logo') ? `<img src="${brandUrl('logo')}" alt="" title="Using the logo">` : '<span class="muted">None</span>'}</div>
            <div>
              <strong>${kind === 'logo' ? 'Logo' : 'Browser icon'}</strong>
              <div class="muted" style="font-size:12px;margin:2px 0 8px">${kind === 'logo'
                ? 'Shown on the sign-in page, at the top of the menu, and on receipts and statements.'
                : brandUrl('icon') ? 'Shown in the browser tab and bookmarks.'
                : brandUrl('logo') ? 'Shown in the browser tab and bookmarks. For now the tab shows your logo; save it as the icon, or upload a different square picture.'
                : 'Shown in the browser tab and bookmarks. Uploading a logo sets it as the icon too; you can change it here.'}</div>
              <div class="toolbar">
                ${kind === 'icon' && !brandUrl('icon') && brandUrl('logo') ? '<button type="button" class="btn sm primary" data-use-logo>Use logo</button>' : ''}
                <label class="btn sm">${brandUrl(kind) ? 'Change' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" hidden></label>
                ${brandUrl(kind) ? '<button type="button" class="btn sm danger" data-remove>Remove</button>' : ''}
              </div>
            </div>
          </div>`).join('')}
          <div class="muted" style="font-size:12px">PNG, JPEG, WebP, SVG or GIF. Pictures are resized automatically.</div>
        </div>
      </div>` : ''}
      ${can('settings.manage') ? appearanceCard() : ''}
      ${isAdmin() ? '<div class="card" id="s-backups"><div class="card-head"><h2>Backups</h2></div><div class="card-pad"><div class="loading"><span class="spinner"></span> Loading…</div></div></div>' : ''}
      ${can('settings.manage') ? '</section>' : ''}
      <section class="settings-col" aria-label="Your account">
        <div class="col-title">Your account</div>
      <div class="card">
        <div class="card-head"><h2>Two-step login</h2><span class="badge ${twoStep.enabled ? 'ok' : 'warn'}">${twoStep.enabled ? 'On' : 'Off'}</span></div>
        <div class="card-pad">
          ${twoStep.enabled
            ? `<p style="margin-top:0">Signing in needs your password <strong>and</strong> a code from your authenticator app.
                You have <strong>${twoStep.recovery_codes_left}</strong> unused recovery code${twoStep.recovery_codes_left === 1 ? '' : 's'}.</p>
               <div class="toolbar"><button class="btn" id="ts-new-codes">New recovery codes</button><button class="btn danger" id="ts-off">Switch off</button></div>`
            : `<p style="margin-top:0">Protect this account with a code from your phone, so a stolen or guessed password is not enough to sign in.
                ${isAdmin() ? '<strong>Recommended for the owner account.</strong>' : ''}</p>
               <button class="btn primary" id="ts-on">Set up two-step login</button>`}
        </div>
      </div>
      <form class="card" id="s-pass" novalidate>
        <div class="card-head"><h2>Change your password</h2></div>
        <div class="card-pad">
          <div class="field"><label>Current password</label><input name="current" type="password" autocomplete="current-password"></div>
          <div class="field"><label>New password (min. 8 characters)</label><input name="password" type="password" autocomplete="new-password"></div>
          <div class="toolbar"><button class="btn primary" type="submit">Update password</button>
            <button class="btn" type="button" id="s-signout-others">Sign out other devices</button></div>
          <div class="muted" style="font-size:12px;margin-top:8px">Changing your password also signs you out everywhere else.</div>
        </div>
      </form>
      </section>
    </div>`;

  const bindForm = (id, fn) => {
    const f = $(id);
    if (f) f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await fn(formData(f), f);
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  };
  bindForm('#s-shop', async (data) => {
    state.settings = await api('PUT', '/api/settings', data);
    toast('Settings saved');
    renderShell();
    router();
  });
  $$('#s-brand .brand-row').forEach((row) => {
    const kind = row.dataset.kind;
    const done = async (branding, msg) => {
      state.branding = branding;
      applyFavicon();
      toast(msg);
      renderShell();
      router();
    };
    $('input[type=file]', row).onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        if (kind === 'icon') return await done(await uploadBranding('icon', await resizeImage(file, ICON_SIZE)), 'Icon updated');
        let status = await uploadBranding('logo', await resizeImage(file, { w: 800, h: 300 }));
        // No separate icon yet: the logo becomes the browser icon too (as a square picture).
        const alsoIcon = !status.icon;
        if (alsoIcon) status = await uploadBranding('icon', await resizeImage(file, ICON_SIZE));
        await done(status, alsoIcon ? 'Logo updated, and used as the browser icon' : 'Logo updated');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const useLogo = $('[data-use-logo]', row);
    if (useLogo) useLogo.onclick = async () => {
      try {
        const res = await portalFetch(brandUrl('logo'));
        if (!res.ok) throw new Error('Could not read the logo');
        const blob = await res.blob();
        await done(await uploadBranding('icon', await resizeImage(new File([blob], 'logo.png', { type: blob.type || 'image/png' }), ICON_SIZE)), 'The logo is now the browser icon');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
    const rm = $('[data-remove]', row);
    if (rm) rm.onclick = async () => {
      if (!confirm(`Remove the ${kind === 'logo' ? 'logo' : 'browser icon'}?`)) return;
      try {
        await done(await api('DELETE', `/api/branding/${kind}`), kind === 'logo' ? 'Logo removed' : 'Icon removed');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  });
  if ($('#s-appearance')) bindAppearance();
  if ($('#s-backups')) drawBackups();
  bindForm('#s-pass', async (data, f) => {
    const r = await api('POST', '/api/password', data);
    f.reset();
    toast(r.signed_out ? `Password updated. ${r.signed_out} other device(s) signed out.` : 'Password updated');
  });
  $('#s-signout-others').onclick = async () => {
    const r = await api('POST', '/api/sessions/revoke-others');
    toast(r.signed_out ? `Signed out ${r.signed_out} other device(s)` : 'No other devices were signed in');
  };
  const reload = () => pageSettings(page);
  if ($('#ts-on')) $('#ts-on').onclick = () => setUpTwoStep(reload);
  if ($('#ts-new-codes'))
    $('#ts-new-codes').onclick = () =>
      modal({
        title: 'New recovery codes',
        submitLabel: 'Create new codes',
        body: '<p style="margin-top:0">Your old recovery codes will stop working.</p><div class="field"><label>Your password</label><input name="password" type="password" autocomplete="current-password" required></div>',
        onSubmit: async (data) => {
          const r = await api('POST', '/api/2fa/recovery-codes', { password: data.password });
          setTimeout(() => showRecoveryCodes(r.recovery_codes, reload), 0);
        },
      });
  if ($('#ts-off'))
    $('#ts-off').onclick = () =>
      modal({
        title: 'Switch off two-step login',
        submitLabel: 'Switch off',
        body: `<p style="margin-top:0">Signing in will only need your password again.</p>
          <div class="field"><label>Your password</label><input name="password" type="password" autocomplete="current-password" required></div>
          <div class="field"><label>Code from the app (or a recovery code)</label><input name="code" autocomplete="one-time-code" required></div>`,
        onSubmit: async (data) => {
          await api('POST', '/api/2fa/disable', data);
          toast('Two-step login is off');
          reload();
        },
      });

}

// ---------- users & roles (admins) ----------

async function pageUsers(page) {
  const [users, roleData] = await Promise.all([api('GET', '/api/users'), api('GET', '/api/roles')]);
  page.innerHTML = `
    <div class="page-head"><h1>Users &amp; roles</h1></div>
    <div class="grid" style="align-items:start">
      <div class="card">
        <div class="card-head"><h2>Staff accounts</h2><button class="btn sm primary" id="s-add-user">Add user</button></div>
        <div class="table-wrap"><table><thead><tr><th>Username</th><th>Name</th><th>Role</th><th>Status</th><th>Two-step</th><th></th></tr></thead><tbody>
          ${users.map((u) => `<tr><td><strong>${esc(u.username)}</strong></td><td>${esc(u.name)}</td><td><span class="badge perm-chip ${u.role === 'admin' ? 'info' : ''}">${u.is_owner ? 'Owner' : esc(u.role_name || u.role)}</span></td>
            <td><span class="badge ${u.active ? 'ok' : 'danger'}">${u.active ? 'active' : 'disabled'}</span></td>
            <td>${u.two_step ? '<span class="badge ok">on</span>' : '<span class="muted">off</span>'}</td>
            <td class="num">${u.id === state.user.id ? '<span class="muted">You</span>' : state.user.is_owner || (u.role === 'staff' && !u.is_owner) ? `<button class="btn sm" data-user="${u.id}">Manage</button>` : '<span class="muted" title="Only the owner can change admins">Owner only</span>'}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="card-pad muted" style="font-size:12.5px;border-top:1px solid var(--border)">Each user's <strong>role</strong> decides what they can see and do — set them up under <strong>Roles &amp; permissions</strong> below. <strong>The owner</strong> is the only one who can add or change admins, and nobody else can change the owner account. <strong>Admins</strong> can do everything, including managing users and roles.</div>
      </div>
      <div class="card" id="roles">
        <div class="card-head"><h2>Roles &amp; permissions</h2><button class="btn sm primary" id="s-add-role">New role</button></div>
        <div class="table-wrap"><table><thead><tr><th>Role</th><th>Allowed to</th><th class="num">Users</th><th></th></tr></thead><tbody>
          <tr><td><strong>Admin</strong></td><td class="wrap muted">Everything, including users and roles</td><td class="num">${users.filter((u) => u.role === 'admin').length}</td><td class="num"><span class="muted">Fixed</span></td></tr>
          ${roleData.roles.map((r) => `<tr><td><strong>${esc(r.name)}</strong>${r.builtin ? ' <span class="badge">built-in</span>' : ''}</td>
            <td class="wrap">${r.permissions.length ? r.permissions.map((k) => `<span class="badge perm-chip">${esc(roleData.permissions.find((p) => p.key === k)?.label || k)}</span>`).join(' ') : '<span class="muted">Nothing yet</span>'}</td>
            <td class="num">${r.users}</td><td class="num"><button class="btn sm" data-role="${r.id}">Edit</button></td></tr>`).join('')}
        </tbody></table></div>
        <div class="card-pad muted" style="font-size:12.5px;border-top:1px solid var(--border)">Changes apply straight away, even to users who are signed in. Every change is recorded in the Activity log.</div>
      </div>
    </div>`;
  const roleOptions = (selected) =>
    roleData.roles.map((r) => `<option value="${r.id}" ${String(r.id) === selected ? 'selected' : ''}>${esc(r.name)}</option>`).join('') +
    (state.user.is_owner || selected === 'admin' ? `<option value="admin" ${selected === 'admin' ? 'selected' : ''}>Admin (everything)</option>` : '');
  const roleBody = (v) => (v === 'admin' ? { role: 'admin' } : { role: 'staff', role_id: Number(v) });
  const editRole = (r) => {
    const groups = [...new Set(roleData.permissions.map((p) => p.group))];
    const has = new Set(r ? r.permissions : []);
    const { form, close } = modal({
      title: r ? `Edit role: ${r.name}` : 'New role',
      submitLabel: r ? 'Save role' : 'Create role',
      body: `
        <div class="field"><label>Role name</label><input name="name" value="${esc(r?.name || '')}" maxlength="40" ${r?.builtin ? 'disabled' : 'required'} placeholder="e.g. Supply chain, Accountant"></div>
        ${groups.map((g) => `<fieldset class="perm-group"><legend>${esc(g)}</legend>
          ${roleData.permissions.filter((p) => p.group === g).map((p) => `<label class="perm"><input type="checkbox" data-perm="${p.key}" ${has.has(p.key) ? 'checked' : ''}> <span>${esc(p.label)}</span></label>`).join('')}
        </fieldset>`).join('')}
        ${r && !r.builtin ? `<div class="toolbar" style="margin-top:8px"><button type="button" class="btn sm danger" id="role-del">Delete role</button>${r.users ? `<span class="muted" style="font-size:12px">${r.users} user(s) have this role</span>` : ''}</div>` : ''}`,
      onSubmit: async (data) => {
        const permissions = $$('[data-perm]', form).filter((c) => c.checked).map((c) => c.dataset.perm);
        const body = { permissions, ...(r?.builtin ? {} : { name: data.name }) };
        await api(r ? 'PUT' : 'POST', r ? `/api/roles/${r.id}` : '/api/roles', body);
        toast(r ? 'Role saved' : 'Role created');
        pageUsers(page);
      },
    });
    const del = $('#role-del');
    if (del)
      del.onclick = async () => {
        if (!(await confirmBox(`Delete the role "${r.name}"?`, 'Users must be moved to another role first.', 'Delete'))) return;
        try {
          await api('DELETE', `/api/roles/${r.id}`);
          toast('Role deleted');
          if (close) close();
          pageUsers(page);
        } catch (err) {
          toast(err.message, 'error');
        }
      };
  };
  $('#s-add-role').onclick = () => editRole(null);
  $$('[data-role]', page).forEach((b) => (b.onclick = () => editRole(roleData.roles.find((x) => x.id === Number(b.dataset.role)))));
  $('#s-add-user').onclick = () =>
    modal({
      title: 'Add user',
      body: `
        <div class="row"><div class="field"><label>Username</label><input name="username" required></div><div class="field"><label>Full name</label><input name="name"></div></div>
        <div class="row"><div class="field"><label>Password (min. 8)</label><input name="password" type="password" autocomplete="new-password" required></div>
        <div class="field"><label>Role</label><select name="role">${roleOptions()}</select></div></div>`,
      onSubmit: async (data) => {
        await api('POST', '/api/users', { ...data, ...roleBody(data.role) });
        toast('User added');
        pageUsers(page);
      },
    });
  $$('[data-user]', page).forEach((b) => (b.onclick = () => {
    const u = users.find((x) => x.id === Number(b.dataset.user));
    modal({
      title: `Manage ${u.username}`,
      body: `
        <div class="field"><label>Role</label><select name="role">${roleOptions(u.role === 'admin' ? 'admin' : String(u.role_id ?? ''))}</select></div>
        <div class="field"><label>Status</label><select name="active"><option value="1" ${u.active ? 'selected' : ''}>Active</option><option value="0" ${u.active ? '' : 'selected'}>Disabled (cannot sign in)</option></select></div>
        <div class="field"><label>Reset password (leave blank to keep)</label><input name="password" type="password" autocomplete="new-password"></div>
        ${u.two_step ? `<div class="field"><label>Two-step login</label><div class="toolbar"><span class="badge ok">on</span>
          <button type="button" class="btn sm danger" id="u-reset-2fa">Reset (lost phone)</button></div>
          <div class="muted" style="font-size:12px;margin-top:4px">Switches it off so they can sign in with just their password and set it up again.</div></div>` : ''}`,
      onSubmit: async (data) => {
        await api('PUT', `/api/users/${u.id}`, { ...roleBody(data.role), active: data.active === '1', password: data.password || undefined });
        toast('User updated');
        pageUsers(page);
      },
    });
    const resetBtn = $('#u-reset-2fa');
    if (resetBtn)
      resetBtn.onclick = async () => {
        if (!(await confirmBox(`Reset two-step login for ${u.username}?`, 'Only do this if they lost their phone and their recovery codes. They will be signed out everywhere.', 'Reset'))) return;
        try {
          await api('POST', `/api/users/${u.id}/reset-2fa`);
          toast(`Two-step login reset for ${u.username}`);
        } catch (err) {
          toast(err.message, 'error');
        }
        pageUsers(page);
      };
  }));
}

boot();
