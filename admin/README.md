# Waxool Admin (ad.waxool.com)

The admin portal for the shops that rent the Small Shop Portal. It keeps the list of client shops, issues
each shop's **monthly invoice** on its billing day, records the payments you receive (EVC Plus, Zaad,
eDahab, Sahal, bank, cash), and tells each shop portal whether it is paid up.

| Shop status | What the shop portal does |
| --- | --- |
| **Paid up** | Works normally. |
| **Payment due** | Works normally, with an amber reminder on every screen (amount, last day, how to pay). |
| **Locked** | Read-only: nothing can be changed (no sales, no edits), but everyone can still sign in, look at everything and download backups. Happens when an invoice is still unpaid *grace days* after its due date, or when you suspend the shop. Data is never touched. |

When you record the payment, the shop portal unlocks within about 15 minutes (its next check).

## Daily use

- **Shops → Add shop**: name, portal address, monthly fee, currency, billing day (1–28), grace days,
  start date. You get the shop's **licence key** once; it goes into the shop portal's settings (below).
- **Invoices** are issued automatically every month on the billing day (never twice; months before the
  start date are not billed). **New invoice** on a shop adds a one-off charge (setup, training).
- **Record payment** on an invoice: amount, date, method and the transaction ID. Part payments are fine.
  A mistaken payment can be **reversed** (it stays in the list, crossed out).
- **Due date** gives a shop more time; **Void** cancels an unpaid invoice (with a reason).
- **Suspend** makes a shop's portal read-only at once (no invoices while suspended); **Activate** undoes it.
- **Settings**: your business name and the *how to pay* text that shops see in their reminder.
- **Activity** lists everything that happened (sign-ins, invoices, payments, status changes).

## Connecting a shop portal

On the shop portal's hosting (Railway → the shop's service → Variables) set:

```
BILLING_URL=https://ad.waxool.com
BILLING_KEY=<the shop's licence key>
```

and redeploy. The shop page in the admin then shows *Last check-in*. If the admin portal is down, shops
keep their last known status (a shop that was never checked works normally). Without these two
settings a shop portal never checks and is never locked.

## Run it on this computer

Uses the same PostgreSQL as the shop portal (`../docker-compose.yml`), with its own database:

```bash
npm install
npm run db:create
npm start
```

Open http://localhost:3200 and create the admin account (the first account can only be created from
this computer, or with `SETUP_TOKEN`, see below). Tests: `npm test`.

## Put it online (Railway)

1. In the Railway project: **New → GitHub Repo → small-shop-portal**. In the new service's
   **Settings → Source**, set **Root Directory** to `/admin`.
2. **New → Database → PostgreSQL** (a second one, only for the admin portal), and link it to the admin
   service with `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` references (as for the shop
   portal) or `DATABASE_URL`.
3. Variables of the admin service: `TRUST_PROXY=1`, `TZ=Africa/Mogadishu`, and a long random
   `SETUP_TOKEN` (at least 24 characters) so you can create the first admin account over the internet.
   Remove `SETUP_TOKEN` after the account exists.
4. **Settings → Networking → Custom Domain** `ad.waxool.com`, and add the CNAME (and TXT) records Railway
   shows at GoDaddy. Railway's trial allows one custom domain; a paid plan is needed for a second one.
