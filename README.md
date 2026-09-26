<p align="center">
  <img src="public/icon.svg" width="88" alt="">
</p>

<h1 align="center">NowStocking</h1>

<p align="center"><strong>Parts inventory · find it, scan it, pull it</strong></p>

<p align="center">
  A phone app for keeping track of every part in a kit build: where it's stored, whether it arrived, and how many are left.<br>
  It runs entirely on your own Cloudflare account.
</p>

<p align="center">
  <a href="https://nowstocking.com">nowstocking.com</a> ·
  <a href="#self-hosting">Self-hosting</a> ·
  <a href="docs/SPEC.md">Spec</a> ·
  <a href="LICENSE">MIT license</a>
</p>

---

NowStocking was built for a Van's RV-14A, where each kit arrives as a crate of bags and a multi-page packing list. It works
for any kit that ships with a packing list.

- **Import packing lists from photos.** Pages are read in the background by Claude. Lines that were hard to read are flagged for a quick review against the photo.
- **Find any part fast.** Type `470ad45` and get `AN470AD4-5` with its bin, in big type. A part that shipped in two kits shows both locations.
- **Label and scan.** Print QR labels on Avery 5160 (bins) or 5163 (shelves) sheets. Scanning a label opens that bin's contents.
- **Put away in bulk.** Scan a bin once, then tap bags and parts as they go in. A bag's location covers every part inside it.
- **Pick lists from the plans.** Photograph an instruction page and get every part it calls for, matched to where it's stored.
- **Receiving, consumed and left, moves and splits, CSV export, emailed label PDFs.**
- **Works offline.** Everything lives on the phone. Edits queue up and sync when you're back online.

## How it's built

```
 iPhone (installed PWA)                          Cloudflare (your account)
 ┌────────────────────────────┐   HTTPS    ┌───────────────────────────────────────────┐
 │ Preact + preact-iso        │ ─────────▶ │ Access (email one-time PIN)               │
 │ IndexedDB: full copy       │            │   ▼                                       │
 │ Outbox of queued edits     │ ◀───────── │ Worker (Hono) + static assets             │
 │ Search, QR scan, PDFs      │   sync     │   ├─ D1: inventory, change log            │
 └────────────────────────────┘            │   ├─ R2: packing list / plans photos      │
                                           │   ├─ Workflows: read photos with Claude   │
                                           │   └─ Email Sending: label PDFs            │
                                           └───────────────────────────────────────────┘
```

| Layer | Choice |
|---|---|
| Frontend | Preact, preact-iso, Vite, vite-plugin-pwa, TypeScript |
| API | Cloudflare Worker with Hono, served from the same origin as the app |
| Data | D1 (SQLite). R2 for photos |
| Background jobs | Cloudflare Workflows. Each photo is its own retried step |
| Photo reading | Claude API (`claude-opus-5`) with structured output |
| Auth | Cloudflare Access. The Worker verifies the Access JWT on every API call |
| Email | Cloudflare Email Sending (`send_email` binding) |
| Labels | jsPDF and qrcode, generated on the phone |
| Scanning | qr-scanner (Safari has no BarcodeDetector) |

### Sync in one paragraph

The phone keeps a full copy of the inventory in IndexedDB and reads only from it, so search and lookup work with no
signal. Every edit is a *mutation*: a list of field-level insert, update or delete ops with a client-generated UUID. It's
applied locally right away and queued in an outbox. The Worker applies each mutation at most once, as one D1 transaction.
It stamps every row with a version number from a global counter and writes a field-level change log. Phones pull
`version > last seen`, including soft-delete tombstones. Row ids are random 52-bit integers made on the phone, so rows
created offline never need renumbering. Two people editing different fields of the same part both keep their changes.

## Project layout

```
src/            Phone app: pages, components, IndexedDB store, sync, search
worker/         API: Access auth, sync, mutations, photo import, Workflow, email
shared/         Types and inventory rules used by both (effective location, CSV)
migrations/     D1 schema
site/           The public nowstocking.com landing page (static, separate Worker)
docs/SPEC.md    The product spec and decisions
```

## Self-hosting

You need a Cloudflare account with a domain on it. The Workers Paid plan ($5/month) is recommended. Photo reading and
Workflows are heavier than the free plan's limits comfortably allow. Photo import also needs an
[Anthropic API key](https://console.anthropic.com/).

### 1. Clone and install

```sh
git clone https://github.com/particlep/rv14a-parts-inventory.git nowstocking
cd nowstocking
npm install
npx wrangler login
```

### 2. Create the database and bucket

```sh
npx wrangler d1 create rv14a-inventory
npx wrangler r2 bucket create rv14a-imports
```

Put the new `database_id` into `wrangler.jsonc`, then apply the schema:

```sh
npm run db:migrate:remote
```

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

`.github/workflows/deploy.yml` builds, applies D1 migrations and deploys on every push to `main`. Add two repository
secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`: create it from the *Edit Cloudflare Workers* template, then add **D1: Edit**.

Remove the "Deploy landing page" step unless you also want to host the `site/` page.

### Costs

Hosting fits in the Workers Paid plan's included usage at hobby scale: a few thousand rows and a few hundred photos.
Claude usage is billed by Anthropic per photo read. The import model is the `IMPORT_MODEL` setting in `wrangler.jsonc`.

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
| `npm run build` | Type-check and build |
| `npm run deploy` | Build and deploy the app |
| `npm run deploy:site` | Deploy the landing page in `site/` |
| `npm run db:migrate:local` / `:remote` | Apply D1 migrations |

## Adapting it to another kit

The packing-list reader in `worker/import.ts` describes a sub-kit → bag → part list. That layout is common, but the
prompt names Van's conventions. If your kit's lists look different, adjust the system prompt there. The instruction-page
reader, in the same file, works from the part-number formats listed in its prompt.

## Contributing

Issues and pull requests are welcome. Please keep changes small and focused, and run `npm run build` before opening a
PR. Schema changes go in a new numbered file in `migrations/`.

## License

[MIT](LICENSE). NowStocking isn't affiliated with or endorsed by Van's Aircraft or any other kit manufacturer. Product
names are used only to describe compatibility.
