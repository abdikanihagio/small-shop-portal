// Waxool admin portal: client shops, monthly invoices, payments and portal licences.
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const state = { admin: null, settings: {}, methods: [], today: '' };

async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'waxool-admin', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the admin portal. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.admin) {
    state.admin = null;
    boot();
  }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function money(cents, currency = 'USD') {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((cents || 0) / 100);
  } catch {
    return `${currency} ${((cents || 0) / 100).toFixed(2)}`;
  }
}
const moneyList = (rows) => (rows.length ? rows.map((r) => money(r.cents, r.currency)).join(' + ') : money(0));
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never');
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = `toast${bad ? ' bad' : ''}`;
  t.textContent = msg;
  $('#toast-root').append(t);
  setTimeout(() => t.remove(), 3500);
}

// A modal with a form. onSubmit(data, form) may throw; its message is shown in the modal.
function modal(title, inner, { submit = 'Save', onSubmit, wide = false, danger = false } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-back"><form class="modal" ${wide ? 'style="max-width:760px"' : ''} novalidate>
      <div class="card-head"><h2>${esc(title)}</h2><button type="button" class="btn sm" data-close>✕</button></div>
      <div class="card-pad"><div class="error-msg" hidden></div>${inner}</div>
      ${onSubmit ? `<div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${esc(submit)}</button></div>` : ''}
    </form></div>`;
  const form = $('form', root);
  const close = () => (root.innerHTML = '');
  $$('[data-close]', root).forEach((b) => (b.onclick = close));
  // (A handler that returns false cancels the click, so this must not return the && result.)
  $('.modal-back', root).onclick = (e) => {
    if (e.target === e.currentTarget) close();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      const keepOpen = await onSubmit(formData(form), form);
      if (!keepOpen) close();
    } catch (err) {
      const box = $('.error-msg', form);
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  };
  $('input, select, textarea', form)?.focus();
  return form;
}

const field = (label, input, hint = '') => `<div class="field"><label>${esc(label)}</label>${input}${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;

function portalBadge(p) {
  if (p.state === 'ok') return '<span class="badge ok">Paid up</span>';
  if (p.state === 'warn') return `<span class="badge warn">Payment due</span>`;
  const label = { suspended: 'Suspended', cancelled: 'Cancelled', overdue: 'Locked · overdue' }[p.reason] || 'Locked';
  return `<span class="badge bad">${label}</span>`;
}
const invoiceBadge = (i) =>
  i.status === 'paid' ? '<span class="badge ok">Paid</span>'
  : i.status === 'void' ? '<span class="badge">Void</span>'
  : i.due_on < state.today ? '<span class="badge bad">Overdue</span>'
  : '<span class="badge warn">Open</span>';

const ICONS = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  shops: '<path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>',
  invoices: '<path d="M6 2h9l5 5v15H6zM14 2v6h6M9 13h6M9 17h6"/>',
  payments: '<path d="M2 6h20v12H2zM2 10h20M6 15h4"/>',
  activity: '<path d="M3 12h4l3 8 4-16 3 8h4"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ''}</svg>`;
const MARK = '<span class="brand-mark"><svg viewBox="0 0 32 32" width="22" height="22"><path d="M5 9l4 14 7-12 7 12 4-14" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';

const PAGES = {
  dashboard: { title: 'Dashboard', render: pageDashboard },
  shops: { title: 'Shops', render: pageShops },
  invoices: { title: 'Invoices', render: pageInvoices },
  payments: { title: 'Payments', render: pagePayments },
  activity: { title: 'Activity', render: pageActivity },
  settings: { title: 'Settings', render: pageSettings },
};

// ---------- sign-in ----------
async function renderAuth() {
  let setup = { needsSetup: false };
  try {
    setup = await api('GET', '/api/setup');
  } catch {}
  const first = setup.needsSetup;
  const allowed = setup.local || setup.tokenSetup;
  $('#app').innerHTML = `
    <div class="auth"><form class="card" novalidate>
      ${MARK}
      <h1>${first ? 'Create the admin account' : 'Waxool Admin'}</h1>
      <div class="sub">${first ? 'First-time setup' : 'Sign in to manage shops and billing'}</div>
      <div class="error-msg" hidden></div>
      ${first && !allowed ? '<div class="note">For safety, the first admin can only be created on the computer running the admin portal (open it at http://localhost), or with a setup token set on the server.</div>' : `
        ${first ? field('Your name', '<input name="name" autocomplete="name">') : ''}
        ${field('Username', '<input name="username" autocomplete="username" required>')}
        ${field('Password', `<input name="password" type="password" autocomplete="${first ? 'new-password' : 'current-password'}" required>`, first ? 'At least 10 characters' : '')}
        ${first && !setup.local ? field('Setup token', '<input name="setup_token" type="password" autocomplete="off" required>', 'The SETUP_TOKEN value set on the server') : ''}
        <button class="btn primary" style="width:100%;justify-content:center" type="submit">${first ? 'Create account' : 'Sign in'}</button>`}
    </form></div>`;
  const form = $('.auth form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('POST', first ? '/api/setup' : '/api/login', formData(form));
      boot();
    } catch (err) {
      const box = $('.error-msg', form);
      box.textContent = err.message;
      box.hidden = false;
    }
  };
}

// ---------- shell + router ----------
function renderShell() {
  $('#app').innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">${MARK}<span>${esc(state.settings.business_name || 'Waxool')} Admin</span></div>
        <nav class="nav">${Object.entries(PAGES).map(([k, p]) => `<a href="#/${k}" data-route="${k}">${icon(k)}<span>${p.title}</span></a>`).join('')}</nav>
      </aside>
      <div class="content">
        <header class="topbar">
          <button class="btn sm menu-btn" id="menu-btn">☰</button>
          <strong id="crumb"></strong>
          <div class="who"><span class="muted">${esc(state.admin.name || state.admin.username)}</span><button class="btn sm" id="logout">Sign out</button></div>
        </header>
        <main class="main" id="page"></main>
      </div>
    </div>`;
  $('#logout').onclick = async () => {
    await api('POST', '/api/logout');
    state.admin = null;
    location.hash = '';
    boot();
  };
  $('#menu-btn').onclick = () => $('.shell').classList.toggle('nav-open');
  $$('.nav a').forEach((a) => (a.onclick = () => $('.shell').classList.remove('nav-open')));
}

async function router() {
  if (!state.admin) return;
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/');
  const key = PAGES[name] ? name : 'dashboard';
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === key));
  $('#crumb').textContent = PAGES[key].title;
  document.title = `${PAGES[key].title} · Waxool Admin`;
  const page = $('#page');
  page.innerHTML = '<div class="loading">Loading…</div>';
  try {
    await (key === 'shops' && arg ? pageShop(page, Number(arg)) : PAGES[key].render(page));
  } catch (err) {
    page.innerHTML = `<div class="error-msg">${esc(err.message)}</div>`;
  }
}
const reload = () => router();
window.addEventListener('hashchange', router);

async function boot() {
  try {
    const me = await api('GET', '/api/me');
    Object.assign(state, { admin: me.admin, settings: me.settings, methods: me.methods, today: me.today });
  } catch {
    return renderAuth();
  }
  renderShell();
  router();
}

// ---------- dashboard ----------
async function pageDashboard(page) {
  const d = await api('GET', '/api/dashboard');
  page.innerHTML = `
    <div class="page-head"><h1>Dashboard</h1><a class="btn primary" href="#/shops" id="add-shop">+ Add shop</a></div>
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Monthly income</div><div class="value">${moneyList(d.monthly)}</div><div class="muted">${d.active} active shop${d.active === 1 ? '' : 's'}</div></div>
      <div class="card kpi"><div class="label">Received this month</div><div class="value">${moneyList(d.paid_this_month)}</div></div>
      <div class="card kpi"><div class="label">Outstanding</div><div class="value">${moneyList(d.outstanding)}</div></div>
      <div class="card kpi"><div class="label">Payment due / locked</div><div class="value">${d.warn} / ${d.locked}</div><div class="muted">of ${d.shops} shop${d.shops === 1 ? '' : 's'}</div></div>
    </div>
    <div class="grid two">
      <div class="card table-wrap"><div class="card-head"><h2>Needs attention</h2></div>
        ${d.needs_attention.length ? `<table><thead><tr><th>Shop</th><th>Status</th><th class="num">Owed</th></tr></thead><tbody>
          ${d.needs_attention.map((s) => `<tr class="clickable" data-shop="${s.id}"><td><strong>${esc(s.name)}</strong><div class="muted">${s.portal.lock_on && s.portal.state === 'warn' ? `Locks on ${fmtDate(s.portal.lock_on)}` : ''}</div></td><td>${portalBadge(s.portal)}</td><td class="num">${money(s.balance_cents, s.currency)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="empty">Every shop is paid up.</div>'}
      </div>
      <div class="card table-wrap"><div class="card-head"><h2>Recent payments</h2><a href="#/payments">All</a></div>
        ${d.recent_payments.length ? `<table><tbody>${d.recent_payments.map((p) => `<tr><td><strong>${esc(p.shop_name)}</strong><div class="muted">${fmtDate(p.paid_on)} · ${esc(p.method)}</div></td><td class="num">${p.reversed_at ? `<s>${money(p.amount_cents, p.currency)}</s>` : money(p.amount_cents, p.currency)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No payments yet.</div>'}
      </div>
    </div>`;
  $('#add-shop').onclick = (e) => {
    e.preventDefault();
    shopForm();
  };
  $$('[data-shop]', page).forEach((tr) => (tr.onclick = () => (location.hash = `#/shops/${tr.dataset.shop}`)));
}

// ---------- shops ----------
async function pageShops(page) {
  const shops = await api('GET', '/api/shops');
  page.innerHTML = `
    <div class="page-head"><h1>Shops</h1><button class="btn primary" id="add-shop">+ Add shop</button></div>
    <div class="card table-wrap">
      ${shops.length ? `<table><thead><tr><th>Shop</th><th>Portal</th><th class="num">Monthly fee</th><th>Billing day</th><th>Status</th><th class="num">Owed</th><th>Last check-in</th></tr></thead><tbody>
        ${shops.map((s) => `<tr class="clickable" data-shop="${s.id}">
          <td><strong>${esc(s.name)}</strong><div class="muted">${esc(s.contact_name)}${s.phone ? ` · ${esc(s.phone)}` : ''}</div></td>
          <td>${s.portal_url ? esc(s.portal_url.replace(/^https?:\/\//, '')) : '<span class="muted">—</span>'}</td>
          <td class="num">${money(s.monthly_fee_cents, s.currency)}</td><td>${s.billing_day}</td>
          <td>${portalBadge(s.portal)}</td><td class="num">${money(s.balance_cents, s.currency)}</td>
          <td class="muted">${fmtTime(s.last_seen_at)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">No shops yet. Add your first client shop.</div>'}
    </div>`;
  $('#add-shop').onclick = () => shopForm();
  $$('[data-shop]', page).forEach((tr) => (tr.onclick = () => (location.hash = `#/shops/${tr.dataset.shop}`)));
}

function shopForm(shop) {
  const s = shop || { currency: 'USD', billing_day: 1, grace_days: 7, started_on: state.today };
  modal(shop ? 'Edit shop' : 'Add shop', `
    <div class="form-grid">
      ${field('Shop name', `<input name="name" value="${esc(s.name)}" required>`)}
      ${field('Portal address', `<input name="portal_url" value="${esc(s.portal_url)}" placeholder="https://my.waxool.com">`)}
      ${field('Contact person', `<input name="contact_name" value="${esc(s.contact_name)}">`)}
      ${field('Phone', `<input name="phone" value="${esc(s.phone)}">`)}
      ${field('Email', `<input name="email" type="email" value="${esc(s.email)}">`)}
      ${field('Start date', `<input name="started_on" type="date" value="${esc(s.started_on)}">`, 'No invoice is made for months before this')}
      ${field('Monthly fee', `<input name="monthly_fee" type="number" min="0.01" step="0.01" value="${s.monthly_fee_cents ? (s.monthly_fee_cents / 100).toFixed(2) : ''}" required>`)}
      ${field('Currency', `<input name="currency" value="${esc(s.currency)}" maxlength="3">`)}
      ${field('Billing day of the month', `<input name="billing_day" type="number" min="1" max="28" value="${s.billing_day}">`, 'The invoice is issued and due on this day')}
      ${field('Grace days', `<input name="grace_days" type="number" min="0" max="60" value="${s.grace_days}">`, 'Days after the due date before the portal becomes read-only')}
    </div>
    ${field('Notes', `<textarea name="notes" rows="2">${esc(s.notes)}</textarea>`)}`, {
    submit: shop ? 'Save' : 'Add shop',
    wide: true,
    onSubmit: async (data) => {
      if (shop) {
        await api('PUT', `/api/shops/${shop.id}`, data);
        toast('Shop saved');
        reload();
      } else {
        const r = await api('POST', '/api/shops', data);
        showKey(r.licence_key, data.name, () => (location.hash = `#/shops/${r.id}`));
        return true; // showKey replaces the modal
      }
    },
  });
}

function showKey(key, name, after) {
  modal(`Licence key for ${name}`, `
    <p>Put these two settings on the shop portal (Railway → the shop's service → <strong>Variables</strong>), then redeploy it:</p>
    ${field('BILLING_URL', `<div class="key-box">${esc(location.origin)}</div>`)}
    ${field('BILLING_KEY', `<div class="key-box">${esc(key)}</div>`)}
    <div class="note">Copy the key now: for safety it is <strong>shown only once</strong>. If it is lost, replace it from the shop's page.</div>`);
  const close = $$('#modal-root [data-close]');
  close.forEach((b) => b.addEventListener('click', () => after && after()));
}

async function pageShop(page, id) {
  const { shop: s, invoices, payments, activity } = await api('GET', `/api/shops/${id}`);
  const p = s.portal;
  page.innerHTML = `
    <div class="page-head"><div><a href="#/shops">← Shops</a><h1>${esc(s.name)} ${portalBadge(p)}</h1></div>
      <div class="toolbar">
        <button class="btn" id="edit">Edit</button>
        <button class="btn" id="new-invoice">New invoice</button>
        <button class="btn" id="new-key">Replace licence key</button>
        ${s.status === 'active' ? '<button class="btn danger" id="suspend">Suspend</button>' : '<button class="btn primary" id="activate">Activate</button>'}
      </div></div>
    ${p.state !== 'ok' ? `<div class="note" style="margin-bottom:18px"><strong>What the shop sees:</strong> ${esc(p.message)}</div>` : ''}
    <div class="grid two" style="margin-bottom:18px">
      <div class="card"><div class="card-head"><h2>Details</h2></div><div class="card-pad"><dl class="facts">
        <dt>Portal</dt><dd>${s.portal_url ? `<a href="${esc(s.portal_url)}" target="_blank" rel="noopener">${esc(s.portal_url)}</a>` : '—'}</dd>
        <dt>Contact</dt><dd>${esc(s.contact_name) || '—'}${s.phone ? ` · ${esc(s.phone)}` : ''}${s.email ? `<br>${esc(s.email)}` : ''}</dd>
        <dt>Monthly fee</dt><dd>${money(s.monthly_fee_cents, s.currency)}, billed on day ${s.billing_day}</dd>
        <dt>Grace period</dt><dd>${s.grace_days} day${s.grace_days === 1 ? '' : 's'} after the due date</dd>
        <dt>Customer since</dt><dd>${fmtDate(s.started_on)}</dd>
        <dt>Status</dt><dd>${esc(s.status)}</dd>
        <dt>Licence key</dt><dd>…${esc(s.key_hint)}</dd>
        <dt>Last check-in</dt><dd>${fmtTime(s.last_seen_at)}</dd>
        ${s.notes ? `<dt>Notes</dt><dd>${esc(s.notes)}</dd>` : ''}
      </dl></div></div>
      <div class="card"><div class="card-head"><h2>Balance</h2></div><div class="card-pad">
        <div class="kpi" style="padding:0"><div class="label">Owed now</div><div class="value">${money(s.balance_cents, s.currency)}</div>
        ${p.lock_on && p.state === 'warn' ? `<div class="muted">The portal becomes read-only on ${fmtDate(p.lock_on)} if unpaid.</div>` : ''}</div>
      </div></div>
    </div>
    <div class="stack">
      <div class="card table-wrap"><div class="card-head"><h2>Invoices</h2></div>${invoiceTable(invoices, false)}</div>
      <div class="card table-wrap"><div class="card-head"><h2>Payments</h2></div>${paymentTable(payments, false)}</div>
      <div class="card table-wrap"><div class="card-head"><h2>History</h2></div>
        ${activity.length ? `<table><tbody>${activity.map((a) => `<tr><td class="muted" style="width:170px">${fmtTime(a.at)}</td><td>${esc(a.action)}</td><td>${esc(a.details)}</td><td class="muted">${esc(a.who)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nothing yet.</div>'}
      </div>
    </div>`;
  $('#edit').onclick = () => shopForm(s);
  $('#new-invoice').onclick = () => invoiceForm(s);
  $('#new-key').onclick = () =>
    modal('Replace licence key', `<p>The old key stops working at once. The shop portal keeps its last known status until you put the new key in its settings.</p>`, {
      submit: 'Replace key',
      danger: true,
      onSubmit: async () => {
        const r = await api('POST', `/api/shops/${s.id}/key`);
        showKey(r.licence_key, s.name, reload);
        return true;
      },
    });
  const setStatus = (status, text) =>
    modal(status === 'active' ? 'Activate shop' : 'Suspend shop', `<p>${text}</p>`, {
      submit: status === 'active' ? 'Activate' : 'Suspend',
      danger: status !== 'active',
      onSubmit: async () => {
        await api('POST', `/api/shops/${s.id}/status`, { status });
        toast(status === 'active' ? 'Shop activated' : 'Shop suspended');
        reload();
      },
    });
  $('#suspend') && ($('#suspend').onclick = () => setStatus('suspended', 'The shop portal becomes read-only within about 15 minutes, until you activate it again. Its data is kept. No invoices are issued while suspended.'));
  $('#activate') && ($('#activate').onclick = () => setStatus('active', 'The shop portal works normally again (within about 15 minutes) and monthly invoices resume.'));
  bindInvoiceActions(page, invoices);
  bindPaymentActions(page);
}

// ---------- invoices ----------
function invoiceTable(invoices, withShop) {
  if (!invoices.length) return '<div class="empty">No invoices.</div>';
  return `<table><thead><tr><th>Invoice</th>${withShop ? '<th>Shop</th>' : ''}<th>Description</th><th>Issued</th><th>Due</th><th class="num">Amount</th><th class="num">Paid</th><th>Status</th><th></th></tr></thead><tbody>
    ${invoices.map((i) => `<tr>
      <td><strong>${esc(i.number)}</strong></td>${withShop ? `<td><a href="#/shops/${i.shop_id}">${esc(i.shop_name)}</a></td>` : ''}
      <td>${esc(i.description)}${i.void_reason ? `<div class="muted">Void: ${esc(i.void_reason)}</div>` : ''}</td>
      <td>${fmtDate(i.issued_on)}</td><td>${fmtDate(i.due_on)}</td>
      <td class="num">${money(i.amount_cents, i.currency)}</td><td class="num">${money(i.paid_cents, i.currency)}</td>
      <td>${invoiceBadge(i)}</td>
      <td><div class="toolbar" style="justify-content:flex-end">
        ${i.status === 'open' ? `<button class="btn sm primary" data-pay="${i.id}">Record payment</button><button class="btn sm" data-due="${i.id}">Due date</button>` : ''}
        ${i.status !== 'void' && !i.paid_cents ? `<button class="btn sm danger" data-void="${i.id}">Void</button>` : ''}
        <button class="btn sm" data-print="${i.id}">Print</button>
      </div></td></tr>`).join('')}
  </tbody></table>`;
}

function bindInvoiceActions(page, invoices) {
  const find = (id) => invoices.find((i) => i.id === Number(id));
  $$('[data-pay]', page).forEach((b) => (b.onclick = () => paymentForm(find(b.dataset.pay))));
  $$('[data-due]', page).forEach((b) => (b.onclick = () => {
    const i = find(b.dataset.due);
    modal(`Due date · ${i.number}`, field('New due date', `<input name="due_on" type="date" value="${esc(i.due_on)}" min="${esc(i.issued_on)}" required>`, 'Give the shop more time; the portal locks after the grace days from this date.'), {
      onSubmit: async (d) => {
        await api('POST', `/api/invoices/${i.id}/due`, d);
        toast('Due date changed');
        reload();
      },
    });
  }));
  $$('[data-void]', page).forEach((b) => (b.onclick = () => {
    const i = find(b.dataset.void);
    modal(`Void ${i.number}`, field('Reason', '<input name="reason" required>', 'The invoice stays in the list, marked void, and no longer counts as owed.'), {
      submit: 'Void invoice',
      danger: true,
      onSubmit: async (d) => {
        await api('POST', `/api/invoices/${i.id}/void`, d);
        toast('Invoice voided');
        reload();
      },
    });
  }));
  $$('[data-print]', page).forEach((b) => (b.onclick = () => printInvoice(Number(b.dataset.print))));
}

function invoiceForm(shop) {
  modal(`New invoice · ${shop.name}`, `
    ${field('Description', '<input name="description" required placeholder="e.g. Setup and training">')}
    <div class="form-grid">
      ${field(`Amount (${shop.currency})`, '<input name="amount" type="number" min="0.01" step="0.01" required>')}
      ${field('Issue date', `<input name="issued_on" type="date" value="${state.today}">`)}
      ${field('Due date', `<input name="due_on" type="date" value="${state.today}">`)}
    </div>
    <p class="muted">Monthly fees are invoiced automatically on the billing day; use this for anything extra.</p>`, {
    submit: 'Create invoice',
    onSubmit: async (d) => {
      await api('POST', `/api/shops/${shop.id}/invoices`, d);
      toast('Invoice created');
      reload();
    },
  });
}

function paymentForm(i) {
  modal(`Record payment · ${i.number}`, `
    <p><strong>${esc(i.shop_name)}</strong> owes <strong>${money(i.balance_cents, i.currency)}</strong> on this invoice.</p>
    <div class="form-grid">
      ${field(`Amount (${i.currency})`, `<input name="amount" type="number" min="0.01" step="0.01" value="${(i.balance_cents / 100).toFixed(2)}" required>`)}
      ${field('Paid on', `<input name="paid_on" type="date" value="${state.today}" max="${state.today}">`)}
      ${field('Method', `<select name="method">${state.methods.map((m) => `<option>${esc(m)}</option>`).join('')}</select>`)}
      ${field('Reference', '<input name="reference" placeholder="Transaction ID">')}
    </div>
    ${field('Note', '<input name="note">')}`, {
    submit: 'Record payment',
    onSubmit: async (d) => {
      const r = await api('POST', `/api/invoices/${i.id}/payments`, d);
      toast(r.status === 'paid' ? 'Paid in full — the shop portal unlocks within about 15 minutes' : 'Part payment recorded');
      reload();
    },
  });
}

async function printInvoice(id) {
  const i = await api('GET', `/api/invoices/${id}`);
  const shops = await api('GET', `/api/shops/${i.shop_id}`);
  const s = shops.shop;
  modal(`Invoice ${i.number}`, `
    <div class="printable">
      <div style="display:flex;justify-content:space-between;gap:16px;margin-bottom:18px">
        <div><h1>${esc(state.settings.business_name)}</h1><div class="muted">Invoice</div></div>
        <div style="text-align:right"><strong>${esc(i.number)}</strong><div>Issued ${fmtDate(i.issued_on)}</div><div>Due ${fmtDate(i.due_on)}</div></div>
      </div>
      <p><strong>Bill to:</strong> ${esc(s.name)}${s.contact_name ? `, ${esc(s.contact_name)}` : ''}${s.phone ? `<br>${esc(s.phone)}` : ''}${s.email ? `<br>${esc(s.email)}` : ''}</p>
      <table><thead><tr><th>Description</th><th class="num">Amount</th></tr></thead><tbody>
        <tr><td>${esc(i.description)}</td><td class="num">${money(i.amount_cents, i.currency)}</td></tr>
        ${i.payments.filter((p) => !p.reversed_at).map((p) => `<tr><td class="muted">Paid ${fmtDate(p.paid_on)} · ${esc(p.method)}${p.reference ? ` · ${esc(p.reference)}` : ''}</td><td class="num">−${money(p.amount_cents, i.currency)}</td></tr>`).join('')}
        <tr><td><strong>${i.status === 'void' ? 'Void' : 'Balance due'}</strong></td><td class="num"><strong>${money(i.balance_cents, i.currency)}</strong></td></tr>
      </tbody></table>
      ${state.settings.payment_instructions ? `<p style="margin-top:16px"><strong>How to pay:</strong> ${esc(state.settings.payment_instructions)}</p>` : ''}
    </div>`, {
    submit: 'Print',
    onSubmit: () => {
      document.body.classList.add('printing');
      window.print();
      document.body.classList.remove('printing');
      return true;
    },
  });
}

async function pageInvoices(page, status = new URLSearchParams(location.hash.split('?')[1] || '').get('status') || 'open') {
  const invoices = await api('GET', `/api/invoices?status=${encodeURIComponent(status)}`);
  page.innerHTML = `
    <div class="page-head"><h1>Invoices</h1><div class="toolbar">
      <select id="status">${[['open', 'Open'], ['paid', 'Paid'], ['void', 'Void'], ['all', 'All']].map(([k, l]) => `<option value="${k}" ${k === status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn" id="generate">Issue due monthly invoices</button></div></div>
    <div class="card table-wrap">${invoiceTable(invoices, true)}</div>`;
  $('#status').onchange = (e) => pageInvoices(page, e.target.value);
  $('#generate').onclick = async () => {
    const r = await api('POST', '/api/invoices/generate');
    toast(r.created ? `Issued ${r.created} invoice(s)` : 'Nothing due: every monthly invoice is already issued');
    pageInvoices(page, status);
  };
  bindInvoiceActions(page, invoices);
}

// ---------- payments ----------
function paymentTable(payments, withShop) {
  if (!payments.length) return '<div class="empty">No payments.</div>';
  return `<table><thead><tr><th>Date</th>${withShop ? '<th>Shop</th>' : ''}<th>Invoice</th><th>Method</th><th>Reference</th><th class="num">Amount</th><th>Recorded by</th><th></th></tr></thead><tbody>
    ${payments.map((p) => `<tr>
      <td>${fmtDate(p.paid_on)}</td>${withShop ? `<td><a href="#/shops/${p.shop_id}">${esc(p.shop_name)}</a></td>` : ''}
      <td>${esc(p.invoice_number)}</td><td>${esc(p.method)}</td><td>${esc(p.reference) || '<span class="muted">—</span>'}${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}</td>
      <td class="num">${p.reversed_at ? `<s>${money(p.amount_cents, p.currency)}</s><div class="muted">Reversed: ${esc(p.reversed_reason)}</div>` : money(p.amount_cents, p.currency)}</td>
      <td class="muted">${esc(p.created_by)}</td>
      <td>${p.reversed_at ? '' : `<button class="btn sm danger" data-reverse="${p.id}">Reverse</button>`}</td></tr>`).join('')}
  </tbody></table>`;
}

function bindPaymentActions(page) {
  $$('[data-reverse]', page).forEach((b) => (b.onclick = () =>
    modal('Reverse payment', field('Reason', '<input name="reason" required placeholder="e.g. entered twice, transfer bounced">', 'The payment stays in the list, crossed out, and the invoice is owed again.'), {
      submit: 'Reverse payment',
      danger: true,
      onSubmit: async (d) => {
        await api('POST', `/api/payments/${b.dataset.reverse}/reverse`, d);
        toast('Payment reversed');
        reload();
      },
    })));
}

async function pagePayments(page) {
  const payments = await api('GET', '/api/payments');
  page.innerHTML = `<div class="page-head"><h1>Payments</h1></div><div class="card table-wrap">${paymentTable(payments, true)}</div>`;
  bindPaymentActions(page);
}

// ---------- activity + settings ----------
async function pageActivity(page) {
  const rows = await api('GET', '/api/activity');
  page.innerHTML = `<div class="page-head"><h1>Activity</h1></div><div class="card table-wrap">
    ${rows.length ? `<table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Shop</th><th>Details</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td class="muted">${fmtTime(a.at)}</td><td>${esc(a.who)}</td><td>${esc(a.action)}</td><td>${esc(a.shop_name) || ''}</td><td>${esc(a.details)}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Nothing yet.</div>'}</div>`;
}

async function pageSettings(page) {
  const s = await api('GET', '/api/settings');
  page.innerHTML = `
    <div class="page-head"><h1>Settings</h1></div>
    <div class="grid two">
      <form class="card" id="biz" novalidate><div class="card-head"><h2>Business</h2></div><div class="card-pad">
        <div class="error-msg" hidden></div>
        ${field('Business name', `<input name="business_name" value="${esc(s.business_name)}" required>`, 'Shown on invoices and in messages to shops')}
        ${field('How to pay', `<textarea name="payment_instructions" rows="3" placeholder="e.g. EVC Plus 61xxxxxxx (Waxool). Send the transaction ID to …">${esc(s.payment_instructions)}</textarea>`, 'Shown to shops in their payment reminder and on invoices')}
        <button class="btn primary" type="submit">Save</button></div></form>
      <form class="card" id="pw" novalidate><div class="card-head"><h2>Your password</h2></div><div class="card-pad">
        <div class="error-msg" hidden></div>
        ${field('Current password', '<input name="current" type="password" autocomplete="current-password" required>')}
        ${field('New password', '<input name="password" type="password" autocomplete="new-password" required>', 'At least 10 characters. Other signed-in browsers are signed out.')}
        <button class="btn primary" type="submit">Change password</button></div></form>
    </div>`;
  const handle = (form, fn) => (form.onsubmit = async (e) => {
    e.preventDefault();
    const box = $('.error-msg', form);
    box.hidden = true;
    try {
      await fn(formData(form));
    } catch (err) {
      box.textContent = err.message;
      box.hidden = false;
    }
  });
  handle($('#biz'), async (d) => {
    state.settings = await api('PUT', '/api/settings', d);
    toast('Settings saved');
    renderShell();
    router();
  });
  handle($('#pw'), async (d) => {
    await api('POST', '/api/password', d);
    toast('Password changed');
    $('#pw').reset();
  });
}

boot();
