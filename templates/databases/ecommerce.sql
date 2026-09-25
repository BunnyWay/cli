-- E-commerce shop: a catalog of products sold as variants, guest and
-- customer carts, discount codes, and orders that keep their own copy
-- of what was bought.
--
-- SQLite dialect for Bunny Database. Money is stored in integer minor
-- units (cents). Timestamps are ISO 8601 UTC text, kept current by the
-- updated_at triggers at the end of this file.

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,
  accepts_marketing INTEGER NOT NULL DEFAULT 0
    CHECK (accepts_marketing IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- A customer's saved addresses. Orders point at these rows, so copy
-- the address onto the order too if you need shipping history to
-- survive the customer deleting an address.
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  recipient_name TEXT NOT NULL,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  region TEXT,
  postal_code TEXT,
  country TEXT NOT NULL CHECK (length(country) = 2),
  phone TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1))
);

CREATE INDEX IF NOT EXISTS addresses_customer_id_idx
  ON addresses (customer_id);

-- parent_id is NULL for a top-level category and lets categories nest.
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS product_categories (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

CREATE INDEX IF NOT EXISTS product_categories_category_id_idx
  ON product_categories (category_id);

CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt_text TEXT,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS product_images_product_id_idx
  ON product_images (product_id);

-- The thing a shopper actually buys: one row per size, colour, and so
-- on. options holds the choices as JSON, for example
-- {"size": "M", "colour": "black"}. compare_at_price_cents is the
-- struck-through price shown next to a sale price.
CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  options TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  compare_at_price_cents INTEGER
    CHECK (compare_at_price_cents IS NULL OR compare_at_price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  stock INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS product_variants_product_id_idx
  ON product_variants (product_id);

-- A cart belongs to a signed-in customer, or to a guest identified by
-- session_token.
CREATE TABLE IF NOT EXISTS carts (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  session_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS carts_customer_id_idx ON carts (customer_id);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY,
  cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL
    REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, variant_id)
);
-- Searched when a variant is deleted.
CREATE INDEX IF NOT EXISTS cart_items_variant_id_idx
  ON cart_items (variant_id);

-- kind 'percent' reads value as a percentage off, 'fixed' reads it as
-- an amount in cents. use_count is bumped by the checkout code.
CREATE TABLE IF NOT EXISTS discount_codes (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  kind TEXT NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value INTEGER NOT NULL CHECK (value > 0),
  min_subtotal_cents INTEGER,
  max_uses INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

-- Totals are written at checkout rather than recomputed, so an old
-- order still shows what the shopper was charged.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending', 'paid', 'fulfilled', 'shipped', 'delivered',
      'cancelled', 'refunded'
    )),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (length(currency) = 3),
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  shipping_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  discount_code_id INTEGER REFERENCES discount_codes(id) ON DELETE SET NULL,
  shipping_address_id INTEGER REFERENCES addresses(id) ON DELETE SET NULL,
  billing_address_id INTEGER REFERENCES addresses(id) ON DELETE SET NULL,
  payment_reference TEXT,
  notes TEXT,
  placed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders (customer_id);

-- Serves the orders queue: newest orders in a given state first.
CREATE INDEX IF NOT EXISTS orders_status_placed_at_idx
  ON orders (status, placed_at DESC);
-- Searched when an address or a discount code is deleted.
CREATE INDEX IF NOT EXISTS orders_shipping_address_id_idx
  ON orders (shipping_address_id);
CREATE INDEX IF NOT EXISTS orders_billing_address_id_idx
  ON orders (billing_address_id);
CREATE INDEX IF NOT EXISTS orders_discount_code_id_idx
  ON orders (discount_code_id);

-- sku, name, and unit_price_cents are copied from the variant at
-- checkout so renaming or repricing a product never rewrites history.
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id INTEGER REFERENCES product_variants(id) ON DELETE SET NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_id_idx
  ON order_items (order_id);
-- Searched when a variant is deleted.
CREATE INDEX IF NOT EXISTS order_items_variant_id_idx
  ON order_items (variant_id);

CREATE TRIGGER IF NOT EXISTS customers_set_updated_at
AFTER UPDATE ON customers BEGIN
  UPDATE customers SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS products_set_updated_at
AFTER UPDATE ON products BEGIN
  UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS product_variants_set_updated_at
AFTER UPDATE ON product_variants BEGIN
  UPDATE product_variants
  SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS carts_set_updated_at AFTER UPDATE ON carts BEGIN
  UPDATE carts SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS orders_set_updated_at
AFTER UPDATE ON orders BEGIN
  UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = NEW.id;
END;
