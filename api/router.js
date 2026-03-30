const crypto = require("crypto");
const {
  defaultConfig,
  sanitizeConfig,
  ensureSchema,
  getConfig,
  updateConfig,
  listMenu,
  createMenu,
  updateMenu,
  deleteMenu,
  listOrders,
  createOrder,
  updateOrder,
  getPublicOrderStatuses,
  exportAll,
  importAll,
  getBootstrap,
  getAdminBootstrap,
  useDatabase
} = require("../lib/store");

const SESSION_MAX_AGE = 60 * 60 * 24 * 7;
const SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "web-order-demo-secret";

function sendJson(res, statusCode, data, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Storage-Mode", useDatabase ? "postgres" : "json-fallback");
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let data = "";
  for await (const chunk of req) data += chunk;
  return data ? JSON.parse(data) : {};
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(amount);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return raw.split(";").reduce((result, chunk) => {
    const [key, ...value] = chunk.trim().split("=");
    if (!key) return result;
    result[key] = decodeURIComponent(value.join("="));
    return result;
  }, {});
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  if (typeof header !== "string") return "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function signSessionPayload(payload, config) {
  const secret = crypto
    .createHash("sha256")
    .update(`${SESSION_SECRET}:${config.admin_username || defaultConfig.admin_username}:${config.admin_password || defaultConfig.admin_password}`)
    .digest("hex");
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function createAdminSessionToken(username, config) {
  const payload = Buffer.from(JSON.stringify({
    username,
    exp: Date.now() + SESSION_MAX_AGE * 1000
  })).toString("base64url");
  const signature = signSessionPayload(payload, config);
  return `${payload}.${signature}`;
}

function verifyAdminSessionToken(token, config) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expectedSignature = signSessionPayload(payload, config);
  if (signature.length !== expectedSignature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (!parsed.exp || parsed.exp < Date.now()) return null;
  return { username: parsed.username };
}

async function getAdminSession(req) {
  const token = getBearerToken(req) || parseCookies(req).admin_session;
  if (!token) return null;
  const config = await getConfig({ includeSecrets: true, includePassword: true });
  return verifyAdminSessionToken(token, config);
}

function validateTelegramConfig(config) {
  const token = String(config.telegram_bot_token || "").trim();
  const chatId = String(config.telegram_owner_chat_id || "").trim();
  if (!token) return "Bot Token Telegram belum diisi.";
  if (token.includes("t.me/") || token.startsWith("@")) {
    return "Bot Token Telegram tidak boleh berupa link atau username bot. Masukkan token asli dari BotFather.";
  }
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) {
    return "Format Bot Token Telegram tidak valid. Ambil token asli dari BotFather.";
  }
  if (!chatId) return "Owner Chat ID Telegram belum diisi.";
  if (!/^-?\d{5,}$/.test(chatId)) {
    return "Format Owner Chat ID Telegram tidak valid.";
  }
  return "";
}

async function notifyTelegram(order, config) {
  const telegramConfigError = validateTelegramConfig(config);
  if (telegramConfigError) throw new Error(telegramConfigError);
  const paymentStatusMap = {
    unpaid: "Belum Bayar",
    pending_verification: "Menunggu Verifikasi",
    paid: "Lunas",
    failed: "Gagal"
  };
  const paymentMethodMap = {
    cash: "Cash",
    transfer: "Transfer Bank",
    qris: "QRIS"
  };
  const orderTypeLabel = order.order_type === "dine-in" ? "Dine-in" : "Delivery";
  const locationLabel = order.order_type === "dine-in" ? "Meja" : "Alamat";
  const paymentStatusLabel = paymentStatusMap[order.payment_status] || order.payment_status || "Belum Bayar";
  const notes = String(order.special_notes || "").trim();
  const itemLines = (order.items || []).map(item => {
    const quantity = Number(item.quantity || 0);
    const subtotal = Number(item.subtotal || 0);
    return `• ${escapeHtml(item.name)} x${quantity} — ${escapeHtml(formatCurrency(subtotal))}`;
  }).join("\n");

  const text = [
    "🔔 <b>Pesanan Baru Masuk!</b>",
    "",
    `📦 <b>Order ID:</b> <code>${escapeHtml(order.order_number)}</code>`,
    `🧑 <b>Nama Pelanggan:</b> ${escapeHtml(order.customer_name)}`,
    `🍽️ <b>Tipe Pesanan:</b> ${escapeHtml(orderTypeLabel)}`,
    `📍 <b>${locationLabel}:</b> ${escapeHtml(order.customer_address)}`,
    `📞 <b>Kontak:</b> ${escapeHtml(order.customer_phone)}`,
    "",
    "────────────────",
    "",
    "💳 <b>Pembayaran</b>",
    `• Metode: ${escapeHtml(paymentMethodMap[order.payment_method] || order.payment_method || "-")}`,
    `• Status: ⏳ <i>${escapeHtml(paymentStatusLabel)}</i>`,
    "",
    "────────────────",
    "",
    "🧾 <b>Detail Pesanan</b>",
    itemLines || "• Tidak ada item",
    "",
    "────────────────",
    "",
    "💰 <b>Total Pembayaran</b>",
    `<b>${escapeHtml(formatCurrency(Number(order.total || 0)))}</b>`,
    "",
    "────────────────"
  ];

  if (notes) {
    text.push("", "✨ <b>Catatan:</b>", escapeHtml(notes), "", "────────────────");
  }

  text.push("", "🚀 <b>Catatan:</b>", "Segera proses pesanan dan konfirmasi pembayaran ya agar layanan tetap cepat & rapi.");

  const response = await fetch(`https://api.telegram.org/bot${config.telegram_bot_token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.telegram_owner_chat_id,
      text: text.join("\n"),
      parse_mode: "HTML"
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 400 && errorText.includes("chat not found")) {
      throw new Error("Chat ID tidak ditemukan. Pastikan akun owner sudah memulai chat dengan bot Telegram.");
    }
    if (response.status === 401) {
      throw new Error("Bot Token Telegram tidak valid.");
    }
    throw new Error(`Telegram error: ${response.status} ${errorText}`);
  }

  return response.json();
}

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const rewrittenPath = url.searchParams.get("path");
    const pathname = rewrittenPath ? `/api/${rewrittenPath.replace(/^\/+/, "")}` : url.pathname;
    const method = req.method;

    if (pathname === "/api/admin/login" && method === "POST") {
      const body = await readBody(req);
      const config = await getConfig({ includeSecrets: true, includePassword: true });
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      if (username !== config.admin_username || password !== config.admin_password) {
        return sendJson(res, 401, { error: "Username atau password salah" });
      }
      const token = createAdminSessionToken(username, config);
      const secureFlag = process.env.VERCEL ? "; Secure" : "";
      return sendJson(res, 200, { ok: true, username, token }, {
        "Set-Cookie": `admin_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax${secureFlag}`
      });
    }

    if (pathname === "/api/admin/logout" && method === "POST") {
      const secureFlag = process.env.VERCEL ? "; Secure" : "";
      return sendJson(res, 200, { ok: true }, {
        "Set-Cookie": `admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag}`
      });
    }

    if (pathname === "/api/admin/session" && method === "GET") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { authenticated: false });
      return sendJson(res, 200, { authenticated: true, username: session.username });
    }

    if (pathname === "/api/bootstrap" && method === "GET") {
      return sendJson(res, 200, await getBootstrap());
    }

    if (pathname === "/api/admin/bootstrap" && method === "GET") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      return sendJson(res, 200, await getAdminBootstrap());
    }

    if (pathname === "/api/menu" && method === "GET") {
      return sendJson(res, 200, await listMenu());
    }

    if (pathname === "/api/menu" && method === "POST") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      return sendJson(res, 201, await createMenu(await readBody(req)));
    }

    if (pathname.startsWith("/api/menu/")) {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      const id = Number(pathname.split("/").pop());
      if (method === "PUT") {
        const updated = await updateMenu(id, await readBody(req));
        if (!updated) return sendJson(res, 404, { error: "Menu tidak ditemukan" });
        return sendJson(res, 200, updated);
      }
      if (method === "DELETE") {
        const removed = await deleteMenu(id);
        if (!removed) return sendJson(res, 404, { error: "Menu tidak ditemukan" });
        return sendJson(res, 200, removed);
      }
    }

    if (pathname === "/api/config" && method === "GET") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      return sendJson(res, 200, await getConfig({ includeSecrets: true }));
    }

    if (pathname === "/api/config" && method === "PUT") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      return sendJson(res, 200, await updateConfig(await readBody(req)));
    }

    if (pathname === "/api/orders" && method === "GET") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      return sendJson(res, 200, await listOrders());
    }

    if (pathname === "/api/orders" && method === "POST") {
      const result = await createOrder(await readBody(req));
      try {
        const config = await getConfig({ includeSecrets: true, includePassword: true });
        await notifyTelegram(result.order, config);
      } catch (error) {
        console.error("Telegram notify failed:", error.message);
      }
      return sendJson(res, 201, result);
    }

    if (pathname === "/api/orders/public-status" && method === "GET") {
      const numbers = String(url.searchParams.get("numbers") || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
      return sendJson(res, 200, await getPublicOrderStatuses(numbers));
    }

    if (pathname.startsWith("/api/orders/") && method === "PUT") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      const updated = await updateOrder(pathname.split("/").pop(), await readBody(req));
      if (!updated) return sendJson(res, 404, { error: "Pesanan tidak ditemukan" });
      return sendJson(res, 200, updated);
    }

    if (pathname === "/api/telegram/test" && method === "POST") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      try {
        const config = await getConfig({ includeSecrets: true, includePassword: true });
        await notifyTelegram({
          order_number: "TEST-ORDER",
          customer_name: "Tes Owner",
          order_type: "delivery",
          customer_phone: "08123456789",
          customer_address: "Alamat tes",
          payment_method: "cash",
          payment_status: "unpaid",
          total: 0,
          items: [{ name: "Pesan uji", quantity: 1, subtotal: 0 }]
        }, config);
        return sendJson(res, 200, { ok: true });
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: error.message });
      }
    }

    if (pathname === "/api/admin/export" && method === "GET") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      return sendJson(res, 200, await exportAll());
    }

    if (pathname === "/api/admin/import" && method === "POST") {
      const session = await getAdminSession(req);
      if (!session) return sendJson(res, 401, { error: "Unauthorized" });
      return sendJson(res, 200, await importAll(await readBody(req)));
    }

    return sendJson(res, 404, { error: "Endpoint tidak ditemukan" });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: error.message || "Terjadi kesalahan server" });
  }
};
