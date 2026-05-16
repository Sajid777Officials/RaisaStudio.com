import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..", process.argv[2] || "dist");
const port = Number(process.env.PORT || 4173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function send(res, file) {
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": types[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const clean = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  let file = path.join(root, clean || "index.html");

  if (existsSync(file) && statSync(file).isDirectory()) {
    file = path.join(file, "index.html");
  }

  if (!existsSync(file)) {
    file = path.join(root, "index.html");
  }

  if (!existsSync(file)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  send(res, file);
});

server.listen(port, () => {
  console.log(`Preview server: http://localhost:${port}`);
  console.log(`Serving: ${root}`);
});
