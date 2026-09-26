# NowStocking · RV-14A Parts Inventory

PWA + Cloudflare Worker at https://pc-rv14a.nowstocking.com (behind Cloudflare Access). Spec: `rv14a-parts-inventory-spec.md`.

- `src/` Preact frontend (preact-iso routes, IndexedDB cache, outbox sync)
- `worker/` Hono API: Access JWT check, sync, mutations, photo import (Claude)
- `shared/` schema, inventory rules (effective location, remaining, CSV) used by both
- `migrations/` D1 schema

```sh
npm run db:migrate:local   # first time
npm run dev                # local; API runs as DEV_USER_EMAIL from .dev.vars
npm run deploy             # build + wrangler deploy
npm run db:migrate:remote  # after adding a migration
npx wrangler secret put ANTHROPIC_API_KEY
```
