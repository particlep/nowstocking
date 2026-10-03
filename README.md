<p align="center">
  <img src="public/icon.svg" width="88" alt="">
</p>

<h1 align="center">NowStocking</h1>

<p align="center"><strong>Parts inventory · find it, scan it, pull it</strong></p>

<p align="center">
  A phone app for keeping track of every part in a kit build: where it's stored, whether it arrived, and how many are left.<br>
  Use it at app.nowstocking.com, or run it on your own Cloudflare account.
</p>

<p align="center">
  <a href="https://github.com/particlep/nowstocking/actions/workflows/ci.yml"><img src="https://github.com/particlep/nowstocking/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1b2a41" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/runs%20on-Cloudflare%20Workers-c2410c" alt="Runs on Cloudflare Workers">
</p>

<p align="center">
  <a href="https://app.nowstocking.com"><strong>Use it at app.nowstocking.com</strong></a> ·
  <a href="https://nowstocking.com">nowstocking.com</a> ·
  <a href="#self-hosting">Self-hosting</a> ·
  <a href="docs/SPEC.md">Spec</a> ·
  <a href="LICENSE">MIT license</a>
</p>

---

NowStocking started in the shop of a Van's RV-14A build, where each kit arrives as a crate of bags, a multi-page packing
list and a binder of plans. Nothing in it is specific to one airplane. It works for any Van's model and for any kit that
ships with a packing list and step-by-step plans. That includes other kit aircraft and also kit cars, boats, CNC
machines and furniture.

- **Import packing lists from photos.** Pages are read in the background by Claude. Lines that were hard to read are flagged for a quick review against the photo.
- **Find any part fast.** Type `470ad45` and get `AN470AD4-5` with its bin, in big type. A part that shipped in two kits shows both locations.
- **Label and scan.** Print QR labels on Avery 5160 (bins) or 5163 (shelves) sheets. Scanning a label opens that bin's contents.
- **Set up a whole shelf at once.** Give a prefix, rows and columns, and get every location with its description: `S2-1A` "Shelf 2, 1A" through `S2-5D`. Bins come out as `B01`, `B02`…
- **Put away in bulk.** Scan a bin once, then tap bags and parts as they go in. A bag's location covers every part inside it.
- **Pick lists from the plans.** Photograph an instruction page and get every part it calls for, matched to where it's stored.
- **Receiving.** Check a kit against its packing list, with search and To check / Received / Problems filters. Record short shipments ("3 of 5 arrived"): they're marked backordered, and what's left is counted from what arrived.
- **A photo of every part.** Take or pick one on the part's page or while receiving. Search results show thumbnails, and they work offline too.
- **Export the whole list.** A CSV with every kit, bag and part: shipped, received, short, consumed and remaining quantities, status, locations and their descriptions. It's built on the phone, so it works offline.
- **Consumed and left, moves and splits, emailed label PDFs.**
- **Works offline.** Everything lives on the phone. Edits queue up and sync when you're back online.
- **Installs from the browser.** No App Store: on iPhone, open it in Safari and tap Share → Add to Home Screen. It then opens full-screen like any other app.
- **Phone or computer.** On a wide screen, a sidebar with every section replaces the phone's tab bar.

## How it's built

```
 iPhone (installed PWA)                          Cloudflare
 ┌────────────────────────────┐   HTTPS    ┌───────────────────────────────────────────┐
 │ Preact + preact-iso        │ ─────────▶ │ Sign-in: Access, or an emailed code       │
 │ IndexedDB: full copy       │            │   ▼                                       │
 │ Outbox of queued edits     │ ◀───────── │ Worker (Hono) + static assets             │
 │ Search, QR scan, PDFs      │   sync     │   ├─ Durable Object per warehouse:        │
 └────────────────────────────┘            │   │    inventory, sync, change log        │
                                           │   ├─ D1: users, accounts, warehouses      │
                                           │   ├─ R2: packing list, plans, part photos │
                                           │   ├─ Workflows: read photos with Claude   │
                                           │   └─ Email: codes, invites, label PDFs    │
                                           └───────────────────────────────────────────┘
```

| Layer | Choice |
|---|---|
| Frontend | Preact, preact-iso, Vite, vite-plugin-pwa, TypeScript |
| API | Cloudflare Worker with Hono, served from the same origin as the app |
| Data | A Durable Object (SQLite) per warehouse. D1 for the directory of users and accounts. R2 for photos |
| Background jobs | Cloudflare Workflows. Each photo is its own retried step |
| Photo reading | Claude API (`claude-opus-5`) with structured output |
| Auth | Self-hosted: Cloudflare Access, and the Worker verifies the Access JWT on every API call. Hosted: a one-time code sent by email, then a session cookie |
| Email | Cloudflare Email Sending (`send_email` binding): sign-in codes, invites, label PDFs and operator alerts |
| Labels | jsPDF and qrcode, generated on the phone |
| Scanning | qr-scanner (Safari has no BarcodeDetector) |

### Sync in one paragraph

The phone keeps a full copy of the inventory in IndexedDB and reads only from it, so search and lookup work with no
signal. Every edit is a *mutation*: a list of field-level insert, update or delete ops with a client-generated UUID. It's
applied locally right away and queued in an outbox. The warehouse's Durable Object applies each mutation at most once,
as one SQLite transaction. It stamps every row with a version number from the warehouse's counter and writes a
field-level change log. Phones pull
`version > last seen`, including soft-delete tombstones. Row ids are random 52-bit integers made on the phone, so rows
created offline never need renumbering. Two people editing different fields of the same part both keep their changes.

### Accounts and warehouses

- **User:** a person who signs in.
- **Account:** a team, with owner, admin and member roles. A user can belong to more than one.
- **Warehouse:** a build or storage space inside an account, such as "RV-14A" or "Garage shelves". Each has its own
  parts, locations, pick lists and labels.

Each warehouse's data lives in its own Durable Object, so one warehouse can never read another's rows. The Worker checks
the D1 directory on every request to decide who may open which warehouse. Label QR codes include the warehouse
(`/w/<id>/loc/B03`), so labels from two builds never collide.

Owners and admins invite people by email from **More → Members**. Signing in with an invited address joins that account
with the invited role. Owners change roles, admins remove members, and anyone can leave. An account always keeps at least
one owner.

### Configuration

All of these are `vars` in `wrangler.jsonc`:

| Setting | Self-hosted default | Hosted |
|---|---|---|
| `AUTH_MODE` | `"access"`: sign in through Cloudflare Access | `"email"`: a one-time code sent by email, then a 90-day session cookie |
| `SIGNUP_MODE` | `"single"`: everyone who can sign in joins one account, and the first person is its owner | `"open"`: each new user gets their own account |
| `PHOTO_PAGES_PER_MONTH` | `"0"`: no limit | Photo pages Claude may read per account each month |
| `EMAIL_FROM` | Sender for label PDFs, invites and sign-in codes | Same |
| `TURNSTILE_SITEKEY` | `""`: off | A [Turnstile](https://developers.cloudflare.com/turnstile/) sitekey. The bot check runs on "Email me a code" |
| `TURNSTILE_HOSTNAMES` | `""` | The site's hostnames, comma-separated. A token from any other hostname is refused |
| `TERMS_URL`, `PRIVACY_URL` | `""`: hidden | Links shown on the sign-in screen and in Settings |
| `TERMS_UPDATED_AT` | `""`: no terms to accept | When the terms last changed (`YYYY-MM-DD`). Email sign-in only: sign-up requires accepting the terms, and anyone who accepted before this date must accept again before using a warehouse |
| `AI_ALLOWANCE_USD` | `"0"`: unlimited | Each account's lifetime free Claude allowance, in USD. Photo reading stops when it's used up |
| `AI_MONTHLY_CAP_USD` | `"0"`: unlimited | Claude spend across all accounts per month. Photo reading pauses for everyone when it's reached |

Every Claude call records its tokens and cost, priced in `worker/aiBudget.ts`. Set the `OPERATOR_EMAILS` secret (a
comma-separated list) to give those people an Admin screen in More. It shows spend per account and has controls to
raise an allowance or turn AI off. Those people also get an email when someone signs up, when an account uses up its allowance, and when total
spend reaches 80% and 100% of the cap. Set a spend limit in the Anthropic console too, as a hard backstop.

With Turnstile on, also set the widget's secret: `npx wrangler secret put TURNSTILE_SECRET`. The Worker checks every
token with Cloudflare, requires the `signin` action and a listed hostname, and refuses the request if Cloudflare can't be
reached. Email sign-in requests are also limited to 10 a minute per IP address (the `AUTH_LIMITER` rate-limit binding). Email
sign-in also needs a secret: `openssl rand -base64 48 | npx wrangler secret put AUTH_SECRET`. Codes and session
tokens are stored only as hashes. Codes expire after 10 minutes and lock after 5 wrong tries, and each address can
request 5 codes an hour. With email sign-in, don't put Access in front of the app.

New users sign up at `/signup` with a name, an email and the terms, including a note that photos are read by
third-party AI services. Signing in emails a code only to registered addresses, but answers the same either way, so
the form doesn't reveal who has an account. To change the terms, edit `site/public/terms.html`, set
`TERMS_UPDATED_AT` to that date and deploy: everyone who accepted earlier is asked to accept again.

## Project layout

```
src/            Phone app: pages, components, IndexedDB store, sync, search
worker/         API: auth, directory (D1), routing, photo import, Workflow, email
worker/warehouse/  The Warehouse Durable Object: schema, mutations, sync, history, imports
shared/         Types and inventory rules used by both (effective location, CSV)
migrations/     D1 directory schema (warehouse schema is in worker/warehouse/schema.ts)
site/           The public nowstocking.com landing page (static, separate Worker)
docs/SPEC.md    The product spec and decisions
```

## Hosted or self-hosted

**app.nowstocking.com** runs this repo's `hosted` environment (`wrangler.jsonc → env.hosted`). It uses email sign-in, open
sign-up and a monthly photo limit. Anyone can sign up with an email address. Each workshop gets a free photo-reading
allowance of $5 (`AI_ALLOWANCE_USD`, about 30 pages) and up to 20 pages a month (`PHOTO_PAGES_PER_MONTH`). All
accounts together are capped at $50 a month (`AI_MONTHLY_CAP_USD`).

To run your own copy, follow the steps below. Your data stays in your Cloudflare account, behind your Access login.

## Self-hosting

You need a Cloudflare account with a domain on it. The Workers Paid plan ($5/month) is recommended. Photo reading and
Workflows are heavier than the free plan's limits comfortably allow. Photo import also needs an
[Anthropic API key](https://console.anthropic.com/).

### 1. Clone and install

```sh
git clone https://github.com/particlep/nowstocking.git
cd nowstocking
npm install
npx wrangler login
```

### 2. Create the database and bucket

```sh
npx wrangler d1 create inventory
npx wrangler r2 bucket create imports
```

Put the new `database_id` into `wrangler.jsonc`, then apply the schema:

```sh
npm run db:migrate:remote
```

The database only holds the directory: users, accounts and warehouses. Each warehouse's inventory lives in a Durable
Object that is created automatically the first time the warehouse is opened.

### 3. Point it at your domain

In `wrangler.jsonc`, change the `routes` pattern to the hostname you want, for example `parts.example.com`. The
`workers.dev` URL and preview URLs stay off on purpose, so the only way in is through Access.

### 4. Put Cloudflare Access in front of it

In the Cloudflare dashboard, go to **Zero Trust → Access → Applications → Add an application → Self-hosted**:

1. Set the application domain to your hostname.
2. Add a policy that allows your email address (one-time PIN login is fine).
3. Set the session duration to **1 month**, so the app keeps working offline between logins.
4. Copy the application's **AUD tag**.

In `wrangler.jsonc`, set `ACCESS_TEAM_DOMAIN` to `https://<your-team>.cloudflareaccess.com` and `ACCESS_AUD` to that tag.
The Worker refuses every API request if these are missing.

### 5. Email (optional, for emailing label PDFs)

```sh
npx wrangler email sending enable example.com
```

Set `EMAIL_FROM` in `wrangler.jsonc` to an address on that domain.

### 6. Deploy

```sh
npm run deploy
npx wrangler secret put ANTHROPIC_API_KEY
```

Open your hostname in Safari on the phone, sign in, then **Share → Add to Home Screen**.

### 7. Deploy on push (optional)

`.github/workflows/ci.yml` runs the type check and tests on every push and pull request. On `main`, it then deploys
app.nowstocking.com and the landing page. To make it deploy your own copy from your fork:

1. Change `github.repository == 'particlep/nowstocking'` in the deploy job to your repo.
2. Add two repository secrets:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN`: create it from the *Edit Cloudflare Workers* template, then add **D1: Edit**.
3. Replace the deploy job's steps after `npm ci` with `npm run build`,
   `npx wrangler d1 migrations apply inventory --remote` and `npx wrangler deploy`.

### Costs

Hosting fits in the Workers Paid plan's included usage at hobby scale: a few thousand rows and a few hundred photos.
Claude usage is billed by Anthropic per photo read, typically 10 to 30 cents a packing-list page with the default
model. The import model is the `IMPORT_MODEL` setting in `wrangler.jsonc`.

## Local development

```sh
cp .dev.vars.example .dev.vars   # skips Access locally and signs you in as dev@localhost
npm run db:migrate:local
npm run dev
```

Photo import needs `ANTHROPIC_API_KEY` in `.dev.vars`. Workflows, D1 and R2 all run locally.

| Command | What it does |
|---|---|
| `npm run dev` | App and Worker with hot reload |
| `npm test` | Tests, run in the Workers runtime against a local D1 |
| `npm run typecheck` | Type-check the app, Worker and tests |
| `npm run build` | Type-check and build |
| `npm run deploy` | Build and deploy the app |
| `npm run deploy:site` | Deploy the landing page in `site/` |
| `npm run db:migrate:local` / `:remote` | Apply D1 migrations |

## Tests

`npm test` runs [Vitest](https://vitest.dev) with the
[Cloudflare Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/), inside `workerd`,
with the D1 migrations applied to a fresh local database:

- **`test/accounts.test.ts`**: email sign-in.
  - Codes work, wrong codes lock out, requests are rate-limited, sign-out ends the session, and cross-site writes are refused.
  - Invites join the right account with the right role, roles are enforced, and monthly photo limits apply.
- **`test/worker.test.ts`**: the API end to end.
  - Sign-in refuses unconfigured and tokenless requests.
  - Self-hosted and hosted sign-up work, and roles are enforced.
  - Accounts can't reach each other's warehouses or photos.
  - Warehouses keep separate inventories.
  - Mutations are idempotent, merge per field, and roll back completely when rejected.
  - Deletes sync as tombstones, and a deleted location's or kit's code can be used again.
  - Large imports apply in one request, the change history records moves, and CSV export works.
  - Part photos are stored per warehouse, served only to its members, and deleted with the photo.
- **`test/shared.test.ts`**: inventory rules. Effective location (bag inheritance, overrides, splits), remaining counts
  from what arrived, the CSV export's columns, and shelf grids of locations.
- **`test/search.test.ts`**: search ranking, and matching plans part numbers to inventory.
- **`test/ai.test.ts`**: Claude cost tracking. Calls are priced from token counts, an account is cut off when its
  allowance is used up, everyone pauses at the monthly cap, operators are alerted once, and the Admin screen is
  hidden from everyone else.
- **`test/delete.test.ts`**: deleting an account. It needs confirmation, erases a solo account's warehouses and photos,
  removes the user's email from shared accounts' history, and won't leave a shared account without an owner.
- **`test/turnstile.test.ts`**: the sign-in bot check. A code is sent only when the check passes for the right action
  and hostname, sign-in fails closed when Cloudflare can't be reached, and the check stays off with no sitekey.

CI runs the type check and tests on every push and pull request, and deploys only when they pass.

## Adapting it to another kit

Most of the app doesn't care what you're building. Locations, labels, search, put-away, receiving and pick lists work
for any parts with part numbers.

The two photo readers in `worker/import.ts` are where kit conventions show up:

- **The packing-list prompt** describes a sub-kit → bag → part list, with weights marked `(LB)`. That layout is common.
  If your supplier's lists look different, describe them in `SYSTEM`.
- **The plans-page prompt** lists example part-number formats (Van's `F-01412C`, AN/MS hardware). Add your
  manufacturer's formats to `INSTRUCTIONS_SYSTEM` so it knows what to look for.

Pull requests that make these prompts work for more kit makers are welcome.

## Contributing

Issues and pull requests are welcome. Please keep changes small and focused, and run `npm run build` before opening a
PR. Schema changes go in a new numbered file in `migrations/`.

## License

[MIT](LICENSE). NowStocking isn't affiliated with or endorsed by Van's Aircraft or any other kit manufacturer. Product
names are used only to describe where it came from and what it works with.
