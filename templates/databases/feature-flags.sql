-- Feature flags: one flag definition, a value per environment, and
-- targeting rules that override that value for some requests.
--
-- This one is read on every request and written when somebody flips a
-- switch, which suits a replicated SQLite database. Read the whole
-- flag_state view once per deploy or on a short cache, rather than
-- querying per flag per request.
--
-- SQLite dialect for Bunny Database. Timestamps are ISO 8601 UTC text,
-- kept current by the updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS environments (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

-- kind says how to read the text in default_value and in every
-- override: 'boolean' stores '0' or '1', 'json' stores an object, and
-- the rest store what they say.
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'boolean'
    CHECK (kind IN ('boolean', 'string', 'number', 'json')),
  default_value TEXT NOT NULL DEFAULT '0',
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- What a flag is worth in one environment. rollout_percent gates the
-- value behind a stable hash of the user id, so 0 means nobody and
-- 100 means everybody the rules did not already answer for.
CREATE TABLE IF NOT EXISTS flag_settings (
  flag_id INTEGER NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL
    REFERENCES environments(id) ON DELETE CASCADE,
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  value TEXT,
  rollout_percent INTEGER NOT NULL DEFAULT 100
    CHECK (rollout_percent BETWEEN 0 AND 100),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (flag_id, environment_id)
);

-- Rules are read in position order and the first match wins, so put
-- the narrow ones first. attribute names something the caller knows
-- about the request, such as 'email', 'plan', or 'country'.
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY,
  flag_id INTEGER NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
  environment_id INTEGER NOT NULL
    REFERENCES environments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  attribute TEXT NOT NULL,
  operator TEXT NOT NULL DEFAULT 'equals'
    CHECK (operator IN (
      'equals', 'not_equals', 'in', 'not_in', 'contains',
      'starts_with', 'ends_with', 'greater_than', 'less_than'
    )),
  comparand TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS rules_flag_id_environment_id_position_idx
  ON rules (flag_id, environment_id, position);

-- Who changed what, so a flag that broke production has a paper
-- trail. previous_value and new_value are the stored text.
CREATE TABLE IF NOT EXISTS flag_changes (
  id INTEGER PRIMARY KEY,
  flag_id INTEGER NOT NULL REFERENCES flags(id) ON DELETE CASCADE,
  environment_id INTEGER REFERENCES environments(id) ON DELETE SET NULL,
  actor TEXT,
  summary TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS flag_changes_flag_id_created_at_idx
  ON flag_changes (flag_id, created_at DESC);

-- Every live flag in every environment, which is the one query an
-- edge script needs at startup. A flag with no row in flag_settings
-- falls back to its default_value and stays off.
CREATE VIEW IF NOT EXISTS flag_state AS
SELECT
  f.key AS flag_key,
  e.key AS environment_key,
  f.kind,
  COALESCE(fs.is_enabled, 0) AS is_enabled,
  COALESCE(fs.value, f.default_value) AS value,
  COALESCE(fs.rollout_percent, 0) AS rollout_percent
FROM flags f
CROSS JOIN environments e
LEFT JOIN flag_settings fs
  ON fs.flag_id = f.id AND fs.environment_id = e.id
WHERE f.is_archived = 0;

CREATE TRIGGER IF NOT EXISTS flags_set_updated_at
AFTER UPDATE ON flags BEGIN
  UPDATE flags SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS flag_settings_set_updated_at
AFTER UPDATE ON flag_settings BEGIN
  UPDATE flag_settings
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE flag_id = NEW.flag_id AND environment_id = NEW.environment_id;
END;
