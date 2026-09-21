-- Link shortener: short slugs that redirect to target URLs, with
-- per-click analytics and a stats view.
--
-- SQLite dialect for Bunny Database. Timestamps are ISO 8601 UTC text.

CREATE TABLE IF NOT EXISTS links (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  target_url TEXT NOT NULL,
  title TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  expires_at TEXT,
  max_clicks INTEGER CHECK (max_clicks IS NULL OR max_clicks > 0),
  password_hash TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One row per redirect served. visitor_hash identifies a repeat
-- visitor without storing their IP address: hash the address with a
-- secret salt before inserting.
CREATE TABLE IF NOT EXISTS clicks (
  id INTEGER PRIMARY KEY,
  link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  referrer TEXT,
  country TEXT CHECK (country IS NULL OR length(country) = 2),
  city TEXT,
  device TEXT NOT NULL DEFAULT 'unknown'
    CHECK (device IN ('desktop', 'mobile', 'tablet', 'bot', 'unknown')),
  browser TEXT,
  os TEXT,
  visitor_hash TEXT
);

CREATE INDEX IF NOT EXISTS clicks_link_id_clicked_at_idx
  ON clicks (link_id, clicked_at DESC);

CREATE VIEW IF NOT EXISTS link_stats AS
SELECT
  l.id AS link_id,
  l.slug,
  COUNT(c.id) AS total_clicks,
  COUNT(DISTINCT c.visitor_hash) AS unique_visitors,
  MAX(c.clicked_at) AS last_clicked_at
FROM links l
LEFT JOIN clicks c ON c.link_id = l.id
GROUP BY l.id;

CREATE TRIGGER IF NOT EXISTS links_set_updated_at AFTER UPDATE ON links BEGIN
  UPDATE links SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
