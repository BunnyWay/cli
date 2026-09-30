-- Appointment booking: staff offer services, keep weekly hours, and
-- take bookings from customers.
--
-- SQLite dialect for Bunny Database. Money is stored in integer minor
-- units (cents). Timestamps are ISO 8601 UTC text, kept current by the
-- updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- buffer_minutes is padding added after the appointment for cleaning
-- up, travel, or notes, and it counts as booked time.
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  buffer_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- Who can perform what. A service with no rows here is bookable with
-- nobody, which is the check to run before publishing it.
CREATE TABLE IF NOT EXISTS staff_services (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

CREATE INDEX IF NOT EXISTS staff_services_service_id_idx
  ON staff_services (service_id);

-- Recurring working hours, one row per block of a weekday. weekday
-- follows strftime('%w'), so 0 is Sunday. Times are local to the
-- staff member's timezone and stored as 'HH:MM'.
CREATE TABLE IF NOT EXISTS availability (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  CHECK (starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS availability_staff_id_weekday_idx
  ON availability (staff_id, weekday);

-- Holidays, sickness, and anything else that overrides the weekly
-- hours for a fixed window.
CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  reason TEXT,
  CHECK (starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS time_off_staff_id_starts_at_idx
  ON time_off (staff_id, starts_at);

-- ends_at is stored rather than derived, so changing a service's
-- duration never moves an appointment that is already booked.
--
-- SQLite has no constraint for overlapping ranges. The unique index
-- below stops two bookings starting at the same moment; anything
-- shorter than a full overlap check belongs in the transaction that
-- writes the booking. Read the staff member's bookings for the day,
-- confirm the gap is free, and insert, all in one transaction.
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'completed', 'cancelled', 'no_show')),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  notes TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (starts_at < ends_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_staff_id_starts_at_idx
  ON bookings (staff_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_customer_id_idx
  ON bookings (customer_id);

-- Serves the day view: everything booked in a window, soonest first.
CREATE INDEX IF NOT EXISTS bookings_starts_at_idx ON bookings (starts_at);
-- Serves a service's history, and the check when one is deleted.
CREATE INDEX IF NOT EXISTS bookings_service_id_idx
  ON bookings (service_id);

CREATE TRIGGER IF NOT EXISTS bookings_set_updated_at
AFTER UPDATE ON bookings BEGIN
  UPDATE bookings SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
