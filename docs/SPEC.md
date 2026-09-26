# NowStocking (RV-14A Parts Inventory): Build Spec

## Background

I'm building a Van's RV-14A. Each kit ships in a crate with a multi-page packing list. As I work the plans, I need to type or scan a part number and see exactly where it's stored so I can pull it.

The packing list is a tree:

```
Kit (RV-14A EMP/CONE KIT)
  Sub-kit (14 EMP HARDWARE)
    Bag (BAG 1118)
      Part (AN470AD4-5, 0.110 lb)
```

Key facts from the list:

- Most hardware bags hold one part number. Finding a rivet means finding its bag.
- Rivets ship by weight (LB). Counted items ship as each (225 LP4-3 pop rivets).
- The "Bin" column (HW, E3B, HW/SPA) is Van's warehouse location. Store it for reference only. Never show it as my location.
- The same part number shows up again in later kits (wing, fuselage, finish). Each kit's line is its own record with its own location.

## Objective

One PWA on my iPhone that does lookup, scanning, put-away, receiving, and pick lists, with a shared backend on Cloudflare at **pc-rv14a.nowstocking.com**.

## Scope

### v1

- Lookup with fuzzy autocomplete
- Scan a location QR, see its contents
- Put-away mode with one-tap undo
- Move item (including splitting a quantity across locations)
- Receiving checklist per kit
- Consumed / remaining tracking (counted items only)
- Pick lists by plans section and page
- Manually added items (parts not on any packing list)
- Offline cache with queued edits
- Change history (who changed what, when)
- QR label generator (Avery 5160 and 5163)
- Import packing list from photos
- CSV export

### v2

- Photos per part (R2)

### Out of scope

- Build log (lives in a separate app)
- Weatherproof labels (inventory is done indoors)

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Preact + Vite + vite-plugin-pwa, TypeScript | Served as Worker static assets |
| Routing | preact-iso | Real URLs for every screen (`/loc/B03`, `/item/123`, `/pick/5`). Back button and deep links work. |
| API | Cloudflare Worker with Hono | Same Worker as the frontend. One origin, no CORS. |
| Hosting | Workers static assets | `not_found_handling: "single-page-application"` so deep links load the app. Custom domain `pc-rv14a.nowstocking.com`. |
| Database | D1 (SQLite) | Few thousand rows total. Tiny. |
| Files | R2 | Import images now, part photos in v2 |
| Auth | Cloudflare Access | Email one-time PIN. Add a build partner later with no code. |
| Scanning | qr-scanner (nimiq) or @zxing/browser | Safari has no BarcodeDetector API. JS library over getUserMedia. |
| Labels | jsPDF, client side | No server work needed |
| Search | Client side over cached catalog | Makes offline lookup free |
| Import parser | Claude API, `claude-opus-5` (vision), set by the `IMPORT_MODEL` var | Accuracy over cost. API key stored as a Worker secret. |

[ASSUMPTION] Everything except the Claude API calls fits in the Cloudflare free tier at this data size.

## Accounts and Warehouses

- **Directory (D1):** users, accounts, memberships (owner, admin, member) and warehouses. See `migrations/0001_directory.sql`.
- **Warehouse data:** each warehouse is a Durable Object (`Warehouse`) with its own SQLite database, holding the tables
  below plus import jobs. Its schema is in `worker/warehouse/schema.ts`. Sync versions are per warehouse. Mutations
  apply as SQLite transactions, with no batching limits.
- **Routing:** every inventory route is `/api/w/<warehouse>/...`. The Worker checks membership in D1 before calling the
  warehouse's Durable Object.
- **Sign-up modes:** `SIGNUP_MODE=single` (self-hosted: one account that everyone joins, first user is owner), or
  `open` (hosted: each new user gets an account and a "Main" warehouse).
- **Labels:** labels encode `https://<host>/w/<warehouse>/loc/<code>`. Opening one switches the app to that warehouse.
- **Phone:** the phone keeps one IndexedDB per warehouse, plus an app-level store for identity and the open warehouse.
  More → Warehouses switches, adds (owner/admin), renames (owner/admin) and archives (owner) warehouses.
- **Sign-in:** `AUTH_MODE=access` (Cloudflare Access, the self-hosted default) or `email`. Email sign-in sends a
  6-digit code through Email Sending and sets a 90-day `HttpOnly` session cookie. Codes are stored as HMAC hashes, expire
  in 10 minutes, and any unexpired code works (not just the newest). Wrong tries are counted across all of an address's
  live codes, 5 in total. Each address can request 5 codes an hour, and each IP 10 sign-in requests a minute. The
  sign-in screen remembers a sent code for 10 minutes, so a reload while reading email returns to code entry. In email mode, writes from another origin are refused.
- **Bot check:** with `TURNSTILE_SITEKEY` set, "Email me a code" shows a Cloudflare Turnstile widget (action `signin`).
  The Worker verifies the token with siteverify before sending any email. It requires `success`, the `signin` action
  and a hostname in `TURNSTILE_HOSTNAMES`, and it fails closed. Tokens are single-use, so the widget resets after every
  attempt. On for app.nowstocking.com.
- **Members:** invites are keyed by email and last 30 days. Signing in with an invited email joins the account with the
  invited role. Owners change roles, admins remove members, anyone can leave, and the last owner can't be removed.
  Screen: More → Members.
- **Usage:** photo pages sent to Claude are counted per account per month. `PHOTO_PAGES_PER_MONTH` caps them (0 means
  unlimited). If a read would pass the cap, it's refused and the pages stay ready to retry. Settings shows the month's
  usage.
- **Delete account (Settings):** needs the user to type DELETE. Accounts where the user is the only member are erased:
  each warehouse's Durable Object storage, its R2 photos, invites, usage and the account. In shared accounts the user
  leaves, and their email is replaced with "deleted user" in each warehouse's rows and history. Deletion is refused if
  the user is the only owner of an account other people use. Sessions, sign-in codes, invites to them, and the user row
  are removed. Endpoint: `POST /api/me/delete`.
- **Legal:** nowstocking.com/privacy and /terms (site/public). The hosted sign-in screen and Settings link to them
  through `TERMS_URL` and `PRIVACY_URL`. privacy@nowstocking.com forwards through Cloudflare Email Routing.
- **Later:** billing.

## Data Model (per warehouse)

Every table has `version`, `updated_at`, `updated_by`, and `deleted_at`:

- `version` is a server-assigned, always-increasing number. Sync uses it, not phone clocks.
- `updated_by` is the email from the Access JWT.
- `deleted_at` makes deletes soft (tombstones), so deletes sync to other devices.

```sql
-- Global version counter. Every write takes the next value.
CREATE TABLE sync_counter (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  value         INTEGER NOT NULL
);

CREATE TABLE kits (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,      -- EMP, WING, ... MISC for manual items
  name          TEXT NOT NULL,             -- RV-14A EMP/CONE KIT
  received_at   TEXT,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE locations (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,      -- B03, S1-A, CRATE-1, RACK-1 (flat, no nesting)
  type          TEXT NOT NULL CHECK (type IN ('bin','shelf','crate','rack','other')),
  description   TEXT,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE items (
  id              INTEGER PRIMARY KEY,
  kit_id          INTEGER NOT NULL REFERENCES kits(id),
  parent_id       INTEGER REFERENCES items(id),   -- bag or sub-kit this sits in
  item_type       TEXT NOT NULL CHECK (item_type IN ('subkit','bag','part')),
  stock_code      TEXT NOT NULL,                  -- AN470AD4-5, BAG 1118
  search_key      TEXT NOT NULL,                  -- uppercase, alphanumerics only: AN470AD45
  description     TEXT,
  qty             REAL NOT NULL,
  unit            TEXT NOT NULL CHECK (unit IN ('ea','lb')),
  vans_bin        TEXT,                           -- reference only
  status          TEXT NOT NULL DEFAULT 'expected'
                  CHECK (status IN ('expected','received','missing','damaged','backordered')),
  source          TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import','manual')),
  notes           TEXT,
  sort_order      INTEGER NOT NULL,               -- preserves packing list order
  version         INTEGER NOT NULL,
  updated_at      TEXT NOT NULL,
  updated_by      TEXT NOT NULL,
  deleted_at      TEXT
);

CREATE INDEX idx_items_search ON items(search_key);
CREATE INDEX idx_items_parent ON items(parent_id);

-- Where an item is stored. One row normally; several rows when a quantity is split.
CREATE TABLE placements (
  id            INTEGER PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  location_id   INTEGER NOT NULL REFERENCES locations(id),
  qty           REAL,                      -- NULL = "all of it". Required when split.
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_placements_item ON placements(item_id);
CREATE INDEX idx_placements_location ON placements(location_id);

-- Each use of a counted part. Remaining = items.qty - SUM(consumptions.qty).
CREATE TABLE consumptions (
  id            INTEGER PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  qty           REAL NOT NULL,
  pick_list_id  INTEGER REFERENCES pick_lists(id),   -- optional: where it was used
  note          TEXT,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE INDEX idx_consumptions_item ON consumptions(item_id);

CREATE TABLE pick_lists (
  id            INTEGER PRIMARY KEY,
  section       TEXT NOT NULL,             -- 08
  page          TEXT,                      -- 08-03
  title         TEXT,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE pick_list_lines (
  id            INTEGER PRIMARY KEY,
  pick_list_id  INTEGER NOT NULL REFERENCES pick_lists(id),
  stock_code    TEXT NOT NULL,
  search_key    TEXT NOT NULL,             -- resolved to all matching items at display time
  qty_needed    REAL,
  pulled        INTEGER NOT NULL DEFAULT 0,
  version       INTEGER NOT NULL,
  updated_at    TEXT NOT NULL,
  updated_by    TEXT NOT NULL,
  deleted_at    TEXT
);

-- Idempotency: a mutation id is applied at most once.
CREATE TABLE applied_mutations (
  mutation_id   TEXT PRIMARY KEY,
  applied_at    TEXT NOT NULL
);

-- Field-level change history.
CREATE TABLE change_log (
  id            INTEGER PRIMARY KEY,
  table_name    TEXT NOT NULL,
  row_id        INTEGER NOT NULL,
  field         TEXT NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  mutation_id   TEXT NOT NULL,
  changed_by    TEXT NOT NULL,
  changed_at    TEXT NOT NULL
);

CREATE INDEX idx_change_log_row ON change_log(table_name, row_id);
```

### Location inheritance

A part's effective location is its own placements, else its parent bag's, else the sub-kit's. So I store a location once per bag and every part inside inherits it. I can give a single part its own placement when it moves.

### Moving

- Moving a bag moves every part that inherits from it. That's automatic, since those parts have no placements of their own.
- Parts in the bag with their own placements stay where they are, because they're physically somewhere else. The Move screen says "2 parts from this bag are stored elsewhere" with a "move them too" option.
- Moving a part lets me move all of it or split off a quantity to a second location. A split writes one placement per location, each with a qty.

### Split quantities

The quantities across a split item's placements should add up to its remaining quantity. The app shows a warning when they don't. It doesn't block the edit.

### Consumed vs. pulled

These are separate on purpose:

- **Pulled** is a pick-list checkbox: "I took this off the shelf."
- **Consumed** is a record that N units went into the airplane. It's logged as its own row, so 4 bolts can be used as 2 in section 08 and 2 more in section 22.
- Remaining = qty minus total consumed. It's tracked per item, not per location.
- Checking off a pick-list line offers a "mark N consumed" shortcut. It's optional and never automatic.
- Items with `unit = 'lb'` never show consumed or remaining. Their consume action is hidden.

### Why pick list lines store stock_code

A part number can live in more than one kit and location. The pick list matches lines to items by `search_key` and shows every location for that number, so I pull from whichever is closer or not empty.

### Manual items

- Parts not on any packing list (replacements from Van's, hardware-store items) go in a built-in `MISC` kit, with `source = 'manual'`. They can also be added to a real kit.
- Any item can be edited. Manual items can be deleted. Imported items can be deleted too, with a confirmation, since they're usually import corrections.
- All deletes are soft.

## Screens

| Route | Screen | What it does |
|---|---|---|
| `/` | Search (home) | Autocomplete box. Results show part, description, kit, and effective location in large text. |
| `/scan` | Scan | Camera view. Scanning a location QR opens Location Detail. |
| `/loc/:code` | Location Detail | Everything stored at B03, grouped by bag. |
| `/item/:id` | Item Detail | Placements, status, qty, consumed / remaining with a consumption log, notes, move button, parent bag, change history. |
| `/item/new` | Add Item | Manual item entry. |
| `/putaway` | Put-away | Scan a location once. Then type or pick items in a row. Each is assigned to that location until I scan a new one. Shows a running list of what I've put there. An Undo button reverses the last assignment. |
| `/receive/:kit` | Receiving | Per kit checklist in packing list order. Tap to mark received, missing, damaged, or backordered. Marking a bag or sub-kit sets all its children. Single parts can be overridden after. Summary of problems at the top. |
| `/pick`, `/pick/:id` | Pick Lists | Create by section, page and a required title, or from instruction photos. Edit or delete from the list's Edit button. Add lines with autocomplete. Lines sort by location. Check off as pulled. Lines with no location or a problem status float to the top. |
| `/import` | Import | Upload all packing list photos for one kit. Review parsed rows in an editable table. Commit to a kit. |
| `/labels` | Labels | Pick locations, pick template, pick starting label position, download PDF. |
| `/settings` | Settings | CSV export, sync status, pending edit count. |

## Look and Feel

- Brand: **NowStocking**, tagline "Parts inventory · find it, scan it, pull it". The logo is scan-corner brackets around a parts box.
- Light theme only: paper #F5F3EE background, navy #1B2A41 for text and location tags, signal orange #C2410C only for things you tap. Status colors: green #15803D done, red #B91C1C problem, amber #A16207 flagged or backordered.
- Type, bundled for offline use: Barlow Condensed for location codes and titles, IBM Plex Mono for part numbers, IBM Plex Sans for everything else.
- Tab bar: Search, Put away, Scan (raised center button), Pick, More. Focused tasks such as reviewing an import line hide the tab bar. Main actions sit in a bottom bar within thumb reach.
- Design canvas: https://claude.ai/artifact/GoZgUFCoVoiUbAhb2fsX8G

## App Updates

New versions download in the background and wait. A banner offers "Update"; otherwise the new version applies the next
time the app starts cold. The app never reloads itself in the middle of a task. The banner is hidden during sign-in and
line review.

## Search Behavior

- Normalize input the same way as `search_key`: uppercase, strip spaces, dashes, and dots.
- "470ad45" matches AN470AD4-5. "1118" matches BAG 1118 and the parts inside it.
- Rank: exact match, then prefix, then substring, then fuzzy.
- Show results after 2 characters. Recent searches show on an empty box.

## Scanning

- My location labels are QR codes that encode a URL: `https://pc-rv14a.nowstocking.com/loc/B03`.
- Inside the app, the scanner reads the URL and routes to `/loc/B03`.
- Outside the app, the iPhone Camera opens the same URL in Safari.
- On iOS, Safari and the installed PWA have separate storage and separate Access sessions. The Camera path is fine as online-only, with its own sign-in. The in-app scanner is the main path.
- Installed PWAs on iOS can use the camera. Safari may re-ask for camera permission after long gaps. That's expected.

## Offline and Sync

- On launch, pull all rows with `version > lastSyncedVersion` into IndexedDB. Deleted rows come down as tombstones.
- All reads come from IndexedDB. Lookup works with no signal.
- Edits go to an outbox in IndexedDB as field-level patches (`{mutationId, table, rowId, fields}`), then post in a batch when online.
- Conflicts are resolved per field. The server applies patches in arrival order, so the last one wins for each field. Fields a patch doesn't touch are left alone. If I change a status offline while a partner moves the same item, both edits survive.
- New rows created offline use a client-generated temporary id. The server returns the real id, and the client rewrites queued references to it.
- The header shows sync status and pending edit count.

### Gotcha: Access sessions and offline

If the Cloudflare Access session expires while offline, API calls fail on reconnect and redirect to login. Set the Access session duration long (1 month). The app should detect a login redirect (an opaque redirect or HTML response instead of JSON), keep the outbox, and prompt me to sign in instead of dropping edits.

## API (Worker)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/sync?since=<version> | All rows (including tombstones) with version above `since` |
| POST | /api/mutations | Batch of queued patches. Idempotent by client-generated mutation id. Writes `change_log`. |
| GET/POST | /api/import/jobs | List imports / create one (`page_count`) |
| PUT | /api/import/jobs/:id/pages/:n | Upload one page photo (raw JPEG body) |
| POST | /api/import/jobs/:id/start | Start the Workflow for uploaded pages, or `{pages}` to retry specific ones |
| GET | /api/import/jobs/:id | Job, per-page status, and parsed rows |
| POST | /api/import/jobs/:id/committed | Mark committed |
| DELETE | /api/import/jobs/:id | Delete the job and its photos |
| GET | /api/import/image/<key> | Serve an uploaded page photo for the review screen |
| GET | /api/me | Signed-in email |
| GET | /api/export.csv | Full export |
| GET | /api/history/:table/:id | Change history for one row |

- The Worker validates the `Cf-Access-Jwt-Assertion` header on every `/api` request, checking the team domain and the AUD tag. The email in the JWT becomes `updated_by`.
- Set `workers_dev = false` and turn off preview URLs. Only `pc-rv14a.nowstocking.com` is behind Access.
- Committing a reviewed import is an ordinary mutation (a kit insert plus item inserts), so it goes through the outbox like any other edit.
- `/api/mutations` caps D1 queries per request (sized for the free plan's 50) and returns results only for the mutations it applied. The client resends the rest.

## Import From Photos

1. Pick photos of every page of one kit (rotated is fine) and upload them. Each photo is downscaled on the phone and stored in R2. This takes seconds, and it's the only part that needs the screen kept open.
2. A Cloudflare Workflow (`ImportWorkflow`) reads all pages in parallel with Claude (`claude-opus-5`, adaptive thinking, structured output). Each page is its own step with retries, so the phone can be locked or the app closed. Results are stored per page in D1 (`import_jobs`, `import_pages`).
3. Nesting rule: a BAG line starts a bag. Indented lines under it are its parts. A sub-kit line starts a sub-kit. A bag that continues onto the next page stays open across the page break.
4. Unit rule: description ending in (LB) means `lb`. Otherwise `ea`.
5. Review (`/import/:job`) polls for progress and lists lines as they arrive. The default filter is "Needs review": lines the reader flagged as hard to read. Tapping a line opens a full-screen editor (`/import/:job/row/:key`) with the page photo, big fields, "Looks right · next flagged", previous/next, add line, and remove line. Edits are kept on the phone (IndexedDB) until commit.
6. Failed pages show the error and can be retried on their own.
7. Commit writes the kit and items as one mutation. It warns about existing items in the kit, failed pages, and unreviewed flagged lines.
8. Deleting an import removes its photos from R2. Committed items stay.

## Pick Lists From Instruction Photos

1. In the Pick tab, tap From photos and take a photo of each plans page for the step.
2. The same background Workflow reads each photo (`kind = 'instructions'`) and lists every part number in the step text and figure callouts, plus the page label (e.g. 10-27), section, a short title, and any stated quantity (e.g. "2X"). Drill sizes, figure references and wire colors are ignored. Harnesses and wire labels are tagged electrical.
3. Review (`/pick/photos/:job`) merges parts across photos. Each part shows where it's stored (one line per kit it shipped in). Parts in inventory are ticked by default. Parts not found show "Not in inventory" with close matches to pick from (a misread, or F-01412 vs F-01412C).
4. A title is required: it is typed when uploading the photos and can be changed on review. Page and section are editable too. Create pick list makes the list and its lines. If a pick list for that page exists, the parts can be added to it instead, skipping ones already there.

## Labels

Standard paper Avery labels from Staples (or Staples-brand equivalents).

| Use | Template | Size | Per sheet | Layout |
|---|---|---|---|---|
| Bins | Avery 5160 | 2.625" x 1" | 30 | 3 columns x 10 rows |
| Shelves | Avery 5163 | 4" x 2" | 10 | 2 columns x 5 rows |

Template geometry (8.5" x 11" sheet):

- 5160: top margin 0.5", left margin 0.1875", horizontal pitch 2.75", vertical pitch 1".
- 5163: top margin 0.5", left margin 0.15625", horizontal pitch 4.1875", vertical pitch 2".

Label layout: QR on the left (0.85" on 5160, 1.6" on 5163), location code in large bold text on the right.

Rules:

- QR codes never smaller than 0.75" square.
- Start position selector so partial sheets get reused.
- Print at 100% / Actual size. The PDF page should say this in the margin.
- Include a "print test on plain paper" option that adds label outlines.
- "Email the PDF" checkbox: sends the PDF as an attachment through Cloudflare Email Sending (`send_email` binding, from `labels@nowstocking.com`). The address defaults to the signed-in user's email and can be changed; the choice is remembered on the phone. Unchecked, Make PDF opens the share sheet (Print, Save to Files).

## Storage Conventions

- Bins: B01, B02, and up. Hardware bags go in bag number order so neighbors are predictable.
- Shelves: S1, S2 for the unit, A, B, C for the level, top down. S1-A is the top shelf of unit 1.
- Large parts: CRATE-1, RACK-1, and so on.
- Locations are flat. Bins are not tracked as being on a shelf.

## CSV Export

One row per item, for all item types (sub-kits, bags, and parts). Columns:

- kit, sub-kit, bag
- stock code, description
- qty, unit, consumed, remaining
- status, Van's bin
- effective locations (for example, `B03 (100); B04 (125)`)
- notes, source

Deleted rows are excluded.

## Acceptance Criteria

- Typing "470ad45" shows AN470AD4-5 with its bin within one keystroke of the match being unique.
- Scanning a bin label opens that bin's contents in under 2 seconds.
- Assigning a location to a bag makes every part in that bag show the same location.
- Moving a bag moves its inheriting parts. Parts with their own placement stay put.
- A part split across two locations shows both, with quantities.
- A part number present in two kits shows both locations.
- Logging 2 of 4 consumed shows 2 remaining. Logging 2 more later shows 0.
- Lookup works in airplane mode after one prior sync.
- Edits made offline appear on the server after reconnecting, with none lost.
- Two devices editing different fields of the same item offline both keep their changes.
- A delete on one device disappears on the other after sync.
- Put-away Undo restores the previous location.
- A 5160 label sheet printed from the app lines up with the physical labels on the first try.
- A reviewed import of one packing list matches the paper list line for line.
- CSV export includes every item with its effective location.
- Rivets sold by weight never show consumed or remaining counts.
- Deep links (`/loc/B03`, `/item/123`) load correctly from a fresh tab.

## Public Site and Open Source

- `nowstocking.com` and `www.nowstocking.com` serve a static landing page from `site/` (a separate Worker, `nowstocking-site`, no Access). It links to the GitHub repo and the self-hosting guide in the README.
- The code is MIT licensed ("NowStocking contributors"). Deployment identifiers in `wrangler.jsonc` (database id, Access team domain and AUD) are not secrets; forks replace them. Secrets live only in Worker secrets and GitHub Actions secrets.

## Setup Outline

1. Scaffold a Worker with static assets (Vite + Preact frontend, Hono API) in one repo.
2. `wrangler d1 create inventory`, then apply the schema migration.
3. `wrangler r2 bucket create imports`.
4. Add D1 and R2 bindings to `wrangler.jsonc`. Set `workers_dev: false`. Add the `ANTHROPIC_API_KEY` secret.
5. Deploy with a custom domain route for `pc-rv14a.nowstocking.com`. Put Cloudflare Access in front of it, with my email as the only allowed user. Set session duration to 1 month. Put the Access team domain and AUD in Worker vars.
6. Install the PWA from Safari with Share > Add to Home Screen.
7. Create locations in the app, print labels, stick them on. Add more locations and labels as storage grows.
8. Import the EMP/Cone packing list, run receiving, then put-away.

## Open Questions

None blocking.

- Locations start small (one shelf today) and grow as storage is bought. Locations are created and edited in the app. Nothing is seeded, and labels are printed a few at a time as locations are added.
