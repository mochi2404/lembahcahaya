const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { URL } = require("url");
const apiHandler = require("./api/router");
const { ensureSchema, useDatabase } = require("./lib/store");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  }[ext] || "application/octet-stream";
}

async function handleStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(path.join(ROOT, pathname));
  if (!safePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(safePath);
    res.writeHead(200, { "Content-Type": getContentType(safePath) });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      return await apiHandler(req, res);
    }
    return await handleStatic(req, res, url);
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message || "Terjadi kesalahan server" }));
  }
});

ensureSchema()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Web order server berjalan di http://localhost:${PORT}`);
      console.log(`Storage mode: ${useDatabase ? "postgres" : "json-fallback"}`);
    });
  })
  .catch((error) => {
    console.error("Gagal menyiapkan storage:", error);
    process.exit(1);
  });
