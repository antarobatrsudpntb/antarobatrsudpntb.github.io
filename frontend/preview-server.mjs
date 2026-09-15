import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./dist/", import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

createServer((req, res) => {
  const raw = decodeURIComponent((req.url || "/").split("?")[0]);
  const safe = normalize(raw).replace(/^([.][.][/\\])+/, "");
  let file = join(root, safe === "/" ? "index.html" : safe);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  const runtimeFile = file.endsWith("index.html") || file.endsWith("melesat-config.js") || file.endsWith("service-worker.js");
  res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": runtimeFile ? "no-store" : "public, max-age=3600" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  console.log(`MELESAT PWA siap di http://127.0.0.1:${port}`);
  console.log("Biarkan terminal ini tetap terbuka selama pengujian.");
});
