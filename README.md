# Small Shop Portal

A web portal for running a small shop: products, inventory, sales (point of sale) and accounting.
Runs on Node.js with a PostgreSQL database (started in Docker on this computer).

## Run it

Requires Node.js 22.13 or newer and Docker Desktop.

1. **Database settings.** Put the PostgreSQL user and a long random password in `.env` (copy `.env.example`;
   `PGPASSWORD` must be set). `.env` is private: it is never committed.
2. **Start PostgreSQL** (once; it starts again with Docker Desktop):

   ```bash
   docker compose up -d
   ```

   It listens on `127.0.0.1` only (port `PGPORT`, 5434 by default here), so other computers cannot reach the database.
3. **Install and start the portal:**

   ```bash
   npm install
   ```

   ```bash
   npm start
   ```

If the portal says it cannot connect to PostgreSQL, Docker Desktop or the database container is not running.

Open http://localhost:3000 **on this computer**. The first visit asks you to create the owner (admin) account
(for safety this only works on the computer running the portal).

To use it from other devices on the shop network (e.g. a tablet at the till), open
`http://<this-computer's-IP>:3000`. Set a different port with the `PORT` environment variable, or
`HOST=127.0.0.1` to allow this computer only.

### Encrypted connections (HTTPS) — recommended when tablets/phones use Wi-Fi

```bash
powershell -ExecutionPolicy Bypass -File scripts\create-https-cert.ps1 -TrustOnThisPc
```

This creates a certificate in `data\tls\`. Restart the portal and it uses `https://`. Install
`data\tls\portal.cer` on each tablet/phone so its browser trusts the portal. Keep the portal PC on the
staff network, not customer Wi-Fi. (Alternatively set `TLS_CERT`/`TLS_KEY` or `TLS_PFX`/`TLS_PASSPHRASE`.)

## What's included

| Area | Features |
|---|---|
| **Dashboard** | Today's sales, month sales / gross profit / net profit, stock value, low-stock alerts, 30-day sales chart, top products, recent sales |
| **Pos Sales** | Touch-friendly POS: search or scan SKU (Enter adds), cart with quantities, discount, automatic tax, payment method (cash/card/mobile/credit), printable receipt |
| **Sales** | History by date range, sale details, void a whole sale, CSV export. **New sale**: an invoice-style form for entering a sale at a desk (customer, searchable product lines, quantity, price, discount, payment); it saves like a till sale |
| **Returns** | From a sale's details: **Return items** — choose how many of each item come back (several partial returns allowed). The refund is the exact share of what was paid, including discount and tax. Refund in cash/card/mobile, or off the customer's account (automatic for credit sales). Items go back into stock unless marked damaged (written off). Numbered return receipts (RET001…), shown in P&L, cash flow, statements, the Activity log and a Returns CSV. Owners/admins only. |
| **Customers** | Register credit customers (name, phone, ID number, address, credit limit). Sell on credit at the till (credit limit is enforced), record payments, see what each customer owes, and a statement of every transaction with running balance — printable and exportable to CSV |
| **Suppliers** | Register suppliers (contact, phone, tax/reg. no.). Receive stock from a supplier paid on the spot or on credit, record payments to them, see what you owe each one, and a statement of every delivery and payment with running balance — printable and exportable to CSV |
| **Import / export** | Import many products at once from Excel (.xlsx) or CSV, with a downloadable template and a preview before anything is saved. Every page (except Pos Sales) has an **Export** menu that downloads what the page shows, with its current filters, as a PDF or Excel file |
| **Products** | Add/edit products with SKU, category, unit, cost and selling price, margin, reorder level, deactivate |
| **Inventory** | Stock levels, receive stock from suppliers (updates weighted average cost), adjust counts (damage, loss, recount), full movement history |
| **Accounting** | Profit & loss statement, cash flow, sales by payment method, expense tracking by category, sales-tax collected, CSV exports for your accountant |
| **Settings** | Shop name, currency, tax/VAT rate, maximum staff discount, **appearance colours** (accent and menu colour for everyone, with presets or any colour; shades adjust automatically so text stays readable in light and dark mode), **logo & browser icon** (upload PNG/JPEG/WebP/SVG/GIF; the logo shows on the sign-in page, the menu, receipts and statements; pictures are resized and kept in the shop database, so backups include them), two-step login, password changes, sign out other devices |
| **Users & roles** | Admins only, in its own menu item: staff accounts (add, change role, disable, reset password or two-step login) and **Roles & permissions** |
| **Activity log** | Owner-only, append-only record of sign-ins (and failed ones), payments, reversals, voids, discounts, price changes, stock changes, user and settings changes |

### Roles

- **Owner** — the account created at setup. An admin who is also the only one who can add or change other admins
  (their password, two-step login, role or status). Nobody else can change the owner account; if the owner is locked
  out, use a recovery code or `node scripts\reset-2fa.js <username>` on the shop computer.
- **Admin** — everything else, including managing users and roles.
- **Other roles** — made and edited by admins in **Users & roles → Roles & permissions** by ticking what the role may do:
  sell, give bigger discounts, see sales, void/return, see or edit products, see costs and profit, see or receive/adjust stock,
  customers, suppliers, accounting, Activity log, shop settings. Two come ready-made:
  - **Cashier** (built-in): make sales (discounts up to the owner's limit, 10% by default), view products, stock and sales history.
  - **Supply chain**: products, costs, stock (receive and adjust) and suppliers — no till, sales, customers or accounting.

  Choose a user's role in **Add user** or **Manage**. Changes apply straight away and are recorded in the Activity log.
  The server checks every permission itself, and never sends costs, profit, supplier details or customers' personal data
  to a role that is not allowed to see them. Managing users and roles always stays with admins.

### Security

- Repeated wrong passwords lock that account (5 tries) or device (20 tries) for 30 s, doubling up to 15 min.
- Changing or resetting a password signs that account out everywhere else. Unused sign-ins end after 12 hours.
- Passwords must be 8+ characters and not common or obvious (e.g. `password123`, the username or the shop name). A short phrase of three unrelated words works well.
- **Two-step login** (Settings → Two-step login): after the password, a 6-digit code from an authenticator app
  (Google Authenticator, Microsoft Authenticator, …). Strongly recommended for the owner. You get 8 single-use
  recovery codes for a lost phone; an admin can reset it for staff (Users & roles → Manage). If the owner loses both
  phone and recovery codes, run on the shop computer: `node scripts\reset-2fa.js <username>`.
- Payments and expenses are never deleted: mistakes are **reversed** with a reason and stay on record.
- Run `npm test` to replay the security tests and a month-of-trading test that checks every total
  (P&L, cash flow, balances, stock, statements) against hand-worked figures. Uses a temporary database, never your data.
- See `SECURITY_AUDIT_REPORT.md` and `SECURITY_REMEDIATION_REPORT.md`.

### How the numbers work

- **Net sales** = items sold − discounts (tax excluded; tax collected is shown separately as owed).
- **Cost of goods sold** uses each product's average cost at the moment of sale.
- **Net profit** = gross profit − stock losses from adjustments − operating expenses.
- **Credit sales** count as revenue when made, but as cash only when the customer pays. A customer's balance = credit sales − payments (voided sales are excluded).
- **Stock received on credit** counts as cash out only when you pay the supplier. A supplier's balance = deliveries on credit − payments made.
- Buying stock is not an expense; it shows in **Cash flow** and becomes cost of goods when items sell.

## Data & backups

All shop data lives in PostgreSQL (the `shop-pgdata` Docker volume). Back up with:

```bash
docker compose exec -T db pg_dump -U shop -d shop -Fc > shop-backup.dump
```

Restore into an empty database with `pg_restore`. The `data` folder (`DATA_DIR`) now only holds HTTPS certificate files.

## For developers: how the code is organised

One dependency: `pg`, the PostgreSQL driver. Everything else uses Node.js built-ins (`node:http`, `node:crypto`).
Settings can come from environment variables or a `.env` file (see `.env.example`). Models write SQL with `?`
placeholders and `await db.get / all / run / insert`; `transaction(fn)` runs fn's queries on one connection, one
transaction at a time, so two tills can never sell the last item twice.

```
server.js                 starts the web server (HTTP or HTTPS) and shuts down cleanly
src/
  app.js                  request pipeline: security headers → page files → route → sign-in → access rule
                          → same-site check → body → controller → JSON, with one central error handler
  config/                 environment (.env), constants and limits, TLS, the database connection, permissions
  routes/                 every endpoint: method, path, who may call it, which controller handles it
  controllers/            HTTP in/out only: read params/query/body, call a service, set cookies or send files
  services/               business rules: sales, returns, stock, accounts, reports, sign-in, roles, audit log
  models/                 all SQL, one file per area; schema.js creates the PostgreSQL tables
  validators/             turn request input into clean values or a clear 400 error
  middleware/             authentication, authorization, request guard, security headers, static files, errors
  utils/                  small shared helpers (HTTP, CSV, dates, hashing, cookies)
lib/                      self-contained file formats: Excel, PDF, QR codes, authenticator codes
scripts/                  HTTPS certificate helper, two-step login reset
test/                     npm test (starts its own portals, each on a temporary PostgreSQL database)
docker-compose.yml        the PostgreSQL container
```

Rules: controllers never touch the database; services never touch `req`/`res`; SQL lives only in `models/`.
To add an endpoint: a line in `src/routes/*.routes.js`, a controller function, and (if it is new logic) a service.
