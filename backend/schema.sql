PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('telegram','whatsapp','email')),
  citizenship TEXT NOT NULL,
  citizenship_other TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('study','work','tourism','other')),
  residence TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  privacy_version TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS leads_status ON leads(status,created_at DESC);
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,
  lease_until TEXT,
  delivered_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS outbox_pending ON notification_outbox(status,next_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('page_view','form_start','form_submit')),
  destination TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day,type,destination,purpose)
);
