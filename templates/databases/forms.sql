-- Forms: build a form from fields, collect submissions, and keep the
-- answers and any uploaded files.
--
-- The shape of the data is decided by whoever builds the form, so
-- answers are stored one row per field rather than one column per
-- field. Read them back through the submission_answers view.
--
-- SQLite dialect for Bunny Database. Timestamps are ISO 8601 UTC text,
-- kept current by the updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS forms (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  notify_email TEXT COLLATE NOCASE,
  redirect_url TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- key is the name the form control posts under, so it is what the
-- handler reads. options holds the choices for select and radio as a
-- JSON array, for example ["small", "medium", "large"].
CREATE TABLE IF NOT EXISTS fields (
  id INTEGER PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  help_text TEXT,
  kind TEXT NOT NULL DEFAULT 'text'
    CHECK (kind IN (
      'text', 'textarea', 'email', 'number', 'date', 'select',
      'radio', 'checkbox', 'file'
    )),
  options TEXT,
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  UNIQUE (form_id, key)
);

CREATE INDEX IF NOT EXISTS fields_form_id_position_idx
  ON fields (form_id, position);

-- One row per completed form. Store a salted hash of the sender's IP
-- rather than the address itself.
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'read', 'archived', 'spam')),
  sender_hash TEXT,
  user_agent TEXT,
  country TEXT CHECK (country IS NULL OR length(country) = 2),
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS submissions_form_id_submitted_at_idx
  ON submissions (form_id, submitted_at DESC);

-- One row per answered field. A submission writes its answers in the
-- same transaction as the submission row, so a form with ten fields
-- costs one round trip rather than eleven.
CREATE TABLE IF NOT EXISTS answers (
  submission_id INTEGER NOT NULL
    REFERENCES submissions(id) ON DELETE CASCADE,
  field_id INTEGER NOT NULL REFERENCES fields(id) ON DELETE CASCADE,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (submission_id, field_id)
);

CREATE INDEX IF NOT EXISTS answers_field_id_idx ON answers (field_id);

-- Files live in Bunny Storage; this records where they went.
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL
    REFERENCES submissions(id) ON DELETE CASCADE,
  field_id INTEGER REFERENCES fields(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS uploads_submission_id_idx
  ON uploads (submission_id);

-- A submission read back in field order, with the labels attached.
CREATE VIEW IF NOT EXISTS submission_answers AS
SELECT
  s.id AS submission_id,
  s.form_id,
  s.submitted_at,
  f.id AS field_id,
  f.key,
  f.label,
  f.kind,
  f.position,
  a.value
FROM submissions s
JOIN fields f ON f.form_id = s.form_id
LEFT JOIN answers a ON a.submission_id = s.id AND a.field_id = f.id;

CREATE TRIGGER IF NOT EXISTS forms_set_updated_at
AFTER UPDATE ON forms BEGIN
  UPDATE forms SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
