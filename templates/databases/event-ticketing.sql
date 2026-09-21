-- Event ticketing: venues host events that sell ticket types;
-- attendees place orders and receive tickets that are scanned at the
-- door.
--
-- SQLite dialect for Bunny Database. Money is stored in integer minor
-- units (cents). Timestamps are ISO 8601 UTC text, kept current by the
-- updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS venues (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  country TEXT CHECK (country IS NULL OR length(country) = 2),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0)
);

-- An online event has no venue and streams at stream_url instead.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  cover_image_url TEXT,
  is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0, 1)),
  stream_url TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  doors_open_at TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'published', 'sold_out', 'cancelled', 'completed'
    )),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS events_venue_id_idx ON events (venue_id);

-- Serves the what's on page: published events, soonest first.
CREATE INDEX IF NOT EXISTS events_status_starts_at_idx
  ON events (status, starts_at);

-- What is on sale for an event: early bird, general admission, and so
-- on. A NULL quantity_total means unlimited.
CREATE TABLE IF NOT EXISTS ticket_types (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  quantity_total INTEGER CHECK (quantity_total IS NULL OR quantity_total >= 0),
  max_per_order INTEGER NOT NULL DEFAULT 10 CHECK (max_per_order > 0),
  sales_start_at TEXT,
  sales_end_at TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ticket_types_event_id_idx
  ON ticket_types (event_id);

CREATE TABLE IF NOT EXISTS attendees (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One checkout, which may buy several tickets.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  attendee_id INTEGER NOT NULL REFERENCES attendees(id),
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded')),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  payment_reference TEXT,
  placed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS orders_event_id_idx ON orders (event_id);
CREATE INDEX IF NOT EXISTS orders_attendee_id_idx ON orders (attendee_id);

-- One row per admission. code is what the QR code encodes and what the
-- door scanner looks up, so it must be unguessable.
CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  ticket_type_id INTEGER NOT NULL REFERENCES ticket_types(id),
  code TEXT NOT NULL UNIQUE,
  holder_name TEXT,
  holder_email TEXT COLLATE NOCASE,
  seat TEXT,
  status TEXT NOT NULL DEFAULT 'valid'
    CHECK (status IN ('valid', 'checked_in', 'cancelled', 'refunded')),
  checked_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS tickets_order_id_idx ON tickets (order_id);
CREATE INDEX IF NOT EXISTS tickets_ticket_type_id_status_idx
  ON tickets (ticket_type_id, status);

-- How many of each ticket type are left. Cancelled and refunded
-- tickets return to the pool; unlimited types report NULL remaining.
CREATE VIEW IF NOT EXISTS ticket_availability AS
SELECT
  tt.id AS ticket_type_id,
  tt.event_id,
  tt.name,
  tt.quantity_total,
  COUNT(t.id) AS quantity_sold,
  CASE
    WHEN tt.quantity_total IS NULL THEN NULL
    ELSE tt.quantity_total - COUNT(t.id)
  END AS quantity_remaining
FROM ticket_types tt
LEFT JOIN tickets t
  ON t.ticket_type_id = tt.id
  AND t.status IN ('valid', 'checked_in')
GROUP BY tt.id;

CREATE TRIGGER IF NOT EXISTS events_set_updated_at
AFTER UPDATE ON events BEGIN
  UPDATE events SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS orders_set_updated_at
AFTER UPDATE ON orders BEGIN
  UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
