-- Authentication challenges and revocable sessions.
-- Never store the one-time code or bearer token in plaintext.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS auth_challenges (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  audience TEXT NOT NULL CHECK (audience IN ('learner','organization','admin')),
  organization_id TEXT,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  request_ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_email_created
  ON auth_challenges(email_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_ip_created
  ON auth_challenges(request_ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry
  ON auth_challenges(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  audience TEXT NOT NULL CHECK (audience IN ('learner','organization','admin')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_active
  ON auth_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
  ON auth_sessions(expires_at, revoked_at);
