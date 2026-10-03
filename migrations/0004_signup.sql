-- Sign-up with a name and accepted terms (email sign-in). users.name already exists; a sign-up code carries the
-- name and the acceptance until it's used.
ALTER TABLE users ADD COLUMN terms_accepted_at TEXT;
ALTER TABLE login_codes ADD COLUMN signup_name TEXT;
ALTER TABLE login_codes ADD COLUMN terms_accepted_at TEXT;
