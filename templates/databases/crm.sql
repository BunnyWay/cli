-- CRM: companies and the people who work there, deals moving through
-- pipeline stages, and the calls, emails, and notes along the way.
--
-- SQLite dialect for Bunny Database. Money is stored in integer minor
-- units (cents). Timestamps are ISO 8601 UTC text, kept current by the
-- updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT UNIQUE COLLATE NOCASE,
  industry TEXT,
  size TEXT,
  country TEXT CHECK (country IS NULL OR length(country) = 2),
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS companies_owner_id_idx ON companies (owner_id);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT UNIQUE COLLATE NOCASE,
  phone TEXT,
  job_title TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS contacts_company_id_idx ON contacts (company_id);

-- The columns of the board, left to right by position. Exactly one
-- stage should be marked won and one lost; they are the ends of the
-- board rather than steps along it.
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_won INTEGER NOT NULL DEFAULT 0 CHECK (is_won IN (0, 1)),
  is_lost INTEGER NOT NULL DEFAULT 0 CHECK (is_lost IN (0, 1)),
  CHECK (is_won + is_lost <= 1)
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'won', 'lost')),
  amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  expected_close_date TEXT,
  closed_at TEXT,
  lost_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS deals_stage_id_status_idx
  ON deals (stage_id, status);
CREATE INDEX IF NOT EXISTS deals_owner_id_idx ON deals (owner_id);
CREATE INDEX IF NOT EXISTS deals_company_id_idx ON deals (company_id);

-- One row each time a deal lands in a stage, written by the trigger
-- below. Subtract consecutive entered_at values to get time in stage,
-- which is what tells you where deals stall.
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id INTEGER PRIMARY KEY,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  entered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS deal_stage_history_deal_id_entered_at_idx
  ON deal_stage_history (deal_id, entered_at);

-- Calls, emails, meetings, and notes. An activity can point at a
-- company, a contact, a deal, or any combination of the three, since
-- a call about a deal is also a call with a person.
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'note'
    CHECK (kind IN ('call', 'email', 'meeting', 'note', 'task')),
  subject TEXT NOT NULL,
  body TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  due_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    company_id IS NOT NULL OR contact_id IS NOT NULL OR deal_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS activities_deal_id_idx ON activities (deal_id);
CREATE INDEX IF NOT EXISTS activities_contact_id_idx
  ON activities (contact_id);
CREATE INDEX IF NOT EXISTS activities_company_id_idx
  ON activities (company_id);

-- Serves the task list: what is due and not yet done.
CREATE INDEX IF NOT EXISTS activities_due_at_idx
  ON activities (due_at) WHERE completed_at IS NULL;

-- The board totals: how many open deals sit in each stage and what
-- they are worth.
CREATE VIEW IF NOT EXISTS pipeline_summary AS
SELECT
  s.id AS stage_id,
  s.name,
  s.position,
  COUNT(d.id) AS open_deals,
  COALESCE(SUM(d.amount_cents), 0) AS open_amount_cents
FROM stages s
LEFT JOIN deals d ON d.stage_id = s.id AND d.status = 'open'
GROUP BY s.id;

CREATE TRIGGER IF NOT EXISTS deals_record_first_stage
AFTER INSERT ON deals BEGIN
  INSERT INTO deal_stage_history (deal_id, stage_id)
  VALUES (NEW.id, NEW.stage_id);
END;

CREATE TRIGGER IF NOT EXISTS deals_record_stage_change
AFTER UPDATE OF stage_id ON deals
WHEN NEW.stage_id <> OLD.stage_id BEGIN
  INSERT INTO deal_stage_history (deal_id, stage_id)
  VALUES (NEW.id, NEW.stage_id);
END;

CREATE TRIGGER IF NOT EXISTS companies_set_updated_at
AFTER UPDATE ON companies BEGIN
  UPDATE companies SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS contacts_set_updated_at
AFTER UPDATE ON contacts BEGIN
  UPDATE contacts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS deals_set_updated_at
AFTER UPDATE ON deals BEGIN
  UPDATE deals SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
