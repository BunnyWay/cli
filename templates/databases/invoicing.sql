-- Invoicing: clients, invoices built from line items, and the payments
-- received against them. Three views turn line items into line
-- amounts, invoice totals, and outstanding balances.
--
-- SQLite dialect for Bunny Database. Money is stored in integer minor
-- units (cents). Timestamps are ISO 8601 UTC text, kept current by the
-- updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  phone TEXT,
  company TEXT,
  tax_id TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  country TEXT CHECK (country IS NULL OR length(country) = 2),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  payment_terms_days INTEGER NOT NULL DEFAULT 30
    CHECK (payment_terms_days >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS tax_rates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rate_percent REAL NOT NULL CHECK (rate_percent >= 0),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  number TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'sent', 'partially_paid', 'paid', 'overdue', 'void'
    )),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  issue_date TEXT NOT NULL DEFAULT (date('now')),
  due_date TEXT,
  purchase_order TEXT,
  notes TEXT,
  terms TEXT,
  sent_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS invoices_client_id_idx ON invoices (client_id);

-- Serves the chase list: unpaid invoices by how soon they are due.
CREATE INDEX IF NOT EXISTS invoices_status_due_date_idx
  ON invoices (status, due_date);

-- quantity is REAL so an invoice can bill fractional hours. Leave
-- tax_rate_id NULL for a line that is not taxed.
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  tax_rate_id INTEGER REFERENCES tax_rates(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS invoice_items_invoice_id_idx
  ON invoice_items (invoice_id);
-- Searched when a tax rate is deleted.
CREATE INDEX IF NOT EXISTS invoice_items_tax_rate_id_idx
  ON invoice_items (tax_rate_id);

-- An invoice can be paid in instalments, so it may have many payments.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (method IN ('card', 'bank_transfer', 'cash', 'cheque', 'other')),
  reference TEXT,
  notes TEXT,
  paid_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS payments_invoice_id_idx ON payments (invoice_id);

-- What each line is worth: the discounted amount, and the tax due on
-- it at that line's rate. Rounded to whole cents per line.
CREATE VIEW IF NOT EXISTS invoice_item_amounts AS
SELECT
  ii.id AS invoice_item_id,
  ii.invoice_id,
  CAST(ROUND(ii.quantity * ii.unit_price_cents - ii.discount_cents)
    AS INTEGER) AS net_cents,
  CAST(ROUND((ii.quantity * ii.unit_price_cents - ii.discount_cents)
    * COALESCE(t.rate_percent, 0) / 100) AS INTEGER) AS tax_cents
FROM invoice_items ii
LEFT JOIN tax_rates t ON t.id = ii.tax_rate_id;

-- Invoice totals. An invoice with no lines totals zero.
CREATE VIEW IF NOT EXISTS invoice_totals AS
SELECT
  i.id AS invoice_id,
  COALESCE(SUM(a.net_cents), 0) AS subtotal_cents,
  COALESCE(SUM(a.tax_cents), 0) AS tax_cents,
  COALESCE(SUM(a.net_cents + a.tax_cents), 0) AS total_cents
FROM invoices i
LEFT JOIN invoice_item_amounts a ON a.invoice_id = i.id
GROUP BY i.id;

-- What is still owed on each invoice.
CREATE VIEW IF NOT EXISTS invoice_balances AS
SELECT
  t.invoice_id,
  t.total_cents,
  COALESCE(p.paid_cents, 0) AS paid_cents,
  t.total_cents - COALESCE(p.paid_cents, 0) AS balance_cents
FROM invoice_totals t
LEFT JOIN (
  SELECT invoice_id, SUM(amount_cents) AS paid_cents
  FROM payments
  GROUP BY invoice_id
) p ON p.invoice_id = t.invoice_id;

CREATE TRIGGER IF NOT EXISTS clients_set_updated_at
AFTER UPDATE ON clients BEGIN
  UPDATE clients SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS invoices_set_updated_at
AFTER UPDATE ON invoices BEGIN
  UPDATE invoices SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
