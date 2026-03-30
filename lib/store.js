const fs = require("fs/promises");
const path = require("path");
const { defaultConfig, defaultMenu } = require("./defaults");

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.STORAGE_URL ||
  process.env.STORAGE_PRISMA_URL ||
  process.env.STORAGE_URL_NON_POOLING ||
  "";
const useDatabase = Boolean(databaseUrl);

let PoolCtor = null;
if (useDatabase) {
  ({ Pool: PoolCtor } = require("pg"));
}

const pool = useDatabase
  ? new PoolCtor({
      connectionString: databaseUrl,
      ssl: (process.env.POSTGRES_URL || process.env.STORAGE_URL) ? { rejectUnauthorized: false } : undefined
    })
  : null;

const ROOT = process.cwd();
const DATA_DIR = process.env.VERCEL ? path.join("/tmp", "web-order-demo-data") : path.join(ROOT, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const MENU_FILE = path.join(DATA_DIR, "menu.json");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");

let schemaReady = false;
let schemaReadyPromise = null;

const legacyDemoMenuSignatures = new Set([
  "1:Nasi Goreng Spesial",
  "2:Rendang Daging",
  "3:Soto Ayam",
  "4:Bakso Spesial",
  "5:Iced Tea Lemon",
  "6:Jus Mangga",
  "7:Kopi Arabika",
  "8:Es Cendol",
  "9:Brownies Kukus"
]);

function sanitizeMenuItem(item, index) {
  return {
    id: Number(item.id) || index + 1,
    name: String(item.name || `Menu ${index + 1}`),
    category: item.category || "makanan",
    price: Number(item.price || 0),
    desc: item.desc || "Menu rumah makan yang siap dipesan.",
    badge: item.badge || "",
    icon: item.icon || "image",
    image: item.image || "",
    stock: Math.max(0, Number(item.stock ?? 0)),
    variants: Array.isArray(item.variants) && item.variants.length
      ? item.variants
      : [{ name: "Pilihan", options: [{ label: "Standar", price: 0 }] }]
  };
}

function sanitizeOrder(order) {
  return {
    ...order,
    payment_status: order.payment_status || (order.payment_method === "cash" ? "unpaid" : "pending_verification"),
    items: Array.isArray(order.items) ? order.items : []
  };
}

function sanitizeConfig(config, { includeSecrets = false, includePassword = false } = {}) {
  return {
    restaurant_name: config.restaurant_name || defaultConfig.restaurant_name,
    restaurant_address: config.restaurant_address || defaultConfig.restaurant_address,
    restaurant_phone: config.restaurant_phone || defaultConfig.restaurant_phone,
    delivery_fee: Number(config.delivery_fee ?? defaultConfig.delivery_fee),
    free_delivery_minimum: Number(config.free_delivery_minimum ?? defaultConfig.free_delivery_minimum),
    telegram_bot_token: includeSecrets ? (config.telegram_bot_token || "") : "",
    telegram_owner_chat_id: includeSecrets ? (config.telegram_owner_chat_id || "") : "",
    admin_username: includeSecrets ? (config.admin_username || defaultConfig.admin_username) : "",
    admin_password: includePassword ? (config.admin_password || defaultConfig.admin_password) : ""
  };
}

function isLegacyDemoMenu(items) {
  if (!Array.isArray(items) || !items.length) return false;
  return items.every(item => legacyDemoMenuSignatures.has(`${Number(item.id)}:${String(item.name || "")}`));
}

async function ensureFile(filePath, fallback) {
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(fallback, null, 2));
  }
}

async function readJson(filePath, fallback) {
  await ensureFile(filePath, fallback);
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function mapMenuRow(row, index) {
  return sanitizeMenuItem({
    id: row.id,
    name: row.name,
    category: row.category,
    price: row.price,
    desc: row.description,
    badge: row.badge,
    icon: row.icon,
    image: row.image,
    stock: row.stock,
    variants: row.variants || []
  }, index);
}

function mapOrderRow(row) {
  return sanitizeOrder({
    id: row.id,
    __backendId: String(row.id),
    order_number: row.order_number,
    customer_name: row.customer_name,
    customer_phone: row.customer_phone,
    customer_address: row.customer_address,
    special_notes: row.special_notes,
    items: row.items || [],
    subtotal: Number(row.subtotal || 0),
    delivery_fee: Number(row.delivery_fee || 0),
    total: Number(row.total || 0),
    payment_method: row.payment_method,
    payment_status: row.payment_status,
    order_type: row.order_type,
    status: row.status,
    created_at: row.created_at
  });
}

async function ensureSchema() {
  if (!useDatabase) return;
  if (schemaReady) return;
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_config (
          id INTEGER PRIMARY KEY,
          restaurant_name TEXT NOT NULL,
          restaurant_address TEXT NOT NULL,
          restaurant_phone TEXT NOT NULL,
          delivery_fee INTEGER NOT NULL DEFAULT 10000,
          free_delivery_minimum INTEGER NOT NULL DEFAULT 100000,
          telegram_bot_token TEXT NOT NULL DEFAULT '',
          telegram_owner_chat_id TEXT NOT NULL DEFAULT '',
          admin_username TEXT NOT NULL DEFAULT 'owner',
          admin_password TEXT NOT NULL DEFAULT 'admin123',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS menus (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          price INTEGER NOT NULL,
          description TEXT NOT NULL,
          badge TEXT NOT NULL DEFAULT '',
          icon TEXT NOT NULL DEFAULT 'image',
          image TEXT NOT NULL DEFAULT '',
          stock INTEGER NOT NULL DEFAULT 0,
          variants JSONB NOT NULL DEFAULT '[]'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS orders (
          id BIGINT PRIMARY KEY,
          order_number TEXT NOT NULL UNIQUE,
          customer_name TEXT NOT NULL,
          customer_phone TEXT NOT NULL,
          customer_address TEXT NOT NULL,
          special_notes TEXT NOT NULL DEFAULT '',
          items JSONB NOT NULL DEFAULT '[]'::jsonb,
          subtotal INTEGER NOT NULL DEFAULT 0,
          delivery_fee INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL,
          payment_status TEXT NOT NULL,
          order_type TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      await pool.query(
        `INSERT INTO app_config (
          id, restaurant_name, restaurant_address, restaurant_phone, delivery_fee, free_delivery_minimum,
          telegram_bot_token, telegram_owner_chat_id, admin_username, admin_password
        ) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (id) DO NOTHING`,
        [
          defaultConfig.restaurant_name,
          defaultConfig.restaurant_address,
          defaultConfig.restaurant_phone,
          defaultConfig.delivery_fee,
          defaultConfig.free_delivery_minimum,
          defaultConfig.telegram_bot_token,
          defaultConfig.telegram_owner_chat_id,
          defaultConfig.admin_username,
          defaultConfig.admin_password
        ]
      );

      const { rows: currentMenus } = await pool.query("SELECT id, name FROM menus ORDER BY id ASC");
      if (isLegacyDemoMenu(currentMenus)) {
        await pool.query("DELETE FROM menus");
      }

      for (const [index, item] of defaultMenu.entries()) {
        const menu = sanitizeMenuItem(item, index);
        await pool.query(
          `INSERT INTO menus (id, name, category, price, description, badge, icon, image, stock, variants)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           ON CONFLICT (id) DO NOTHING`,
          [
            menu.id,
            menu.name,
            menu.category,
            menu.price,
            menu.desc,
            menu.badge,
            menu.icon,
            menu.image,
            menu.stock,
            JSON.stringify(menu.variants)
          ]
        );
      }

      schemaReady = true;
    })();
  }
  await schemaReadyPromise;
}

async function getConfig(options = {}) {
  if (useDatabase) {
    await ensureSchema();
    const { rows } = await pool.query("SELECT * FROM app_config WHERE id = 1");
    return sanitizeConfig(rows[0] || defaultConfig, options);
  }
  return sanitizeConfig(await readJson(CONFIG_FILE, defaultConfig), options);
}

async function updateConfig(nextConfig) {
  if (useDatabase) {
    await ensureSchema();
    const current = await getConfig({ includeSecrets: true, includePassword: true });
    const merged = sanitizeConfig({ ...current, ...nextConfig }, { includeSecrets: true, includePassword: true });
    const { rows } = await pool.query(
      `UPDATE app_config
       SET restaurant_name = $1, restaurant_address = $2, restaurant_phone = $3, delivery_fee = $4,
           free_delivery_minimum = $5, telegram_bot_token = $6, telegram_owner_chat_id = $7,
           admin_username = $8, admin_password = $9, updated_at = NOW()
       WHERE id = 1
       RETURNING *`,
      [
        merged.restaurant_name,
        merged.restaurant_address,
        merged.restaurant_phone,
        merged.delivery_fee,
        merged.free_delivery_minimum,
        merged.telegram_bot_token,
        merged.telegram_owner_chat_id,
        merged.admin_username,
        merged.admin_password,
      ]
    );
    return sanitizeConfig(rows[0], { includeSecrets: true });
  }

  const current = await getConfig({ includeSecrets: true, includePassword: true });
  const merged = sanitizeConfig({ ...current, ...nextConfig }, { includeSecrets: true, includePassword: true });
  await writeJson(CONFIG_FILE, merged);
  return sanitizeConfig(merged, { includeSecrets: true });
}

async function listMenu() {
  if (useDatabase) {
    await ensureSchema();
    const { rows } = await pool.query("SELECT * FROM menus ORDER BY id ASC");
    return rows.map(mapMenuRow);
  }
  const menu = await readJson(MENU_FILE, defaultMenu);
  if (isLegacyDemoMenu(menu)) {
    await writeJson(MENU_FILE, []);
    return [];
  }
  return menu.map(sanitizeMenuItem);
}

async function createMenu(payload) {
  const menu = await listMenu();
  const nextId = menu.length ? Math.max(...menu.map(item => item.id)) + 1 : 1;
  const nextItem = sanitizeMenuItem({ ...payload, id: nextId }, menu.length);
  if (useDatabase) {
    await ensureSchema();
    const { rows } = await pool.query(
      `INSERT INTO menus (id, name, category, price, description, badge, icon, image, stock, variants, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
       RETURNING *`,
      [
        nextItem.id,
        nextItem.name,
        nextItem.category,
        nextItem.price,
        nextItem.desc,
        nextItem.badge,
        nextItem.icon,
        nextItem.image,
        nextItem.stock,
        JSON.stringify(nextItem.variants)
      ]
    );
    return mapMenuRow(rows[0], 0);
  }
  menu.unshift(nextItem);
  await writeJson(MENU_FILE, menu);
  return nextItem;
}

async function updateMenu(id, payload) {
  const menu = await listMenu();
  const index = menu.findIndex(item => item.id === Number(id));
  if (index === -1) return null;
  const nextItem = sanitizeMenuItem({ ...menu[index], ...payload, id: Number(id) }, index);
  if (useDatabase) {
    await ensureSchema();
    const { rows } = await pool.query(
      `UPDATE menus
       SET name = $2, category = $3, price = $4, description = $5, badge = $6, icon = $7, image = $8,
           stock = $9, variants = $10::jsonb, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        nextItem.id,
        nextItem.name,
        nextItem.category,
        nextItem.price,
        nextItem.desc,
        nextItem.badge,
        nextItem.icon,
        nextItem.image,
        nextItem.stock,
        JSON.stringify(nextItem.variants)
      ]
    );
    return mapMenuRow(rows[0], index);
  }
  menu[index] = nextItem;
  await writeJson(MENU_FILE, menu);
  return nextItem;
}

async function deleteMenu(id) {
  const menu = await listMenu();
  const index = menu.findIndex(item => item.id === Number(id));
  if (index === -1) return null;
  const removed = menu[index];
  if (useDatabase) {
    await ensureSchema();
    await pool.query("DELETE FROM menus WHERE id = $1", [Number(id)]);
    return removed;
  }
  menu.splice(index, 1);
  await writeJson(MENU_FILE, menu);
  return removed;
}

async function listOrders() {
  if (useDatabase) {
    await ensureSchema();
    const { rows } = await pool.query("SELECT * FROM orders ORDER BY created_at DESC, id DESC");
    return rows.map(mapOrderRow);
  }
  return (await readJson(ORDERS_FILE, [])).map(sanitizeOrder);
}

async function createOrder(payload) {
  if (useDatabase) {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: menuRows } = await client.query("SELECT * FROM menus ORDER BY id ASC FOR UPDATE");
      const menu = menuRows.map(mapMenuRow);
      for (const cartItem of payload.items || []) {
        const menuItem = menu.find(item => item.id === Number(cartItem.menuId));
        if (!menuItem) throw new Error(`Menu ${cartItem.name} tidak ditemukan`);
        if (Number(cartItem.quantity || 0) > menuItem.stock) {
          throw new Error(`Stok ${menuItem.name} tidak mencukupi`);
        }
      }

      for (const cartItem of payload.items || []) {
        const menuItem = menu.find(item => item.id === Number(cartItem.menuId));
        menuItem.stock = Math.max(0, menuItem.stock - Number(cartItem.quantity || 0));
        await client.query("UPDATE menus SET stock = $2, updated_at = NOW() WHERE id = $1", [menuItem.id, menuItem.stock]);
      }

      const now = Number(payload.id || Date.now());
      const order = sanitizeOrder({
        ...payload,
        id: now,
        __backendId: String(now),
        status: payload.status || "pending",
        payment_status: payload.payment_status || (payload.payment_method === "cash" ? "unpaid" : "pending_verification"),
        created_at: payload.created_at || new Date().toISOString()
      });

      await client.query(
        `INSERT INTO orders (
          id, order_number, customer_name, customer_phone, customer_address, special_notes, items,
          subtotal, delivery_fee, total, payment_method, payment_status, order_type, status, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          order.id,
          order.order_number,
          order.customer_name,
          order.customer_phone,
          order.customer_address,
          order.special_notes || "",
          JSON.stringify(order.items || []),
          Number(order.subtotal || 0),
          Number(order.delivery_fee || 0),
          Number(order.total || 0),
          order.payment_method,
          order.payment_status,
          order.order_type,
          order.status,
          order.created_at
        ]
      );

      await client.query("COMMIT");
      const updatedMenu = menuRows.map((row, index) => mapMenuRow({ ...row, stock: menu.find(item => item.id === row.id)?.stock ?? row.stock }, index));
      return { order, menu: updatedMenu };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  const [orders, menu] = await Promise.all([readJson(ORDERS_FILE, []), listMenu()]);
  for (const cartItem of payload.items || []) {
    const menuItem = menu.find(item => item.id === cartItem.menuId);
    if (!menuItem) throw new Error(`Menu ${cartItem.name} tidak ditemukan`);
    if (cartItem.quantity > menuItem.stock) throw new Error(`Stok ${menuItem.name} tidak mencukupi`);
  }
  for (const cartItem of payload.items || []) {
    const menuItem = menu.find(item => item.id === cartItem.menuId);
    menuItem.stock = Math.max(0, menuItem.stock - Number(cartItem.quantity || 0));
  }
  const now = Number(payload.id || Date.now());
  const order = sanitizeOrder({
    ...payload,
    id: now,
    __backendId: String(now),
    status: payload.status || "pending",
    payment_status: payload.payment_status || (payload.payment_method === "cash" ? "unpaid" : "pending_verification"),
    created_at: payload.created_at || new Date().toISOString()
  });
  orders.unshift(order);
  await Promise.all([writeJson(ORDERS_FILE, orders), writeJson(MENU_FILE, menu)]);
  return { order, menu };
}

async function updateOrder(id, payload) {
  if (useDatabase) {
    await ensureSchema();
    const { rows } = await pool.query(
      `UPDATE orders
       SET customer_name = COALESCE($2, customer_name),
           customer_phone = COALESCE($3, customer_phone),
           customer_address = COALESCE($4, customer_address),
           special_notes = COALESCE($5, special_notes),
           items = COALESCE($6::jsonb, items),
           subtotal = COALESCE($7, subtotal),
           delivery_fee = COALESCE($8, delivery_fee),
           total = COALESCE($9, total),
           payment_method = COALESCE($10, payment_method),
           payment_status = COALESCE($11, payment_status),
           order_type = COALESCE($12, order_type),
           status = COALESCE($13, status)
       WHERE id = $1
       RETURNING *`,
      [
        String(id),
        payload.customer_name ?? null,
        payload.customer_phone ?? null,
        payload.customer_address ?? null,
        payload.special_notes ?? null,
        payload.items ? JSON.stringify(payload.items) : null,
        payload.subtotal ?? null,
        payload.delivery_fee ?? null,
        payload.total ?? null,
        payload.payment_method ?? null,
        payload.payment_status ?? null,
        payload.order_type ?? null,
        payload.status ?? null
      ]
    );
    return rows[0] ? mapOrderRow(rows[0]) : null;
  }
  const orders = await listOrders();
  const index = orders.findIndex(order => String(order.__backendId || order.id) === String(id));
  if (index === -1) return null;
  orders[index] = sanitizeOrder({ ...orders[index], ...payload });
  await writeJson(ORDERS_FILE, orders);
  return orders[index];
}

async function getPublicOrderStatuses(numbers) {
  const orderNumbers = numbers.filter(Boolean);
  if (useDatabase) {
    await ensureSchema();
    const { rows } = await pool.query(
      "SELECT order_number, status, payment_status, total, created_at FROM orders WHERE order_number = ANY($1::text[]) ORDER BY created_at DESC",
      [orderNumbers]
    );
    return rows.map(row => ({
      order_number: row.order_number,
      status: row.status,
      payment_status: row.payment_status,
      total: Number(row.total || 0),
      created_at: row.created_at
    }));
  }
  const orders = await listOrders();
  return orders
    .filter(order => orderNumbers.includes(order.order_number))
    .map(order => ({
      order_number: order.order_number,
      status: order.status,
      payment_status: order.payment_status,
      total: order.total,
      created_at: order.created_at
    }));
}

async function exportAll() {
  const [config, menu, orders] = await Promise.all([
    getConfig({ includeSecrets: true, includePassword: true }),
    listMenu(),
    listOrders()
  ]);
  return {
    exported_at: new Date().toISOString(),
    config,
    menu,
    orders
  };
}

async function importAll(payload) {
  const nextConfig = sanitizeConfig(payload.config || defaultConfig, { includeSecrets: true, includePassword: true });
  const nextMenu = (payload.menu || []).map(sanitizeMenuItem);
  const nextOrders = (payload.orders || []).map(sanitizeOrder);

  if (useDatabase) {
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM orders");
      await client.query("DELETE FROM menus");
      await client.query("DELETE FROM app_config WHERE id = 1");

      await client.query(
        `INSERT INTO app_config (
          id, restaurant_name, restaurant_address, restaurant_phone, delivery_fee, free_delivery_minimum,
          telegram_bot_token, telegram_owner_chat_id, admin_username, admin_password
        ) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          nextConfig.restaurant_name,
          nextConfig.restaurant_address,
          nextConfig.restaurant_phone,
          nextConfig.delivery_fee,
          nextConfig.free_delivery_minimum,
          nextConfig.telegram_bot_token,
          nextConfig.telegram_owner_chat_id,
          nextConfig.admin_username,
          nextConfig.admin_password
        ]
      );

      for (const item of nextMenu) {
        await client.query(
          `INSERT INTO menus (id, name, category, price, description, badge, icon, image, stock, variants)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            item.id,
            item.name,
            item.category,
            item.price,
            item.desc,
            item.badge,
            item.icon,
            item.image,
            item.stock,
            JSON.stringify(item.variants)
          ]
        );
      }

      for (const order of nextOrders) {
        await client.query(
          `INSERT INTO orders (
            id, order_number, customer_name, customer_phone, customer_address, special_notes, items,
            subtotal, delivery_fee, total, payment_method, payment_status, order_type, status, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            order.id,
            order.order_number,
            order.customer_name,
            order.customer_phone,
            order.customer_address,
            order.special_notes || "",
            JSON.stringify(order.items || []),
            Number(order.subtotal || 0),
            Number(order.delivery_fee || 0),
            Number(order.total || 0),
            order.payment_method,
            order.payment_status,
            order.order_type,
            order.status,
            order.created_at
          ]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return { ok: true };
  }

  await Promise.all([
    writeJson(CONFIG_FILE, nextConfig),
    writeJson(MENU_FILE, nextMenu),
    writeJson(ORDERS_FILE, nextOrders)
  ]);
  return { ok: true };
}

async function getBootstrap() {
  const [config, menu] = await Promise.all([getConfig(), listMenu()]);
  return { config, menu };
}

async function getAdminBootstrap() {
  const [config, menu, orders] = await Promise.all([
    getConfig({ includeSecrets: true }),
    listMenu(),
    listOrders()
  ]);
  return { config, menu, orders };
}

module.exports = {
  useDatabase,
  defaultConfig,
  defaultMenu,
  sanitizeConfig,
  sanitizeMenuItem,
  sanitizeOrder,
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
  getAdminBootstrap
};
