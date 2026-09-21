-- Helpdesk: customers raise tickets that agents work through a thread
-- of messages, with internal notes, attachments, canned replies, and a
-- satisfaction score once the ticket is solved.
--
-- SQLite dialect for Bunny Database. Timestamps are ISO 8601 UTC text,
-- kept current by the updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS agents (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'admin')),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- external_id links a customer to the same person in your own app.
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT,
  company TEXT,
  external_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- first_response_at is stamped by the trigger below the first time an
-- agent replies, which is what most response time targets measure.
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  assignee_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'pending', 'on_hold', 'solved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  channel TEXT NOT NULL DEFAULT 'web'
    CHECK (channel IN ('email', 'web', 'chat', 'api')),
  first_response_at TEXT,
  resolved_at TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS tickets_customer_id_idx ON tickets (customer_id);

-- Serves an agent's own queue, and the unassigned queue.
CREATE INDEX IF NOT EXISTS tickets_assignee_id_status_idx
  ON tickets (assignee_id, status);
CREATE INDEX IF NOT EXISTS tickets_status_priority_idx
  ON tickets (status, priority);

-- Exactly one of customer_id and agent_id is set, naming who wrote the
-- message; both are NULL for a message the system posted itself.
-- is_internal marks a note only agents can see.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  agent_id INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  is_internal INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (customer_id IS NULL OR agent_id IS NULL)
);

CREATE INDEX IF NOT EXISTS ticket_messages_ticket_id_created_at_idx
  ON ticket_messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL
    REFERENCES ticket_messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  content_type TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS attachments_message_id_idx
  ON attachments (message_id);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT
);

CREATE TABLE IF NOT EXISTS ticket_tags (
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, tag_id)
);

CREATE INDEX IF NOT EXISTS ticket_tags_tag_id_idx ON ticket_tags (tag_id);

CREATE TABLE IF NOT EXISTS canned_responses (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES agents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS satisfaction_ratings (
  ticket_id INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Internal notes do not count as a reply to the customer.
CREATE TRIGGER IF NOT EXISTS ticket_messages_record_first_response
AFTER INSERT ON ticket_messages
WHEN NEW.agent_id IS NOT NULL AND NEW.is_internal = 0 BEGIN
  UPDATE tickets
  SET first_response_at = COALESCE(first_response_at, NEW.created_at)
  WHERE id = NEW.ticket_id;
END;

CREATE TRIGGER IF NOT EXISTS tickets_set_updated_at
AFTER UPDATE ON tickets BEGIN
  UPDATE tickets SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS canned_responses_set_updated_at
AFTER UPDATE ON canned_responses BEGIN
  UPDATE canned_responses
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
