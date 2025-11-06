// server.js
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ESM-safe __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths
const DATA_DIR = path.join(__dirname, 'data');
const MENU_PATH = path.join(DATA_DIR, 'menu.json');
const ORDERS_PATH = path.join(DATA_DIR, 'order.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Utilities: safe read/write JSON
function readJSON(filePath, fallback = []) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`⚠️  Failed to read ${filePath}:`, err.message);
    return fallback;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error(`❌ Failed to write ${filePath}:`, err.message);
    return false;
  }
}

// Load mock data into memory
let menuData = readJSON(MENU_PATH, []);
let orders = readJSON(ORDERS_PATH, []);

// Build quick lookup for menu items by id
const menuMap = new Map(menuData.map(i => [String(i.id), i]));

// Middleware
app.use(cors());
app.use(bodyParser.json()); // keep since your package.json includes body-parser
app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// -------- MENU --------
app.get('/api/menu', (_req, res) => {
  // onlyVeg as in frontend
  const vegItems = Array.isArray(menuData) ? menuData.filter(i => i?.veg === true) : [];
  res.json(vegItems);
});

// -------- ORDERS (ADMIN) --------
app.get('/api/orders', (req, res) => {
  const key = req.query.key;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  // newest first
  const sorted = [...orders].sort(
    (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
  );
  res.json(sorted);
});

app.get('/api/orders/:id', (req, res) => {
  const key = req.query.key;
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

const ALLOWED_STATUSES = new Set([
  'PLACED',
  'CONFIRMED',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED'
]);

app.patch('/api/orders/:id/status', (req, res) => {
  const key = req.query.key;
  const { status } = req.body || {};
  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const order = orders.find(o => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  order.status = status;
  if (!writeJSON(ORDERS_PATH, orders)) {
    return res.status(500).json({ error: 'Failed to persist order status' });
  }
  res.json({ success: true, order });
});

// -------- ORDER (CUSTOMER) --------
app.post('/api/order', (req, res) => {
  const { items, customer, paymentMethod, notes } = req.body || {};

  // Basic validation
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items are required' });
  }
  if (!customer?.name || !customer?.phone || !customer?.address) {
    return res.status(400).json({ error: 'Customer name, phone, and address are required' });
  }
  if (!paymentMethod) {
    return res.status(400).json({ error: 'Payment method is required' });
  }

  // Enrich items from menu (fallbacks if price/name not sent from client)
  const normalizedItems = items.map(i => {
    const id = String(i.id);
    const fromMenu = menuMap.get(id);
    const name = i.name || fromMenu?.name || id;
    const price = Number.isFinite(i.price) ? Number(i.price) : Number(fromMenu?.price || 0);
    const qty = Math.max(1, Number(i.qty || 1));
    return { id, name, qty, price };
  });

  // Compute total
  const total = normalizedItems.reduce((sum, i) => sum + i.qty * i.price, 0);

  const newOrder = {
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    customer: {
      name: String(customer.name).trim(),
      phone: String(customer.phone).replace(/\D/g, '').slice(-12),
      address: String(customer.address).trim()
    },
    items: normalizedItems,
    total,
    paymentMethod,
    notes: (notes || '').toString(),
    status: 'PLACED'
  };

  orders.push(newOrder);
  if (!writeJSON(ORDERS_PATH, orders)) {
    return res.status(500).json({ error: 'Failed to persist order' });
  }

  // Return both shapes to satisfy frontend variations:
  // - order.v2.js can read res.id or res.order?.id
  res.json({ id: newOrder.id, order: newOrder });
});

// 404 for unknown API
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Ghar ka Khana server running at http://localhost:${PORT}`);
});
