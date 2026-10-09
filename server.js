import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  const file = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (error, data) => {
    if (error) {
      const missing = error.code === "ENOENT";
      res.writeHead(missing ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(missing ? "Not found" : "Error");
      return;
    }
    const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache" });
    res.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log("");
  console.log("Drive My Home — resident reports");
  console.log(`This computer:  http://localhost:${port}`);
  const addresses = lanAddresses();
  if (addresses.length === 0) {
    console.log("No Wi-Fi address found. Connect this PC to the same network as the phone.");
  }
  for (const address of addresses) {
    console.log(`Phone (same Wi-Fi):  http://${address}:${port}`);
  }
  console.log("");
  console.log("Leave this window open. Press Ctrl+C to stop.");
});
