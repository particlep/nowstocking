-- Every Claude call: tokens and cost, per account. Kept (with the account id cleared) when an account is
-- deleted, so monthly totals stay correct.
CREATE TABLE ai_usage (
  id            INTEGER PRIMARY KEY,
  account_id    TEXT NOT NULL,
  warehouse_id  TEXT NOT NULL,
  job_id        TEXT,
  page          INTEGER,
  kind          TEXT,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_micro    INTEGER NOT NULL,     -- US dollars × 1,000,000
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_ai_usage_account ON ai_usage(account_id, created_at);
CREATE INDEX idx_ai_usage_created ON ai_usage(created_at);

-- Operator controls per account.
ALTER TABLE accounts ADD COLUMN ai_allowance_usd REAL;   -- overrides AI_ALLOWANCE_USD for this account
ALTER TABLE accounts ADD COLUMN ai_suspended_at TEXT;    -- set: photo reading is off for this account

-- Operator alerts already sent (so each goes out once).
CREATE TABLE alerts (
  key      TEXT PRIMARY KEY,
  sent_at  TEXT NOT NULL
);
