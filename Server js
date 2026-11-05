"use strict";

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

const dbPath = process.env.DB_PATH || path.join(__dirname, "shop.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK (price >= 0),
    stock INTEGER NOT NULL CHECK (stock >= 0)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_address TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    delivery_charge INTEGER NOT NULL,
    total INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    product_color TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price INTEGER NOT NULL
  );
`);

// প্রথমবার ডাটাবেস তৈরি হলে নমুনা পণ্য যোগ হবে।
const productCount = db.prepare(
  "SELECT COUNT(*) AS count FROM products"
).get().count;

if (productCount === 0) {
  const insert = db.prepare(`
    INSERT INTO products (id, name, color, image_url, price, stock)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    insert.run(1, "নমুনা পণ্য ১", "সবুজ", "", 500, 10);
    insert.run(2, "নমুনা পণ্য ২", "সাদা", "", 750, 5);
  });

  seed();
}

const whatsapp = process.env.WHATSAPP_NUMBER || "";
const deliveryText = process.env.DELIVERY_CHARGE || "60";

if (!/^\d{1,6}$/.test(deliveryText)) {
  throw new Error("DELIVERY_CHARGE অবশ্যই পূর্ণ সংখ্যা হতে হবে");
}

const deliveryCharge = Number(deliveryText);

if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "16kb" }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "অনেক অনুরোধ এসেছে। একটু পরে চেষ্টা করুন।"
  }
});

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "অনেক অর্ডার অনুরোধ এসেছে। পরে চেষ্টা করুন।"
  }
});

app.use("/api", apiLimiter);

app.get("/api/products", (req, res) => {
  const products = db.prepare(`
    SELECT id, name, color, image_url, price, stock
    FROM products
    ORDER BY id
  `).all();

  res.json({ products, deliveryCharge });
});

function cleanText(value, min, max) {
  if (typeof value !== "string") return null;

  const cleaned = value.trim();

  if (
    cleaned.length < min ||
    cleaned.length > max ||
    /[\u0000-\u001F\u007F]/.test(cleaned)
  ) {
    return null;
  }

  return cleaned;
}

function normalizePhone(value) {
  if (typeof value !== "string") return null;

  const phone = value.replace(/[\s()-]/g, "");

  if (/^01[3-9]\d{8}$/.test(phone)) return phone;
  if (/^\+8801[3-9]\d{8}$/.test(phone)) return phone;
  if (/^8801[3-9]\d{8}$/.test(phone)) return phone;

  return null;
}

const getProduct = db.prepare(`
  SELECT id, name, color, price, stock
  FROM products
  WHERE id = ?
`);

const insertOrder = db.prepare(`
  INSERT INTO orders (
    customer_name,
    customer_phone,
    customer_address,
    payment_method,
    subtotal,
    delivery_charge,
    total
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertOrderItem = db.prepare(`
  INSERT INTO order_items (
    order_id,
    product_id,
    product_name,
    product_color,
    quantity,
    unit_price
  ) VALUES (?, ?, ?, ?, ?, ?)
`);

const reduceStock = db.prepare(`
  UPDATE products
  SET stock = stock - ?
  WHERE id = ? AND stock >= ?
`);

class OrderError extends Error {
  constructor(message) {
    super(message);
    this.name = "OrderError";
  }
}

// অর্ডার ও স্টক পরিবর্তন একই transaction-এ করা হয়।
const createOrder = db.transaction((data) => {
  let subtotal = 0;
  const checkedItems = [];

  for (const item of data.items) {
    const product = getProduct.get(item.id);

    if (!product) {
      throw new OrderError(
        "একটি পণ্য পাওয়া যায়নি। পেজ রিফ্রেশ করুন।"
      );
    }

    if (product.stock < item.quantity) {
      throw new OrderError(
        `"${product.name}"-এর পর্যাপ্ত স্টক নেই। পেজ রিফ্রেশ করুন।`
      );
    }

    const lineTotal = product.price * item.quantity;

    if (!Number.isSafeInteger(lineTotal)) {
      throw new OrderError("অর্ডারের মূল্য সঠিক নয়।");
    }

    subtotal += lineTotal;

    checkedItems.push({
      product,
      quantity: item.quantity
    });
  }

  const total = subtotal + deliveryCharge;

  if (!Number.isSafeInteger(total)) {
    throw new OrderError("অর্ডারের মোট মূল্য সঠিক নয়।");
  }

  const result = insertOrder.run(
    data.name,
    data.phone,
    data.address,
    data.payment,
    subtotal,
    deliveryCharge,
    total
  );

  const orderId = Number(result.lastInsertRowid);

  for (const item of checkedItems) {
    const update = reduceStock.run(
      item.quantity,
      item.product.id,
      item.quantity
    );

    if (update.changes !== 1) {
      throw new OrderError("স্টক পরিবর্তন হয়েছে। আবার চেষ্টা করুন।");
    }

    insertOrderItem.run(
      orderId,
      item.product.id,
      item.product.name,
      item.product.color,
      item.quantity,
      item.product.price
    );
  }

  return { orderId, subtotal, total };
});

app.post("/api/orders", orderLimiter, (req, res) => {
  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      error: "অর্ডারের তথ্য সঠিক নয়।"
    });
  }

  const name = cleanText(body.name, 2, 100);
  const phone = normalizePhone(body.phone);
  const address = cleanText(body.address, 10, 300);
  const payment = body.payment;

  if (!name) {
    return res.status(400).json({
      error: "সঠিক নাম লিখুন।"
    });
  }

  if (!phone) {
    return res.status(400).json({
      error: "সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।"
    });
  }

  if (!address) {
    return res.status(400).json({
      error: "অন্তত ১০ অক্ষরের সম্পূর্ণ ঠিকানা লিখুন।"
    });
  }

  if (!["cod", "whatsapp"].includes(payment)) {
    return res.status(400).json({
      error: "সঠিক পেমেন্ট পদ্ধতি নির্বাচন করুন।"
    });
  }

  if (
    !Array.isArray(body.items) ||
    body.items.length < 1 ||
    body.items.length > 30
  ) {
    return res.status(400).json({
      error: "কার্টে ১ থেকে ৩০ ধরনের পণ্য থাকতে হবে।"
    });
  }

  const seen = new Set();
  const items = [];

  for (const item of body.items) {
    if (
      !item ||
      !Number.isSafeInteger(item.id) ||
      item.id < 1 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > 20 ||
      seen.has(item.id)
    ) {
      return res.status(400).json({
        error: "পণ্যের তথ্য বা পরিমাণ সঠিক নয়।"
      });
    }

    seen.add(item.id);

    items.push({
      id: item.id,
      quantity: item.quantity
    });
  }

  try {
    const order = createOrder({
      name,
      phone,
      address,
      payment,
      items
    });

    let whatsappLink = null;

    if (/^8801[3-9]\d{8}$/.test(whatsapp)) {
      const message =
        `Sweety Graphics: নতুন অর্ডার #${order.orderId}`;

      whatsappLink =
        `https://wa.me/${whatsapp}?text=${encodeURIComponent(message)}`;
    }

    return res.status(201).json({
      orderId: order.orderId,
      subtotal: order.subtotal,
      deliveryCharge,
      total: order.total,
      whatsappLink
    });
  } catch (error) {
    if (error instanceof OrderError) {
      return res.status(400).json({
        error: error.message
      });
    }

    console.error("Order creation failed:", error);

    return res.status(500).json({
      error: "অর্ডার সংরক্ষণ করা যায়নি। পরে চেষ্টা করুন।"
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      error: "তথ্যের ফরম্যাট সঠিক নয়।"
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      error: "অনুরোধটি অনেক বড়।"
    });
  }

  console.error(error);

  return res.status(500).json({
    error: "সার্ভারে সমস্যা হয়েছে।"
  });
});

app.listen(PORT, () => {
  console.log(`Sweety Graphics server running on port ${PORT}`);
});
