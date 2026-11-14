# Security Remediation Report — Small Shop Portal

| | |
|---|---|
| **Date** | 2026-11-12 |
| **Approved scope** | Round 1: Priority 1 and 2 from `SECURITY_AUDIT_REPORT.md` (H1, H2, H3, M1–M5, I11). Round 2: Priority 3 (L1, L2, L4, L5, L6, L7, L8). |
| **Also fixed** | L3 (malformed cookie/URL crash), in round 1. |
| **Round 3** | Two-step login (authenticator app) for any account, recommended for the owner (§2a). |
| **Open** | Turning on HTTPS, which needs the owner to run one script (§5). |
| **Verification** | Automated suite `npm test`: **29 tests, all passing**, nothing skipped. Plus re-testing in a browser and in Microsoft Excel, on throwaway copies. Real shop data was only touched by the automatic database upgrades at restart (§5). |

## 1. Summary

| ID | Finding | Status | Proof |
|---|---|---|---|
| H1 | No brute-force protection; blocking hash | **Fixed** | 3 tests |
| H2 | Unencrypted HTTP; listens everywhere | **Fixed (opt-in)**: HTTPS when a certificate exists; `HOST` setting | HTTPS test with a real certificate |
| H3 | Unlimited staff discounts | **Fixed** | test + browser |
| M1 | First-run setup claimable from the network | **Fixed** | test over the PC's real LAN address |
| M2 | Sessions survive password change/reset | **Fixed** | test |
| M3 | Staff can read costs and customer PII via API | **Fixed** | test + browser |
| M4 | CSV formula injection | **Fixed** | test + Microsoft Excel check |
| M5 | No audit trail; hard deletes | **Fixed**: append-only log, Activity page, reversals | 3 tests + browser |
| I11 | Missing security headers | **Fixed** | test + header check on the live portal |
| L3 | Malformed cookie/URL → 500 | **Fixed** | test |
| L1 | Username enumeration by login timing | **Fixed** | timing test |
| L2 | CSRF relied only on SameSite | **Fixed**: portal header + Origin + content-type checks | test + browser |
| L4 | No upper bounds on amounts/quantities | **Fixed** | test |
| L5 | `limit` parameter not validated | **Fixed** | test |
| L6 | Plain-text session tokens; no idle timeout | **Fixed**: SHA-256 hashes, 12 h idle timeout; existing sign-ins converted, not lost | 2 tests |
| L7 | Weak password policy | **Fixed** (common/obvious passwords refused). TOTP not added; see §4 | test + browser |
| L8 | Regex built from uploaded file content | **Fixed** | test with hostile file + real Excel fixtures |
| L7+ | No second factor for the owner | **Added**: two-step login with an authenticator app and recovery codes | 4 tests + browser |

## 2a. Round 3 — Two-step login

**How it works**
- **Who:** any account can switch it on under **Settings → Two-step login**. The page recommends it for the owner.
- **Signing in:** after the correct password, the server gives no session yet, only a sign-in ticket valid for 5 minutes. A session is created only after a correct **6-digit code** from an authenticator app. Standard TOTP is used (RFC 6238: 30-second codes, SHA-1, 6 digits), so Google Authenticator, Microsoft Authenticator, Authy and similar apps all work.
- **Setup:** you confirm your password, then scan a QR code (or type the setup key shown next to it), then enter a code from the app. It only switches on after a correct code. Switching it on signs the account out on all other devices.
- **Recovery codes:** 8 single-use codes are shown once at setup, with Print and Copy. Only hashes are stored. Using one shows how many are left. You can create a new set, which cancels the old one, with your password.
- **Switching off:** needs the password **and** a code from the app or a recovery code.

**Protections**
- A code can't be used twice: the last used time step is stored, and re-use is refused.
- Clocks may differ by ±30 seconds.
- 5 wrong codes end that sign-in attempt. Wrong codes also count towards the existing per-account and per-device throttling.

**If the phone is lost**
1. Use a recovery code.
2. An admin can **reset** another user's two-step login (Settings → Manage). This also signs that user out everywhere.
3. Last resort, for example the only owner lost both phone and codes: run `node scripts\reset-2fa.js <username>` **on the shop computer**. That needs physical access to the PC and its data folder, which already means full access, so it adds no new risk.

All resets are recorded in the Activity log, as are switching on, switching off, new recovery codes, wrong codes and sign-ins (noting whether the app or a recovery code was used). The Activity log has a "Two-step login" filter.

**Built without new dependencies**
- `lib/totp.js`: one-time codes. Checked against all published RFC 6238 Appendix B and RFC 4226 Appendix D test values.
- `lib/qr.js`: a QR code generator (versions 1–6, error correction M/L, all 8 masks). Its error correction and format bits are checked against published reference values.
- `test/qr-decode.mjs`: an **independent QR decoder written from the standard**. The tests encode 285 texts, including 150 real setup links, and every one decodes back exactly, covering all 8 mask patterns.

**Limitation:** this PC has no QR-reading software, so the QR code was not scanned with a real phone here. Setup can't finish without a correct code from the app, so a scan problem can't lock anyone out; and the setup key is always shown for typing in instead.

**Database:** new `users` columns: `totp_secret`, `totp_pending`, `totp_enabled`, `totp_last_step`, `recovery_codes`. The app's secret must be stored readable in order to check codes, as with every TOTP system. Recovery codes are hashed.

**Found and fixed during round 3 testing**
- My first QR test decoder joined multi-block data in the wrong order and reported failures. Every block's error correction checked out, which pointed to the decoder rather than the encoder. I fixed the decoder, and all codes pass.
- One test check was hollow: it signed in to the wrong test server, so it would pass regardless. I fixed it, and it genuinely passes.
- The browser walkthrough found that the **Set up two-step login** button did nothing for **staff** accounts. The Settings page stopped wiring buttons early for non-admins. I moved the handlers above that point and re-tested at phone size.

## 2. Changes by finding

### H1 — Login brute force and blocking hash
- `server.js`: `hashPassword`/`verifyPassword` now use async `crypto.scrypt` on Node's worker threads, so logins no longer freeze other requests.
- **Throttling:**
  - **5** failures for the same username, or **20** from the same device, block further attempts.
  - The block lasts 30 s and doubles with each further failure, up to 15 min. The server answers `429` with `Retry-After`; during a block, even the correct password waits.
  - A successful login clears the counters. The "current password" check on `/api/password` is throttled the same way.
  - Why the per-device limit is higher: several cashiers may share one till tablet, so a few typos shouldn't lock everyone out.
- New passwords must be **8–256 characters** (`checkNewPassword`). Passwords over 256 characters are refused at login without being hashed.
- Existing password hashes are unchanged, so no one needs to reset their password.

### H2 — Transport security
- `server.js` serves **HTTPS** automatically when a certificate is present. It looks for `data\tls\portal.pfx` (+ `portal-pass.txt`), or `TLS_PFX`/`TLS_PASSPHRASE`, or `TLS_CERT`/`TLS_KEY`. With HTTPS the session cookie gets `Secure` and responses send `Strict-Transport-Security`.
- `HOST` environment variable: for example `HOST=127.0.0.1` makes the portal reachable from this PC only. The default is still the whole shop network, since tablets need it.
- New `scripts\create-https-cert.ps1` creates a certificate for `localhost`, the computer name and its network addresses. `-TrustOnThisPc` makes this PC trust it; `portal.cer` is exported for tablets and phones.
- The startup message reminds you when HTTPS is off.
- **Your action needed:** HTTPS is not switched on yet; run the script (see README). Until then, connections from other devices are still unencrypted.

### H3 — Staff discount limit
- New setting **Maximum discount staff may give (%)**, default **10%**, under Settings → Shop. `0` blocks staff discounts entirely.
- `POST /api/sales` rejects a staff sale whose discount, as a percentage or as money, is over the limit. The check uses whole cents (`discount × 100 > subtotal × limit`), so there's no rounding loophole. Admins are not limited.
- Till: staff see "Discount (max 10%)"; going over shows a warning and disables **Complete sale**.
- Every discounted sale is written to the Activity log (`sale.discount`).

### M1 — First-run setup
- `POST /api/setup` only works from the computer running the portal (`127.0.0.1`/`::1`), and re-checks after hashing so two simultaneous attempts can't both succeed.
- On another device, the setup screen explains that setup must be done on the portal PC.

### M2 — Session revocation
- **Changing your own password** signs out all your other sessions and keeps the current one.
- **Admin password reset** signs out all of that user's sessions.
- New **Sign out other devices** button (Settings) → `POST /api/sessions/revoke-others`.

### M3 — Staff data exposure
- For staff:
  - `GET /api/products`: no `cost_cents`.
  - `GET /api/sales` and `/api/sales/:id`: no `cogs_cents` or item `cost_cents`.
  - `GET /api/inventory/movements`: no `unit_cost_cents` or `supplier`.
  - `GET /api/customers`: only `id, name, phone` (masked as `•••• 5678`), `balance_cents, credit_limit_cents, active`, which is what the till's customer picker and credit check use. Inactive customers aren't listed for staff.
- Admin responses are unchanged.

### M4 — CSV formula injection
- `csv()` now prefixes any cell starting with `= + - @`, Tab or CR with `'`, so spreadsheets show it as text. Plain numbers such as `-5.00` are left alone, so negative balances still add up.
- `POST /api/sales` no longer accepts a free-text customer name from anyone. A sale names a registered customer or nobody. The till already worked this way.
- Note: in Excel the leading `'` is visible in those cells. That's expected and harmless.

### M5 — Audit trail and reversals
- **New `audit_log` table** (who, when, action, record, details, device IP). Database triggers block any update or delete, so the log is append-only.
- **Logged actions:**
  - Sign-ins, including failed ones, owner setup and password changes.
  - Sign-out of other devices; user created/changed (role, active, password reset).
  - Settings changed (old → new values); products added/changed (old → new price and cost); imports.
  - Stock received or adjusted; sale discounts and voids.
  - Customers and suppliers added/changed; payments recorded and reversed; expenses recorded and reversed.
- **Payments and expenses are no longer deletable.** `DELETE /api/customers/:id/payments/:pid`, `DELETE /api/suppliers/:id/payments/:pid` and `DELETE /api/expenses/:id` were removed. They were replaced by `POST …/reverse`, which needs a reason and can only happen once.
- Reversed entries stay on statements and lists, struck through, marked **reversed** with the reason, and stop counting in balances, P&L, cash flow and receivables/payables. The expenses CSV has a Status column.
- New owner-only **Activity log** page with a date range and filters (sign-ins, money, products, stock, users, settings). It has the usual PDF/Excel export.

### I11 — Security headers (all responses)
`Content-Security-Policy` (`default-src 'self'; script-src 'self'; … frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, plus HSTS when HTTPS is on. I checked the front end: it has no inline scripts, inline event handlers or external resources, so the policy blocks nothing the app needs.

### Round 2 — Priority 3

**L1 — Login timing.** When a username doesn't exist, the server now checks the password against a fixed dummy hash, so every failed login does the same work. Test: the median time for unknown usernames must be at least half that for real ones (in the audit, before the fix, it was 1 ms vs 64 ms).

**L2 — Request forgery.** Every request that changes data (POST/PUT/DELETE, including sign-in) must now:
- carry the header `X-Requested-With: shop-portal`. The portal's own page always sends it, and other websites can't add it without the browser asking the portal first, which it never agrees to;
- if the browser reports an `Origin`, come from the portal itself;
- use `application/json`, or `application/octet-stream` for the import upload. Plain HTML forms can send neither.

Sign-in and role checks run first, so unauthenticated requests still get `401`/`403`. Reading data (GET) is unaffected. Test: no header → `403`; `text/plain` or form encoding → `415`; a foreign `Origin` → `403`; the real page still works for every action.

**L4 — Limits.**
- Any single amount: at most **1,000,000,000** in the shop's currency.
- Any quantity or stock level: at most **1,000,000**.
- Sale, purchase and cost-of-goods totals are checked to stay within exact whole-cent arithmetic.
- The import applies the same limits.

Errors name the limit. Test: a price of 1e17, a stock of 2,000,000, an expense of 5e9 and an oversized sale are all refused; values at the limits are accepted.

**L5 — `limit` parameter.** Must be a whole number from 1 to 1000; otherwise `400`. The default is still 200.

**L6 — Sessions.**
- The database stores only the SHA-256 hash of each sign-in token, so a copied `shop.db` can't be used to sign in.
- Sessions now end after **12 hours without use**, as well as after 7 days at most. "Last used" is refreshed at most once a minute.
- Sign-ins that existed before the upgrade are hashed in place, so **nobody was signed out** by this change. A test confirms that an old-format session still works after the upgrade.

**L7 — Password rules.** New and changed passwords are refused if they are:
- a well-known common password (built-in list of about 90, such as `password123`, `12345678`, `qwertyuiop`, `iloveyou1`, `admin123`);
- one repeated character;
- or contain the username or the shop name.

The message suggests a passphrase of three unrelated words. Existing passwords keep working. Test: seven weak examples are refused, and `blue tiger lamp river` is accepted.

**L8 — XLSX reader.** The sheet relationship is now found by comparing ids as plain text; no regular expression is built from file content. Test: a crafted workbook with the id `(a+)+$aaaa…!` parses correctly in a few milliseconds. Two real-world fixtures (`test/fixtures/`, fake data: one saved by Microsoft Excel, one using shared strings and an unusual sheet id) still import correctly.

### L3 — Robust decoding (extra)
A badly encoded cookie (for example from another app on `localhost`) is now ignored instead of breaking every request. A badly encoded URL returns `400` instead of `500`.

## 3. Verification

### Automated: `npm test` (built-in `node:test`, no new dependencies)
Each run starts its own portal on a random port with a temporary database, then deletes it.

```
✔ every protected route rejects anonymous users and every admin route rejects staff
✔ SQL injection probes and path traversal are rejected (regression)
✔ M1: owner account can only be created from this computer          (tested via the PC's real LAN IP)
✔ H3: staff discounts are capped by the owner setting; admins are not
✔ M2: password reset and change sign out old sessions
✔ M2/H1: new passwords must be 8–256 characters
✔ M3: staff do not receive costs, profit, supplier details or customer personal data
✔ M4: exported CSV cells cannot run as spreadsheet formulas; staff cannot type customer names
✔ M5: payments are reversed (not deleted), cannot be reversed twice, and balances stay correct
✔ M5: reversed expenses stay listed but stop counting
✔ M5: important actions are written to an append-only audit log that staff cannot read
✔ Security headers are sent on pages and API responses
✔ A badly encoded cookie or URL from another app does not crash requests
✔ H1: password hashing does not block other requests              (/api/me answered in <50 ms during 4 parallel logins)
✔ H1: 5 wrong passwords lock the account (Retry-After); other accounts on the device still work
✔ H1: 20 failures from one device lock that device for every account
✔ H2: with a certificate the portal serves HTTPS, Secure cookies and HSTS   (real TLS, throwaway certificate)
✔ L2: changes without the portal header, with the wrong content type, or from another website are refused
✔ L4: amounts and quantities have sensible upper limits
✔ L5: the movements "limit" parameter is validated
✔ L6: the database stores only hashes of sign-in tokens, and idle sessions expire
✔ L6: sessions created before the upgrade keep working after it (tokens hashed in place)
✔ L7: easy-to-guess passwords are refused for new and changed passwords
✔ L8: the Excel reader handles real Excel files and hostile sheet ids safely
✔ L1: failed logins take about as long for unknown usernames as for real ones
✔ 2FA: one-time codes match the RFC 6238 / RFC 4226 test values
✔ 2FA: QR codes decode back to the exact setup link (independent decoder, all sizes and masks)
✔ 2FA: setup, sign-in with app code, no code re-use, recovery codes, switch off
✔ 2FA: wrong codes are limited per sign-in attempt; admin and shop-PC resets work; staff cannot reset
ℹ tests 29 · pass 29 · fail 0 · skipped 0
```

### Manual re-tests
- **M4 in Microsoft Excel 16:** the CSV that previously produced a live `=HYPERLINK` (`HasFormula=True`) now opens as text (`HasFormula=False`).
- **Browser, owner:** the Activity log lists all seeded actions with readable details. A customer statement shows the reversed payment struck through, with its reason and no Reverse button; the balance is correct. Reversing an expense from the screen works, and the total expenses drop.
- **Browser, staff:** the nav has no admin pages; the till shows "Discount (max 10%)"; 15% is blocked and 10% completes ("Discount (10%) −$1.00"). Customer phones are masked; the sale details show no cost; all staff pages load with no script errors.
- **Live portal (port 3000) after restart:** the database upgraded cleanly, the headers are present and setup is closed (`needsSetup:false`).

### Round 2 manual re-test (fresh throwaway copy, browser)
- **Owner:** sign in, a sale, a customer payment (CUST003 receipt), reversing it, an Excel import (2 new products), PDF and Excel export, saving the staff discount limit, receiving stock, sign out. All worked with no script errors.
- **Owner:** trying to change the password to `password123` shows the "too easy to guess" message.
- **Cashier:** the till shows the new limit ("max 12%"), and a 12% sale completes.

### Found and fixed during round 2 testing
- The new password rules rejected my own test passwords (`Owner#Pass2026` contains the username `owner`). That's correct behaviour, so I changed the test data.
- The request-origin check initially ran before the sign-in check, so an anonymous upload got `415` instead of `401`. I moved it after authentication, so rejections stay consistent.

### Bug caught during verification
The first browser pass found that the Expenses tab crashed. My patch script had turned `$$(` into `$(`, because `String.replace` treats `$$` specially. I fixed it, scanned the whole front end and every patch script for the same problem (none found), and re-tested.

## 4. Still open

| Item | Why it's open | Suggestion |
|---|---|---|
| Owner should switch on two-step login | It's available but off until each person sets it up | Settings → Two-step login on the owner account |
| Real-phone scan of the QR code | No QR reader on this PC | The first time you set it up; the setup key is the fallback |
| HTTPS switched on | Needs the owner to run `scripts\create-https-cert.ps1` and install the certificate on tablets | See §5 and the README |
| Login throttling resets on restart | Counters are kept in memory | Acceptable for a single shop PC |

## 5. Deployment notes and behaviour changes

### Round 3
- Restarted with two-step login available. The database gained the new `users` columns. Nothing changes for anyone until they switch it on.
- **Restarted:** the portal on port 3000 now runs the fixed code. On start the database gained the `audit_log` table, reversal columns and the `max_staff_discount = 10` setting. Existing data is unchanged and existing sign-ins stay valid.
- **Staff discount limit is now on (10%).** Change it under Settings → Shop if your cashiers routinely give more.
- **"Delete payment" and "Delete expense" are now "Reverse"**, with a required reason.
- **Sales no longer store free-text customer names.** The till never offered this, so nothing changes in normal use.
- **HTTPS is ready but off** until you run `scripts\create-https-cert.ps1`. I checked the script's syntax but didn't run it on this PC, because it writes to the Windows certificate store; the HTTPS server path itself is covered by the automated test.
- In-memory login throttling resets when the portal restarts. That's acceptable for a single-PC shop.

### Round 2 behaviour changes
- **Idle sign-out:** a device that hasn't used the portal for 12 hours must sign in again.
- **Password rules:** new and changed passwords that are common, repeat one character, or contain the username or shop name are refused. Existing passwords are not affected.
- **Limits:** amounts over 1,000,000,000 and quantities over 1,000,000 are refused.
- **Other tools or scripts** that call the portal API directly must send `X-Requested-With: shop-portal` and JSON. The portal page itself already does.
- **Restarted:** the portal on port 3000 runs the round 2 code. On start, existing sessions were converted to hashed tokens and nobody was signed out. A check of the live portal: a POST without the portal header gets `403`.

## Round 4 — Full re-check (after returns and two-step login)

| ID | Finding | Status | Proof |
|---|---|---|---|
| R4-A | First-run setup accepted requests addressed to another website name ("DNS rebinding"): on a fresh install a malicious page visited on the shop PC could create the owner account | **Fixed**: setup needs both a local connection and a local name (`localhost`, `127.0.0.1`, `[::1]`) | raw-request test (old code 200 → new 403). An earlier probe used `fetch`, which silently drops a custom Host header; it was redone with a raw request |
| R4-B | **Any admin could take over the owner** (reset the owner's two-step login and password, sign in as them, demote or disable them) | **Fixed** (approved): only the owner can add admins or change another admin; nobody else can change the owner account. Admins still manage cashiers | test replays the takeover; original probe now 403/401 at every step; browser check |
| R4-C | An admin could change their own password through user management without the current password | **Fixed**: own password only via *Change your password* | test |
| R4-D | An unknown refund method on a return was quietly treated as the sale's method | **Fixed**: refused with 400 | test |
| R4-UI | Phones: New Sale and Products scrolled sideways when a category or customer name was long (dropdowns grew to fit) | **Fixed** | measured at 375 px on every page, owner and cashier; desktop layout unchanged |

**Checked clean in this round:** script injection in all new fields (return reasons, usernames, recovery codes, two-step setup, Activity log, receipts): 0 executions. Return input validation; returns are owner/admin-only. Return reasons are neutralised in CSV. Two-step sign-in tickets. Security headers on the new endpoints. No third-party packages, outside resources or secrets.

**Owner account:** the account created at setup. In existing databases the earliest admin becomes the owner (your shop has one admin, which is now the owner).

**Tests:** 51, all passing (`npm test`).
