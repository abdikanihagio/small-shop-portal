# Backend refactoring report

**Date:** 2026-11-14 · **Scope:** the Node.js backend (`server.js`, `db.js`). The browser app in `public/` and the format libraries in `lib/` were not changed.

## 1. Before and after

| | Before | After |
|---|---|---|
| Entry point | `server.js`, 2,272 lines: config, HTTP, auth, validation, SQL, business rules, routes, static files | `server.js`, 26 lines: start, listen, clean shutdown |
| Database | `db.js`: connection + schema + migrations + reference numbers | `src/config/database.js` (connection, transactions) + `src/models/schema.js` (tables and upgrades, moved verbatim) |
| Structure | 2 files | 76 files in `src/` (largest 334 lines; most under 120) |
| Layers | everything could reach everything | routes → controllers → services → models; validators, middleware, utils, config alongside |
| Configuration | `process.env` read in several places | `src/config/environment.js` only, with optional `.env` (`.env.example` provided, `.env` git-ignored) |
| Dependencies | none (Node built-ins) | none (unchanged on purpose: no Express, no dotenv) |

Express was **not** introduced: the portal is deliberately dependency-free, so `src/app.js` configures the
existing `node:http` pipeline instead. The architecture otherwise follows the requested layout.

## 2. Files

**Created (76):**

| Folder | Files |
|---|---|
| `src/config/` | `environment.js`, `constants.js`, `tls.js`, `database.js`, `permissions.js` |
| `src/routes/` | `router.js`, `index.js`, `auth.routes.js`, `admin.routes.js`, `product.routes.js`, `sale.routes.js`, `party.routes.js`, `report.routes.js` |
| `src/controllers/` | `auth`, `admin`, `product`, `sale`, `party`, `report` (`*.controller.js`) |
| `src/services/` | `auth`, `two-step`, `session`, `throttle`, `user`, `role`, `settings`, `audit`, `visibility`, `product`, `product-import`, `inventory`, `sale`, `return`, `customer`, `supplier`, `statement`, `ledger`, `expense`, `report`, `export` (`*.service.js`) |
| `src/models/` | `schema.js`, `settings`, `user`, `session`, `role`, `audit`, `product`, `stock`, `sale`, `customer`, `supplier`, `ledger`, `expense`, `report` (`*.model.js`) |
| `src/validators/` | `common`, `password`, `product`, `inventory`, `sale`, `party`, `admin`, `export` (`*.validator.js`) |
| `src/middleware/` | `authenticate.js`, `authorize.js`, `request-guard.js`, `security-headers.js`, `static-files.js`, `error-handler.js` |
| `src/utils/` | `http.js`, `http-error.js`, `crypto.js`, `csv.js`, `dates.js`, `objects.js`, `session-cookie.js` |
| `src/` | `app.js` |
| root | `.env.example`, `REFACTORING_REPORT.md` |

**Modified:** `server.js` (now only startup), `scripts/reset-2fa.js` (uses the new models/services),
`test/security.test.mjs` (route sweep reads `src/routes/*.routes.js` instead of `server.js`), `.gitignore` (`.env`), `README.md` (developer section).

**Removed:** `db.js` (contents moved to `src/config/database.js`, `src/models/schema.js`, `src/models/settings.model.js`).

## 3. What each folder does

| Folder | Responsibility | Rule |
|---|---|---|
| `server.js` | Create the HTTP/HTTPS server, listen, shut down cleanly | nothing else |
| `src/app.js` | The request pipeline and the one central error handler | |
| `config/` | Environment, constants/limits, TLS, the single DB connection, the permission catalogue | no business logic |
| `routes/` | Each endpoint: method, path, access rule (`public`, `user`, `admin`, `perm:a\|b`), controller | access rules checked at startup |
| `controllers/` | Read params/query/body, call validators and a service, set cookies, send files | never touch the database |
| `services/` | Business rules (sales, returns, stock, balances, reports, sign-in, roles, audit) | never touch `req`/`res`; get an `actor` (user + IP) |
| `models/` | All SQL, one file per area | the only place with `db.prepare` |
| `validators/` | Turn input into clean values or a clear 400 message | |
| `middleware/` | Authentication, authorization, same-site request guard, security headers, static files, errors | |
| `utils/` | Small shared helpers | depend only on `config/` |

Checked automatically: no circular dependencies, no layer violations, no unused imports, no SQL outside `models/`.

## 4. Problems found and fixed

**Structure and duplication**
- One 2,272-line file mixed every concern → split by layer and area.
- Six near-identical `INSERT INTO stock_movements` statements → one `StockModel.addMovement`.
- The weighted-average cost formula was written twice (receiving stock, returns) → `utils/objects.weightedCost`, used through `inventory.addStockAtCost`.
- Customer and supplier statements repeated the running-balance and payment-row logic → `services/statement.service.js`.
- Customer and supplier payment input was validated twice → `validators/party.validator.readPayment`.
- `from`/`to` date parsing repeated about ten times → `validators/common.dateRange`.
- File-download headers written six times → `utils/http.sendDownload` / `sendCsv`.
- Per-role data hiding (costs, customer details) spread through routes → `services/visibility.service.js`.

**Coupling**
- The audit log and session code took `req`/`res` → services now receive an `actor`; cookies are set only in controllers.

**Defensive fixes (no visible change)**
- Reversals built SQL with a table name passed as a string → `models/ledger.model.js` only accepts the three known tables.
- Routes with a bad access rule or a missing controller now fail at startup, not at request time.
- Clean shutdown on Ctrl+C / SIGTERM closes the database.

**Small behaviour improvements (only on invalid input)**
- **Shop settings:** an invalid value used to save the earlier fields and then fail. Now all fields are checked first, and nothing is saved if one is wrong.
- **First-run setup:** a shop name over 200 characters used to create the owner and then fail without signing them in. It is now refused before anything is saved.

## 5. Test results

| Check | Result |
|---|---|
| `npm test` (security, business month-of-trading, returns, roles) | **59 / 59 pass** |
| Differential test: the original `server.js` and the new code, each on an empty temporary database, same script of 253 requests (every endpoint, owner/admin/cashier/supply-chain/accountant, error paths, request guard, lockout, static files) | **235 identical**; 18 differ, all intentionally (see below) |
| Circular dependencies, layer rules, unused imports | none |
| Real portal restart on `data/shop.db` | starts; page and API respond; `integrity_check = ok`; users and roles intact (read-only checks) |

**The 18 differences** are all requests that are wrong in two ways at once, for example updating a product that
doesn't exist *with* an invalid body. The new code checks the input first, so it answers "SKU is required" (400)
where the old code answered "Product not found" (404). The portal's screens never send such requests.

Keeping the old order was tried. It needed extra database reads in seven controllers and a deferred price check,
and it split validation across layers. That was removed as overengineering (see the follow-up review).

**Follow-up review (overengineering), also removed:**
- two near-identical sale-item queries;
- two near-identical product queries;
- a shared two-column CSV constant;
- the one-function file `utils/refs.js` (`formatRef` now lives in `config/constants.js`).

Net effect: 41 fewer lines.

## 6. Remaining issues and recommendations

- **No version control.** The project is not a git repository, so this refactor can't be diffed or rolled back
  with a command. Recommended: `git init` and a first commit now.
- **`src/models/schema.js`** is one long upgrade function (335 lines, moved as-is). It could be split into numbered
  migration files with a version table if the schema keeps growing.
- **Tests are end-to-end only.** The services can now be unit-tested directly (no server needed); worth adding
  for sale totals, returns and statements.
- **HTTPS** is still not switched on (run `scripts\create-https-cert.ps1`); unchanged by this work.
