import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requestedRoot = path.resolve(__dirname, "..", process.argv[2] || "dist");
const root = realpathSync(requestedRoot);
const port = Number(process.env.PORT || 4173);
const host = "127.0.0.1";
const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function send(res, file) {
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  if (!["GET", "HEAD"].includes(req.method || "GET")) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  let clean;
  try {
    const url = new URL(req.url, `http://${host}:${port}`);
    clean = decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  // The preview server is intentionally static-only. Never expose dotfiles
  // such as .env, even if somebody points it at the repository by mistake.
  if (clean.split(/[\\/]/).some((segment) => segment.startsWith("."))) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  let file = path.resolve(root, clean || "index.html");
  if (file !== root && !file.startsWith(rootPrefix)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (existsSync(file) && statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }

  if (!existsSync(file)) {
    // Extensionless routes are SPA routes. Missing asset-like requests should
    // remain 404s instead of receiving index.html with the wrong MIME type.
    file = path.extname(clean) ? "" : path.join(root, "index.html");
  }

  if (!existsSync(file)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }


  const realFile = realpathSync(file);
  if (realFile !== root && !realFile.startsWith(rootPrefix)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  file = realFile;

  if (req.method === "HEAD") {
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end();
    return;
  }

  send(res, file);
});

server.listen(port, host, () => {
  console.log(`Preview server: http://${host}:${port}`);
  console.log(`Serving: ${root}`);
});
