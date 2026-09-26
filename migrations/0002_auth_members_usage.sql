-- Email one-time-code sign-in (AUTH_MODE = "email"), invites, and photo-read usage.

CREATE TABLE login_codes (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  code_hash   TEXT NOT NULL,          -- HMAC of the code; the code itself is never stored
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
CREATE INDEX idx_login_codes_email ON login_codes(email, created_at);

CREATE TABLE sessions (
  token_hash    TEXT PRIMARY KEY,     -- SHA-256 of the cookie value
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- Access granted to an email address. Signing in with that address joins the account.
CREATE TABLE invites (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  email       TEXT NOT NULL COLLATE NOCASE,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  invited_by  TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  PRIMARY KEY (account_id, email)
);
CREATE INDEX idx_invites_email ON invites(email);

-- Photo pages sent to Claude, per account per month (YYYY-MM).
CREATE TABLE usage (
  account_id  TEXT NOT NULL REFERENCES accounts(id),
  month       TEXT NOT NULL,
  photo_pages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, month)
);
