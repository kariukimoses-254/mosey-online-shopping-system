require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Database = require("better-sqlite3");
const { createChatHandler } = require("./lib/chat");

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET = process.env.JWT_SECRET || "development-secret-change-this";
const root = __dirname;
const dataDir = path.join(root, "data");
const uploadDir = path.join(root, "uploads");
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const corsOrigins = (process.env.CORS_ORIGIN || "").split(",").map((value) => value.trim()).filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use("/uploads", express.static(uploadDir));
// Serve the runtime mode flag from the server so any deployed host runs in live mode,
// while the static GitHub Pages copy (which only has public/app-config.js) stays in preview mode.
app.get("/app-config.js", (_req, res) => {
  res.type("application/javascript").send('window.MOSEY_MODE = "live";');
});
app.use(express.static(path.join(root, "public")));

const db = new Database(path.join(dataDir, "shop.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT DEFAULT '',
 category TEXT DEFAULT 'General', price REAL NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
 image TEXT DEFAULT '', featured INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, customer_name TEXT NOT NULL,
 email TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, payment_method TEXT NOT NULL,
 items_json TEXT NOT NULL, total REAL NOT NULL, status TEXT NOT NULL DEFAULT 'Pending',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS meta (
 key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`);

const SEED_VERSION = "2";
const insertProduct = db.prepare("INSERT INTO products (name,description,category,price,stock,image,featured) VALUES (?,?,?,?,?,?,?)");
const seed = [
  ["Wireless Headphones","Immersive sound, comfortable fit and long battery life.","Electronics",3499,24,"/images/wireless-headphones.jpg",1],
  ["Smart Watch","A clean everyday smartwatch for activity and notifications.","Electronics",5299,18,"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=85",1],
  ["Everyday Backpack","A durable everyday bag with room for your essentials.","Fashion",2199,32,"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=900&q=85",1],
  ["Minimal Desk Lamp","Warm lighting and a modern, understated design.","Home",1899,15,"https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=85",0],
  ["Running Sneakers","Lightweight comfort for walks, workouts and everyday use.","Fashion",3999,20,"https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=900&q=85",1],
  ["Ceramic Coffee Set","A simple ceramic set for your morning ritual.","Home",1499,40,"/images/ceramic-coffee-set.jpg",0],
  ["Bluetooth Speaker","Room-filling sound in a compact, travel-friendly design.","Electronics",2799,26,"/images/bluetooth-speaker.jpg",0],
  ["Mechanical Keyboard","Tactile, responsive typing with a sturdy everyday build.","Electronics",4599,14,"/images/mechanical-keyboard.jpg",0],
  ["Wireless Charger","A tidy charging pad for your desk or bedside table.","Electronics",1999,35,"/images/wireless-charger.jpg",0],
  ["Wireless Earbuds","Pocket-sized earbuds with clear sound and a charging case.","Electronics",2499,30,"/images/wireless-earbuds.jpg",1],
  ["Power Bank 20,000mAh","Keep your devices charged through long days out.","Electronics",1899,45,"/images/power-bank.jpg",0],
  ["Leather Wallet","A slim, classic wallet with space for your daily cards.","Fashion",1599,28,"/images/leather-wallet.jpg",0],
  ["Canvas Tote Bag","A roomy everyday tote for errands, work and weekends.","Fashion",1299,38,"/images/canvas-tote.jpg",0],
  ["Classic Sunglasses","Timeless frames with comfortable, everyday lenses.","Fashion",1799,22,"/images/classic-sunglasses.jpg",0],
  ["Cotton Hoodie","Soft, relaxed cotton comfort for cooler evenings.","Fashion",2899,19,"/images/cotton-hoodie.jpg",0],
  ["Scented Candle","A warm, calming scent for slow evenings at home.","Home",899,50,"/images/scented-candle.jpg",0],
  ["Woven Throw Blanket","A soft, textured layer for your sofa or reading chair.","Home",2399,16,"/images/woven-blanket.jpg",0],
  ["Ceramic Planter","A clean ceramic home for your favourite houseplant.","Home",1199,33,"/images/ceramic-planter.jpg",0],
  ["Wall Clock","A quiet, minimal clock that suits any room.","Home",1699,21,"/images/wall-clock.jpg",0],
  ["Desk Organizer","Keep pens, notes and small essentials neatly in place.","Home",1399,27,"/images/desk-organizer.jpg",0]
];
const seedVersion = db.prepare("SELECT value FROM meta WHERE key='product_seed'").get()?.value || "0";
if (db.prepare("SELECT COUNT(*) AS n FROM products").get().n === 0) {
  const tx = db.transaction(rows => rows.forEach(product => insertProduct.run(...product)));
  tx(seed);
  db.prepare("INSERT INTO meta (key,value) VALUES ('product_seed',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(SEED_VERSION);
} else if (seedVersion !== SEED_VERSION) {
  // One-time top-up for an existing catalogue: add only seed products that are missing.
  const find = db.prepare("SELECT id FROM products WHERE name=?");
  const tx = db.transaction(rows => {
    for (const product of rows) if (!find.get(product[0])) insertProduct.run(...product);
  });
  tx(seed);
  db.prepare("INSERT INTO meta (key,value) VALUES ('product_seed',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(SEED_VERSION);
}
const adminEmail = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
if (!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || "ChangeMe123!", 12);
  db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')")
    .run(process.env.ADMIN_NAME || "Store Administrator", adminEmail, hash);
}

function tokenFor(user) {
  return jwt.sign({ id: user.id, email: user.email, role: user.role, name: user.name }, SECRET, { expiresIn: "12h" });
}
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try { req.user = jwt.verify(token, SECRET); next(); }
  catch { return res.status(401).json({ error: "Session expired. Please sign in again." }); }
}
function admin(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Administrator access required." });
  next();
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype));
}});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (value) => String(value ?? "").trim();
function safeImageUrl(value) {
  const url = clean(value);
  if (!url) return "";
  if (/^\/(uploads|images)\/[A-Za-z0-9._-]+$/.test(url)) return url;
  if (/^https?:\/\/\S+$/i.test(url) && url.length <= 2048) return url;
  return null;
}
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of hits) if (record.reset <= now) hits.delete(key);
  }, windowMs);
  timer.unref();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let record = hits.get(key);
    if (!record || record.reset <= now) {
      record = { count: 0, reset: now + windowMs };
      hits.set(key, record);
    }
    record.count += 1;
    if (record.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((record.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}
const authLimiter = rateLimit({ windowMs: 30 * 60 * 1000, max: 40, message: "Too many sign-in attempts. Please wait a few minutes and try again." });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: "Too many account attempts. Please try again later." });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: "You're sending messages quickly. Give me a second and try again." });

app.get("/api/health", (_req,res) => res.json({ status:"ok", service:"Mosey Shop API" }));
app.get("/api/products", (req,res) => {
  const q = clean(req.query.q).slice(0, 100);
  const category = clean(req.query.category).slice(0, 60);
  const escaped = q.replace(/[\\%_]/g, "\\$&");
  const rows = db.prepare(`SELECT * FROM products WHERE (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\') AND (?='' OR category=?) ORDER BY featured DESC, id DESC`)
    .all(`%${escaped}%`, `%${escaped}%`, category, category);
  res.json(rows);
});
app.get("/api/categories", (_req,res) => res.json(db.prepare("SELECT DISTINCT category FROM products ORDER BY category").all().map(x=>x.category)));
app.post("/api/chat", chatLimiter, createChatHandler({ db }));
app.post("/api/auth/register", registerLimiter, (req,res) => {
  const name = clean(req.body?.name);
  const email = clean(req.body?.email).toLowerCase();
  const password = String(req.body?.password || "");
  if (name.length < 2 || name.length > 80 || email.length > 254 || !EMAIL_RE.test(email) || password.length < 8 || password.length > 72)
    return res.status(400).json({ error:"Enter your name, a valid email and a password of 8–72 characters." });
  try {
    const hash = bcrypt.hashSync(password, 12);
    const result = db.prepare("INSERT INTO users (name,email,password_hash) VALUES (?,?,?)").run(name, email, hash);
    const user = db.prepare("SELECT id,name,email,role FROM users WHERE id=?").get(result.lastInsertRowid);
    res.status(201).json({ token:tokenFor(user), user });
  } catch { res.status(409).json({ error:"An account with that email may already exist." }); }
});
app.post("/api/auth/login", authLimiter, (req,res) => {
  const { email, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || "").slice(0, 200), user.password_hash)) return res.status(401).json({ error:"Email or password is incorrect." });
  res.json({ token:tokenFor(user), user:{ id:user.id, name:user.name, email:user.email, role:user.role } });
});
app.get("/api/auth/me", auth, (req,res) => res.json({ user:req.user }));

app.post("/api/orders", auth, (req,res) => {
  const body = req.body || {};
  const { items } = body;
  const customerName = clean(body.customerName);
  const email = clean(body.email).toLowerCase();
  const phone = clean(body.phone);
  const address = clean(body.address);
  const paymentMethod = clean(body.paymentMethod);
  const allowedPayments = ["Cash on delivery","M-Pesa on delivery","M-Pesa via WhatsApp","Bank transfer"];
  if (!Array.isArray(items) || !items.length || items.length > 50 ||
      customerName.length < 2 || customerName.length > 80 || email.length > 254 || !EMAIL_RE.test(email) ||
      phone.length < 7 || phone.length > 30 || address.length < 8 || address.length > 300 ||
      !allowedPayments.includes(paymentMethod))
    return res.status(400).json({ error:"Complete valid delivery details and add at least one item." });
  try {
    let total = 0; const confirmed = [];
    const tx = db.transaction(() => {
      for (const item of items) {
        const product = db.prepare("SELECT * FROM products WHERE id=?").get(Number(item.id));
        const qty = Math.floor(Number(item.quantity));
        if (!product || !Number.isInteger(qty) || qty < 1 || product.stock < qty) throw new Error(`Not enough stock available for ${product ? product.name : "a product"}.`);
        db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(qty, product.id);
        total += product.price * qty;
        confirmed.push({ id:product.id, name:product.name, price:product.price, quantity:qty });
      }
      const result = db.prepare(`INSERT INTO orders (user_id,customer_name,email,phone,address,payment_method,items_json,total)
        VALUES (?,?,?,?,?,?,?,?)`).run(req.user.id, customerName, email, phone, address, paymentMethod, JSON.stringify(confirmed), total);
      return result.lastInsertRowid;
    });
    const id = tx();
    res.status(201).json({ message:"Order placed successfully.", orderId:id, total });
  } catch (e) { res.status(400).json({ error:e.message || "Could not place order." }); }
});
app.get("/api/orders/mine", auth, (req,res) => {
  const rows = db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC").all(req.user.id);
  res.json(rows.map(r=>({...r,items:JSON.parse(r.items_json)})));
});

// All management routes below require a valid admin token.
app.get("/api/admin/summary", auth, admin, (_req,res) => {
  res.json({
    products:db.prepare("SELECT COUNT(*) n FROM products").get().n,
    orders:db.prepare("SELECT COUNT(*) n FROM orders").get().n,
    customers:db.prepare("SELECT COUNT(*) n FROM users WHERE role='customer'").get().n,
    revenue:db.prepare("SELECT COALESCE(SUM(total),0) n FROM orders WHERE status!='Cancelled'").get().n,
    recentOrders:db.prepare("SELECT id,customer_name,total,status,created_at FROM orders ORDER BY id DESC LIMIT 8").all()
  });
});
app.get("/api/admin/orders", auth, admin, (_req,res) => {
  res.json(db.prepare("SELECT * FROM orders ORDER BY id DESC").all().map(r=>({...r,items:JSON.parse(r.items_json)})));
});
app.patch("/api/admin/orders/:id", auth, admin, (req,res) => {
  const allowed = ["Pending","Processing","Shipped","Completed","Cancelled"];
  const status = req.body?.status;
  if (!allowed.includes(status)) return res.status(400).json({error:"Invalid order status."});
  const order = db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  if (!order) return res.status(404).json({error:"Order not found."});
  if (order.status === status) return res.json({message:"Order status unchanged."});
  try {
    const tx = db.transaction(() => {
      const items = JSON.parse(order.items_json);
      if (status === "Cancelled") {
        for (const item of items) db.prepare("UPDATE products SET stock=stock+? WHERE id=?").run(item.quantity, item.id);
      } else if (order.status === "Cancelled") {
        for (const item of items) {
          const product = db.prepare("SELECT stock FROM products WHERE id=?").get(item.id);
          if (!product || product.stock < item.quantity) throw new Error(`Not enough stock to reopen order #${order.id}.`);
        }
        for (const item of items) db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(item.quantity, item.id);
      }
      db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, order.id);
    });
    tx();
    res.json({message:"Order status updated."});
  } catch (e) { res.status(400).json({error:e.message || "Could not update order status."}); }
});
app.post("/api/admin/products", auth, admin, upload.single("image"), (req,res) => {
  const body = req.body || {};
  const name = clean(body.name);
  const description = clean(body.description);
  const category = clean(body.category) || "General";
  const price = Number(body.price);
  const stock = Number(body.stock ?? 0);
  const imageUrl = safeImageUrl(body.imageUrl);
  const featured = String(body.featured) === "1" ? 1 : 0;
  const valid = name.length >= 2 && name.length <= 120 && description.length <= 2000 && category.length <= 60 &&
    Number.isFinite(price) && price >= 0 && price <= 1e9 &&
    Number.isInteger(stock) && stock >= 0 && stock <= 1e6 && imageUrl !== null;
  if (!valid) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({error:"Enter a valid name, price, whole-number stock and image URL."});
  }
  const image = req.file ? "/uploads/"+req.file.filename : imageUrl;
  const result = db.prepare("INSERT INTO products (name,description,category,price,stock,image,featured) VALUES (?,?,?,?,?,?,?)")
    .run(name,description,category,price,stock,image,featured);
  res.status(201).json(db.prepare("SELECT * FROM products WHERE id=?").get(result.lastInsertRowid));
});
app.patch("/api/admin/products/:id", auth, admin, (req,res) => {
  const p = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if (!p) return res.status(404).json({error:"Product not found."});
  const b = req.body || {};
  const name = b.name === undefined ? p.name : clean(b.name);
  const description = b.description === undefined ? p.description : clean(b.description);
  const category = b.category === undefined ? p.category : clean(b.category);
  const price = b.price === undefined ? p.price : Number(b.price);
  const stock = b.stock === undefined ? p.stock : Number(b.stock);
  const image = b.image === undefined ? p.image : safeImageUrl(b.image);
  const featured = b.featured === undefined ? p.featured : (b.featured ? 1 : 0);
  const valid = name.length >= 2 && name.length <= 120 && description.length <= 2000 && category.length <= 60 &&
    Number.isFinite(price) && price >= 0 && price <= 1e9 &&
    Number.isInteger(stock) && stock >= 0 && stock <= 1e6 && image !== null;
  if (!valid) return res.status(400).json({error:"Enter a valid name, price, whole-number stock and image URL."});
  db.prepare("UPDATE products SET name=?,description=?,category=?,price=?,stock=?,image=?,featured=? WHERE id=?")
    .run(name,description,category,price,stock,image,featured,p.id);
  res.json(db.prepare("SELECT * FROM products WHERE id=?").get(p.id));
});
app.delete("/api/admin/products/:id", auth, admin, (req,res) => {
  const result=db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  if (!result.changes) return res.status(404).json({error:"Product not found."});
  res.json({message:"Product deleted."});
});
app.get("*", (req,res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({error:"API endpoint not found."});
  res.sendFile(path.join(root,"public","index.html"));
});
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "Image must be 5 MB or smaller." : "Image upload failed.";
    return res.status(400).json({ error: message });
  }
  if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});
app.listen(PORT, () => {
  console.log(`Mosey Shop running at http://localhost:${PORT}`);
  if (!process.env.JWT_SECRET) console.warn("[security] JWT_SECRET is not set - using the development secret. Set it in .env before deploying.");
  if (process.env.OPENAI_API_KEY) console.log(`[chat] AI replies enabled (${process.env.OPENAI_MODEL || "gpt-4o-mini"}).`);
  else console.log("[chat] No OPENAI_API_KEY set - using the built-in catalogue assistant (fully functional offline).");
});
