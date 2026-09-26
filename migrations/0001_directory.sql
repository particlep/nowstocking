-- The directory: who can open which warehouse. Each warehouse's inventory lives in its own
-- Durable Object (see worker/warehouse/), not here.

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT,
  created_at  TEXT NOT NULL
);

-- A team. Self-hosted installs have one; the hosted service has one per customer.
CREATE TABLE accounts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE memberships (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  created_at  TEXT NOT NULL,
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id);

-- A build or storage space. An account can have several.
CREATE TABLE warehouses (
  id          TEXT PRIMARY KEY,           -- short, URL-safe; appears in label URLs
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX idx_warehouses_account ON warehouses(account_id);
