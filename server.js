import express from "express";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import TelegramBot from "node-telegram-bot-api";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

fs.mkdirSync(path.join(__dirname, "public/uploads"), { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(path.join(__dirname, "store.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'READY',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
if (count === 0) {
  const insert = db.prepare(
    "INSERT INTO products (name, price, description, image, status) VALUES (?, ?, ?, ?, ?)"
  );
  insert.run(
    "AKUN GAGAH SG 9 RASA",
    1200000,
    "Akun game siap pakai. Detail akun dapat diubah lewat Telegram.",
    "",
    "READY"
  );
  insert.run(
    "AKUN SPEK PELAJAR",
    200000,
    "Akun harga pelajar.",
    "",
    "READY"
  );
}

app.get("/api/products", (req, res) => {
  res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all());
});

app.post("/api/products", (req, res) => {
  const { name, price, description = "", image = "" } = req.body;
  if (!name || !Number.isFinite(Number(price))) {
    return res.status(400).json({ error: "Nama dan harga wajib diisi." });
  }
  const result = db.prepare(
    "INSERT INTO products (name, price, description, image, status) VALUES (?, ?, ?, ?, 'READY')"
  ).run(name, Number(price), description, image);
  res.json({ id: result.lastInsertRowid });
});

app.patch("/api/products/:id", (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare("SELECT * FROM products WHERE id=?").get(id);
  if (!old) return res.status(404).json({ error: "Produk tidak ditemukan." });

  const next = {
    name: req.body.name ?? old.name,
    price: req.body.price ?? old.price,
    description: req.body.description ?? old.description,
    image: req.body.image ?? old.image,
    status: req.body.status ?? old.status
  };

  db.prepare(`
    UPDATE products
    SET name=?, price=?, description=?, image=?, status=?
    WHERE id=?
  `).run(next.name, Number(next.price), next.description, next.image, next.status, id);

  res.json({ ok: true });
});

app.delete("/api/products/:id", (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM products WHERE id=?").run(id);
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, "public/uploads"),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `product-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 8 * 1024 * 1024 }
});

app.post("/api/upload/:id", upload.single("image"), (req, res) => {
  const id = Number(req.params.id);
  if (!req.file) return res.status(400).json({ error: "Foto tidak ditemukan." });
  const image = `/uploads/${req.file.filename}`;
  db.prepare("UPDATE products SET image=? WHERE id=?").run(image, id);
  res.json({ ok: true, image });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminId = String(process.env.ADMIN_TELEGRAM_ID || "");

let bot = null;

function rupiah(n) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(n);
}

function isAdmin(msg) {
  return String(msg.from?.id || "") === adminId && adminId !== "";
}

function helpText() {
  return [
    "🤖 AGAKII STORE CONTROL",
    "",
    "/stok — lihat semua produk",
    "/soldout ID — ubah jadi SOLD OUT",
    "/ready ID — ubah jadi READY",
    "/harga ID NOMINAL — ubah harga",
    "/nama ID Nama Baru — ubah nama",
    "/deskripsi ID teks — ubah deskripsi",
    "/hapus ID — hapus produk",
    "/tambah Nama | Harga | Deskripsi — tambah produk",
    "",
    "Untuk mengganti foto: kirim foto dengan caption:",
    "/foto ID"
  ].join("\n");
}

if (token && !token.startsWith("ISI_")) {
  bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, async (msg) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    bot.sendMessage(msg.chat.id, helpText());
  });

  bot.onText(/\/help/, async (msg) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    bot.sendMessage(msg.chat.id, helpText());
  });

  bot.onText(/\/stok/, async (msg) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    const rows = db.prepare("SELECT * FROM products ORDER BY id ASC").all();
    if (!rows.length) return bot.sendMessage(msg.chat.id, "Belum ada stok.");
    const text = rows.map(p =>
      `#${p.id} ${p.name}\n${rupiah(p.price)} — ${p.status}`
    ).join("\n\n");
    bot.sendMessage(msg.chat.id, "📦 STOK AGAKII STORE\n\n" + text);
  });

  bot.onText(/\/(soldout|ready)\s+(\d+)/, async (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    const id = Number(match[2]);
    const status = match[1] === "soldout" ? "SOLD OUT" : "READY";
    const result = db.prepare("UPDATE products SET status=? WHERE id=?").run(status, id);
    bot.sendMessage(
      msg.chat.id,
      result.changes ? `✅ Produk #${id} → ${status}` : "❌ Produk tidak ditemukan."
    );
  });

  bot.onText(/\/harga\s+(\d+)\s+(\d+)/, async (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    const id = Number(match[1]);
    const price = Number(match[2]);
    const result = db.prepare("UPDATE products SET price=? WHERE id=?").run(price, id);
    bot.sendMessage(
      msg.chat.id,
      result.changes ? `✅ Harga #${id} → ${rupiah(price)}` : "❌ Produk tidak ditemukan."
    );
  });

  bot.onText(/\/nama\s+(\d+)\s+(.+)/, async (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    const id = Number(match[1]);
    const name = match[2].trim();
    const result = db.prepare("UPDATE products SET name=? WHERE id=?").run(name, id);
    bot.sendMessage(
      msg.chat.id,
      result.changes ? `✅ Nama #${id} diubah.` : "❌ Produk tidak ditemukan."
    );
  });

  bot.onText(/\/deskripsi\s+(\d+)\s+([\s\S]+)/, async (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    const id = Number(match[1]);
    const description = match[2].trim();
    const result = db.prepare("UPDATE products SET description=? WHERE id=?").run(description, id);
    bot.sendMessage(
      msg.chat.id,
      result.changes ? `✅ Deskripsi #${id} diubah.` : "❌ Produk tidak ditemukan."
    );
  });

  bot.onText(/\/hapus\s+(\d+)/, async (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    const id = Number(match[1]);
    const result = db.prepare("DELETE FROM products WHERE id=?").run(id);
    bot.sendMessage(
      msg.chat.id,
      result.changes ? `🗑️ Produk #${id} dihapus.` : "❌ Produk tidak ditemukan."
    );
  });

  bot.onText(/\/tambah\s+(.+)/, async (msg, match) => {
    if (!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "⛔ Akses ditolak.");
    const parts = match[1].split("|").map(x => x.trim());
    if (parts.length < 2) {
      return bot.sendMessage(msg.chat.id, "Format: /tambah Nama | Harga | Deskripsi");
    }
    const [name, price, description = ""] = parts;
    if (!Number.isFinite(Number(price))) {
      return bot.sendMessage(msg.chat.id, "Harga harus berupa angka.");
    }
    const result = db.prepare(
      "INSERT INTO products (name, price, description, status) VALUES (?, ?, ?, 'READY')"
    ).run(name, Number(price), description);
    bot.sendMessage(msg.chat.id, `✅ Produk ditambahkan dengan ID #${result.lastInsertRowid}`);
  });

  bot.on("photo", async (msg) => {
    if (!isAdmin(msg)) return;
    const caption = msg.caption || "";
    const match = caption.match(/^\/foto\s+(\d+)/);
    if (!match) return bot.sendMessage(msg.chat.id, "Caption foto: /foto ID");

    const id = Number(match[1]);
    const product = db.prepare("SELECT * FROM products WHERE id=?").get(id);
    if (!product) return bot.sendMessage(msg.chat.id, "❌ Produk tidak ditemukan.");

    try {
      const photos = msg.photo;
      const largest = photos[photos.length - 1];
      const file = await bot.getFile(largest.file_id);
      const ext = path.extname(file.file_path || "") || ".jpg";
      const filename = `product-${id}-${Date.now()}${ext}`;
      const dest = path.join(__dirname, "public/uploads", filename);
      await bot.downloadFile(largest.file_id, path.join(__dirname, "public/uploads"));
      const downloaded = path.join(__dirname, "public/uploads", path.basename(file.file_path));
      if (fs.existsSync(downloaded)) fs.renameSync(downloaded, dest);
      db.prepare("UPDATE products SET image=? WHERE id=?").run(`/uploads/${filename}`, id);
      bot.sendMessage(msg.chat.id, `🖼️ Foto produk #${id} berhasil diganti.`);
    } catch (e) {
      bot.sendMessage(msg.chat.id, "❌ Gagal menyimpan foto.");
    }
  });
}

app.listen(PORT, () => {
  console.log(`AGAKII STORE running on http://localhost:${PORT}`);
  if (!bot) console.log("Telegram bot belum aktif: isi TELEGRAM_BOT_TOKEN dan ADMIN_TELEGRAM_ID.");
});
