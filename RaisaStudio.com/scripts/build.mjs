import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform, build as esbuildBundle } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const assets = path.join(dist, "assets");

const SITE_NAME = "RAISA Studio";
const SITE_TITLE = "RAISA Studio - Graphic Design x Software Development";
const SITE_DESCRIPTION = "A split-discipline portfolio for graphic design, branding, websites, web apps, and production-ready digital work.";
const THEME_COLOR = "#0B1B3A";

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeSiteUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PORTFOLIO_SITE_URL must be a valid absolute URL.");
  }

  const isLocalDevelopment = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalDevelopment)) {
    throw new Error("PORTFOLIO_SITE_URL must use HTTPS (HTTP is allowed only for local development).");
  }
  if (parsed.username || parsed.password) {
    throw new Error("PORTFOLIO_SITE_URL must not contain credentials.");
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    throw new Error("PORTFOLIO_SITE_URL must be an origin without a path, query, or fragment.");
  }

  return parsed.origin;
}

function normalizeSupabaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SUPABASE_URL must be a valid absolute URL.");
  }

  const isLocalDevelopment = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalDevelopment)) {
    throw new Error("SUPABASE_URL must use HTTPS (HTTP is allowed only for local development).");
  }
  if (parsed.username || parsed.password) {
    throw new Error("SUPABASE_URL must not contain credentials.");
  }

  return parsed.origin;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toJs(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

async function loadDotEnv(filePath) {
  let source = "";
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] != null) continue;

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[match[1]] = value;
  }
}

await loadDotEnv(path.join(root, ".env"));

const siteUrl = normalizeSiteUrl(process.env.PORTFOLIO_SITE_URL);
const tweaksEnabled = parseBoolean(process.env.PORTFOLIO_ENABLE_TWEAKS, false);
const noIndex = parseBoolean(process.env.PORTFOLIO_NO_INDEX, false);

// Supabase publishable keys are intentionally embedded in the browser bundle.
// Secret/service-role keys must never be accepted here because they bypass RLS.
const supabaseUrl = normalizeSupabaseUrl(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL);
const supabasePublishableKey = String(
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ""
).trim();
const supabaseEnabled = Boolean(supabaseUrl && supabasePublishableKey);
const adminRequested = parseBoolean(process.env.PORTFOLIO_ENABLE_ADMIN, supabaseEnabled);
const adminEnabled = adminRequested && supabaseEnabled;
// When the secure backend is configured, keep the Admin entry visible by
// default so the owner can discover the CMS from the main navigation. Hosts
// that prefer a private entry point can still set PORTFOLIO_SHOW_ADMIN_LINK=false.
const showAdminLink = adminEnabled && parseBoolean(process.env.PORTFOLIO_SHOW_ADMIN_LINK, true);

if (adminRequested && !supabaseEnabled) {
  throw new Error("Admin requires SUPABASE_URL and a Supabase publishable key. Offline passcode access is disabled.");
}

if (/^sb_secret_/i.test(supabasePublishableKey)) {
  throw new Error("A Supabase secret key cannot be embedded in the browser. Use a publishable key.");
}

if (supabasePublishableKey.split(".").length === 3) {
  try {
    const payload = JSON.parse(Buffer.from(supabasePublishableKey.split(".")[1], "base64url").toString("utf8"));
    if (payload?.role === "service_role") {
      throw new Error("A Supabase service_role key cannot be embedded in the browser. Use a publishable/anon key.");
    }
  } catch (error) {
    if (String(error?.message || "").includes("service_role")) throw error;
  }
}

const jsxFiles = [
  "tweaks-panel.jsx",
  "icons.jsx",
  "shared.jsx",
  "cursor.jsx",
  "hero.jsx",
  "graphic-page.jsx",
  "webdev-page.jsx",
  "case-sheet.jsx",
  "content.jsx",
  "supabase-client.jsx",
  "workspace-utils.jsx",
  "visual-editor.jsx",
  "admin-panel.jsx",
  "app.jsx",
];

await rm(dist, { recursive: true, force: true });
await mkdir(assets, { recursive: true });
await writeFile(path.join(assets, "styles.css"), (await Promise.all(
  ["styles.css", "visual-editor.css"].map((file) => readFile(path.join(root, file), "utf8"))
)).join("\n"), "utf8");

let bundle = "/* Generated by npm run build. Do not edit dist files directly. */\n";

for (const file of jsxFiles) {
  const source = await readFile(path.join(root, file), "utf8");
  const result = await transform(source, {
    loader: "jsx",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    target: "es2018",
    minify: true,
    legalComments: "none",
  });

  bundle += `\n;(() => {\n${result.code}\n})();\n`;
}

await writeFile(path.join(assets, "app.js"), bundle, "utf8");

await esbuildBundle({
  entryPoints: [path.join(root, "vendor-entry.js")],
  bundle: true,
  outfile: path.join(assets, "vendor.js"),
  format: "iife",
  platform: "browser",
  target: "es2018",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  legalComments: "none",
  logLevel: "silent",
});

// Bundle framer-motion with React globals mapped to window.React / window.ReactDOM
const reactGlobalsPlugin = {
  name: "react-globals",
  setup(build) {
    const shims = new Map([
      ["react",             "module.exports = window.React;"],
      ["react-dom",         "module.exports = window.ReactDOM;"],
      ["react/jsx-runtime", "module.exports = { createElement: window.React.createElement, Fragment: window.React.Fragment, jsx: window.React.createElement, jsxs: window.React.createElement };"],
      ["react-dom/client",  "module.exports = window.ReactDOM;"],
    ]);
    build.onResolve({ filter: /^react/ }, (args) => {
      if (shims.has(args.path)) return { path: args.path, namespace: "react-shim" };
    });
    build.onLoad({ filter: /.*/, namespace: "react-shim" }, (args) => ({
      contents: shims.get(args.path) || "module.exports = {};",
      loader: "js",
    }));
  },
};

await esbuildBundle({
  entryPoints: [path.join(root, "framer-motion-entry.js")],
  bundle: true,
  outfile: path.join(assets, "framer-motion.js"),
  format: "iife",
  globalName: "FramerMotion",
  platform: "browser",
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  plugins: [reactGlobalsPlugin],
  logLevel: "silent",
});

await writeFile(path.join(assets, "config.js"), `window.PortfolioConfig = ${toJs({
  adminEnabled,
  showAdminLink,
  tweaksEnabled,
  noIndex,
  siteUrl,
  supabaseUrl,
  supabasePublishableKey,
  // Compatibility alias for the existing client bootstrap.
  supabaseAnonKey: supabasePublishableKey,
  buildTime: new Date().toISOString(),
})};
window.PORTFOLIO_ENABLE_ADMIN = window.PortfolioConfig.adminEnabled;
window.PORTFOLIO_ENABLE_TWEAKS = window.PortfolioConfig.tweaksEnabled;
`, "utf8");

const canonicalTags = siteUrl ? `
<link rel="canonical" href="${escapeAttr(siteUrl)}/" />
<meta property="og:url" content="${escapeAttr(siteUrl)}/" />` : "";
const robotsMeta = noIndex ? `<meta name="robots" content="noindex, nofollow" />` : "";
const supabaseRealtimeUrl = supabaseEnabled
  ? supabaseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:")
  : "";
const supabaseImageSources = supabaseEnabled ? ` ${supabaseUrl}` : "";
const supabaseConnectSources = supabaseEnabled
  ? ` ${supabaseUrl} ${supabaseRealtimeUrl}`
  : "";
const runtimeCsp = `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:${supabaseImageSources}; connect-src 'self' https://api.github.com${supabaseConnectSources}; object-src 'none'; base-uri 'self'; form-action 'self' mailto:;`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(runtimeCsp)}" />
<meta name="description" content="${escapeAttr(SITE_DESCRIPTION)}" />
${robotsMeta}
<meta name="theme-color" content="${THEME_COLOR}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}" />
<meta property="og:title" content="${escapeAttr(SITE_TITLE)}" />
<meta property="og:description" content="${escapeAttr(SITE_DESCRIPTION)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeAttr(SITE_TITLE)}" />
<meta name="twitter:description" content="${escapeAttr(SITE_DESCRIPTION)}" />${canonicalTags}
<title>${escapeAttr(SITE_TITLE)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Manrope:wght@300;400;500;600;700&family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400;1,9..144,500&family=JetBrains+Mono:wght@400;500&family=Archivo:wght@500;700;800&family=Inter+Tight:wght@400;500;600&family=DM+Sans:wght@400;500;700&family=IBM+Plex+Sans:wght@400;500;600&family=Bricolage+Grotesque:wght@500;700;800&family=Instrument+Serif&display=swap" rel="stylesheet">
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="manifest" href="/site.webmanifest" />
<link rel="stylesheet" href="/assets/styles.css" />
</head>
<body>
<div id="root"></div>
<noscript>This portfolio needs JavaScript enabled to run the interactive split-screen experience.</noscript>
<script src="/assets/config.js"></script>
<script src="/assets/vendor.js"></script>
<script src="/assets/framer-motion.js"></script>
<script src="/assets/app.js"></script>
</body>
</html>
`;

await writeFile(path.join(dist, "index.html"), html, "utf8");
await writeFile(path.join(dist, "404.html"), html, "utf8");

await writeFile(path.join(dist, "robots.txt"), noIndex
  ? "User-agent: *\nDisallow: /\n"
  : `User-agent: *\nAllow: /\n${siteUrl ? `Sitemap: ${siteUrl}/sitemap.xml\n` : ""}`, "utf8");

if (siteUrl) {
  const sitemapEntries = [
    { path: "/", priority: "1.0" },
    { path: "/graphic", priority: "0.9" },
    { path: "/webdev", priority: "0.9" },
    { path: "/about", priority: "0.7" },
  ].map((entry) => `  <url>
    <loc>${escapeAttr(siteUrl)}${entry.path}</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <priority>${entry.priority}</priority>
  </url>`).join("\n");

  await writeFile(path.join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</urlset>
`, "utf8");
}

await writeFile(path.join(dist, "site.webmanifest"), JSON.stringify({
  name: SITE_NAME,
  short_name: "RAISA",
  start_url: "/",
  display: "standalone",
  background_color: "#FAF7F1",
  theme_color: THEME_COLOR,
  icons: [
    {
      src: "/favicon.svg",
      sizes: "any",
      type: "image/svg+xml",
    },
  ],
}, null, 2), "utf8");

await writeFile(path.join(dist, "favicon.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#E63946"/>
  <path d="M18 16h9l5.3 22.5L37.8 16H47L37.6 48H27.1L18 16Z" fill="#fff"/>
</svg>
`, "utf8");

await writeFile(path.join(dist, "_redirects"), "/* /index.html 200\n", "utf8");

await writeFile(path.join(dist, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: ${runtimeCsp} frame-ancestors 'none';

/assets/*
  Cache-Control: public, max-age=0, must-revalidate

/index.html
  Cache-Control: no-cache
`, "utf8");

console.log(`Built ${path.relative(root, dist)} with ${jsxFiles.length} JSX files.`);
console.log(`Admin panel: ${adminEnabled ? "enabled" : "disabled"}${siteUrl ? ` | URL: ${siteUrl}` : ""}`);
console.log(`Supabase backend: ${supabaseEnabled ? `enabled (${supabaseUrl})` : "disabled (read-only defaults/cache mode)"}`);
