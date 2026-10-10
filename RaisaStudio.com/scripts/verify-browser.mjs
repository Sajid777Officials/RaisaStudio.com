import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const artifacts = path.join(root, "artifacts", "browser-verification");
const chromeCandidates = [
  process.env.CHROME_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const viewports = [
  { name: "mobile-375x812", width: 375, height: 812 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

const publicRoutes = [
  { name: "home", path: "/", selector: ".hero:not(.expanded)", canonicalPath: "/" },
  { name: "graphic", path: "/graphic", selector: ".page-graphic.visible", canonicalPath: "/graphic" },
  { name: "webdev", path: "/webdev", selector: ".page-webdev.visible", canonicalPath: "/webdev" },
  { name: "about", path: "/about", selector: ".page-graphic.visible", canonicalPath: "/about" },
];

const failures = [];
const warnings = [];
const results = [];
const blockedExternalRequests = [];
const localBackendRequests = [];

const unauthenticatedMockScript = `(() => {
  const clonePublishedDefaults = () => {
    const defaults = window.PortfolioContent?.defaults || { schemaVersion: 1, publicEnabled: true };
    const published = typeof structuredClone === "function"
      ? structuredClone(defaults)
      : JSON.parse(JSON.stringify(defaults));
    published.publicEnabled = true;
    return published;
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithPassword: async () => ({ data: { session: null, user: null }, error: { message: "Browser verification never submits credentials." } }),
      signOut: async () => ({ error: null }),
    },
    async rpc(name) {
      if (name === "get_published_portfolio") return { data: clonePublishedDefaults(), error: null };
      if (name === "get_public_media_manifest") return { data: [], error: null };
      return { data: null, error: { message: "Unauthenticated local verification stub" } };
    },
    storage: {
      from() {
        return { getPublicUrl: () => ({ data: { publicUrl: "" } }) };
      },
    },
  };
  window.supabase.createClient = () => client;
  window.__BROWSER_VERIFICATION_UNAUTHENTICATED_MOCK__ = true;
})();`;

const ownerMockScript = `(() => {
  const now = new Date().toISOString();
  const user = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "owner@local.browser-verification.invalid",
    role: "authenticated",
  };
  const session = {
    access_token: "local-browser-verification-only",
    refresh_token: "local-browser-verification-only",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  const cloneDefaults = () => {
    const defaults = window.PortfolioContent?.defaults || { schemaVersion: 1 };
    return typeof structuredClone === "function"
      ? structuredClone(defaults)
      : JSON.parse(JSON.stringify(defaults));
  };
  const client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user }, error: null }),
      onAuthStateChange(callback) {
        queueMicrotask(() => callback("SIGNED_IN", session));
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signInWithPassword: async () => ({ data: { session, user }, error: null }),
      signOut: async () => ({ error: null }),
    },
    async rpc(name) {
      if (name === "get_published_portfolio") return { data: cloneDefaults(), error: null };
      if (name === "get_admin_profile") {
        return { data: { user_id: user.id, role: "owner", is_active: true }, error: null };
      }
      if (name === "get_portfolio_admin_state") {
        const draftContent = cloneDefaults();
        const publishedContent = cloneDefaults();
        return {
          data: {
            draft_json: draftContent,
            published_json: publishedContent,
            draft_revision: 7,
            published_revision: 6,
            public_enabled: true,
            updated_at: now,
            published_at: now,
            unpublished_at: null,
          },
          error: null,
        };
      }
      if (name === "get_portfolio_activity") {
        return {
          data: {
            items: [
              { id: 3, action: "draft_saved", actor_email: user.email, created_at: now, details: {} },
              { id: 2, action: "published", actor_email: user.email, created_at: now, details: {} },
            ],
            count: 2,
          },
          error: null,
        };
      }
      if (name === "list_portfolio_admin_users") {
        return {
          data: [{ user_id: user.id, email: user.email, role: "owner", is_active: true, created_at: now, updated_at: now }],
          error: null,
        };
      }
      if (name === "list_portfolio_media" || name === "get_public_media_manifest") {
        return { data: [], error: null };
      }
      return { data: {}, error: null };
    },
    storage: {
      from() {
        return {
          createSignedUrl: async () => ({ data: { signedUrl: "" }, error: null }),
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
          copy: async () => ({ data: {}, error: null }),
          remove: async () => ({ data: [], error: null }),
          upload: async () => ({ data: {}, error: null }),
        };
      },
    },
    from() {
      const response = Promise.resolve({ data: [], error: null });
      const chain = {
        select: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        then: response.then.bind(response),
        catch: response.catch.bind(response),
      };
      return chain;
    },
  };
  window.supabase.createClient = () => client;
  window.__BROWSER_VERIFICATION_OWNER_MOCK__ = true;
})();`;

function record(condition, message, detail = null) {
  if (!condition) failures.push(detail == null ? message : `${message}: ${JSON.stringify(detail)}`);
  return Boolean(condition);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch (_) {
      // Try the next installed browser candidate.
    }
  }
  throw new Error("Chrome or Edge was not found. Set CHROME_PATH to a Chromium executable.");
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server.address().port;
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve) => server.close(resolve));
}

function isLoopbackUrl(value) {
  try {
    const parsed = new URL(value);
    return ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  } catch (_) {
    return false;
  }
}

function mimeType(file) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  }[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function makeAppServer() {
  return createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method || "GET")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end("Method not allowed");
      return;
    }

    let pathname;
    let ownerMock = false;
    try {
      const parsed = new URL(request.url, "http://127.0.0.1");
      pathname = decodeURIComponent(parsed.pathname);
      ownerMock = parsed.searchParams.get("browserMock") === "owner";
    } catch (_) {
      response.writeHead(400);
      response.end("Bad request");
      return;
    }

    if (pathname === "/__browser-verification-owner.js") {
      const body = Buffer.from(ownerMockScript, "utf8");
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": body.length,
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    if (pathname === "/__browser-verification-unauthenticated.js") {
      const body = Buffer.from(unauthenticatedMockScript, "utf8");
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Length": body.length,
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }

    const relative = pathname.replace(/^[/\\]+/, "");
    const requested = path.resolve(dist, relative || "index.html");
    const distPrefix = dist.endsWith(path.sep) ? dist : `${dist}${path.sep}`;
    if (requested !== dist && !requested.startsWith(distPrefix)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    let file = requested;
    try {
      if (!(await stat(file)).isFile()) file = path.join(dist, "index.html");
    } catch (_) {
      file = path.join(dist, "index.html");
    }

    try {
      let body = await readFile(file);
      if (path.basename(file) === "index.html") {
        const html = body.toString("utf8");
        const marker = '<script src="/assets/framer-motion.js"></script>';
        if (!html.includes(marker)) throw new Error("Could not locate the verification injection point.");
        const mockScript = ownerMock
          ? "/__browser-verification-owner.js"
          : "/__browser-verification-unauthenticated.js";
        body = Buffer.from(html.replace(
          marker,
          `<script src="${mockScript}"></script>\n${marker}`
        ), "utf8");
      }
      response.writeHead(200, {
        "Content-Type": mimeType(file),
        "Cache-Control": "no-store",
        "Content-Length": body.length,
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch (error) {
      response.writeHead(500);
      response.end("Verification build is unavailable");
      failures.push(`Local app server could not read ${file}: ${error.message}`);
    }
  });
}

function makeFakeSupabaseServer() {
  return createServer((request, response) => {
    localBackendRequests.push({ method: request.method || "GET", url: request.url || "/" });
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "apikey, authorization, content-type, prefer, x-client-info, x-supabase-api-version",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    };
    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }

    // Public reads receive an empty snapshot, which intentionally exercises
    // the production fallback without exposing or mutating any real project.
    if (request.url?.startsWith("/rest/v1/rpc/get_published_portfolio")) {
      response.writeHead(200, headers);
      response.end("{}");
      return;
    }

    // No auth form is submitted by this verifier. This response is a safe
    // fallback if the client performs a session discovery request.
    response.writeHead(200, headers);
    response.end("{}");
  });
}

async function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code ?? signal}\n${stdout}\n${stderr}`));
    });
  });
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  handleMessage(raw) {
    const message = JSON.parse(String(raw));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    const handlers = this.listeners.get(message.method) || [];
    for (const handler of handlers) Promise.resolve(handler(message.params || {})).catch((error) => {
      failures.push(`CDP event handler ${message.method} failed: ${error.message}`);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const handlers = this.listeners.get(method) || [];
    handlers.push(handler);
    this.listeners.set(method, handlers);
  }

  waitFor(method, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const handlers = this.listeners.get(method) || [];
        this.listeners.set(method, handlers.filter((entry) => entry !== handler));
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const handler = (params) => {
        clearTimeout(timer);
        const handlers = this.listeners.get(method) || [];
        this.listeners.set(method, handlers.filter((entry) => entry !== handler));
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  async close() {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close();
    await delay(50);
  }
}

async function connectSocket(url, timeoutMs = 10000) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out connecting to ${url}`)), timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`Could not connect to ${url}`));
    }, { once: true });
  });
  return socket;
}

async function waitForJson(url, timeoutMs = 15000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError || new Error(`Timed out loading ${url}`);
}

async function evaluate(client, expression, { awaitPromise = false } = {}) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: false,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Browser evaluation failed");
  }
  return response.result?.value;
}

async function poll(client, expression, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(client, expression)) return true;
    await delay(50);
  }
  return false;
}

async function pressKey(client, key, code, keyCode, modifiers = 0) {
  const params = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...params });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

function collectPageState() {
  const visible = (element) => {
    if (!element || element.closest('[aria-hidden="true"], [inert]')) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  };
  const accessibleName = (element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const labelledText = labelledBy
      ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
      : "";
    const labelText = Array.from(element.labels || []).map((label) => label.textContent || "").join(" ");
    const childAlt = Array.from(element.querySelectorAll?.("img[alt]") || []).map((image) => image.alt).join(" ");
    return String(
      element.getAttribute("aria-label") ||
      labelledText ||
      labelText ||
      element.getAttribute("alt") ||
      element.getAttribute("title") ||
      element.textContent ||
      childAlt ||
      (element.tagName === "INPUT" && element.type !== "password" ? element.value : "") ||
      ""
    ).replace(/\s+/g, " ").trim();
  };
  const interactive = Array.from(document.querySelectorAll(
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])'
  )).filter(visible);
  const missingNames = interactive.filter((element) => !accessibleName(element)).slice(0, 12).map((element) => ({
    tag: element.tagName.toLowerCase(),
    className: typeof element.className === "string" ? element.className : "",
    role: element.getAttribute("role") || "",
  }));
  const ids = Array.from(document.querySelectorAll("[id]")).map((element) => element.id).filter(Boolean);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].slice(0, 12);
  const root = document.documentElement;
  const body = document.body;
  const viewportOffenders = Array.from(document.querySelectorAll("body *"))
    .filter(visible)
    .filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (["fixed", "absolute"].includes(style.position) && element.closest(".hero-marquee, .tech-rail-marquee")) return false;
      return rect.right > window.innerWidth + 2 || rect.left < -2;
    })
    .slice(0, 12)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      };
    });
  let structuredDataValid = false;
  let structuredDataType = "";
  try {
    const parsed = JSON.parse(document.querySelector("#portfolio-structured-data")?.textContent || "");
    structuredDataValid = Boolean(parsed && parsed["@context"] === "https://schema.org");
    structuredDataType = parsed?.["@type"] || "";
  } catch (_) {
    structuredDataValid = false;
  }
  const active = document.activeElement;
  const about = document.querySelector("#about, #about-webdev");
  const aboutRect = about?.getBoundingClientRect();
  return {
    url: location.href,
    pathname: location.pathname,
    hash: location.hash,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
    documentSize: {
      rootScrollWidth: root.scrollWidth,
      bodyScrollWidth: body.scrollWidth,
      rootClientWidth: root.clientWidth,
    },
    horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
    bodyOverflowClipped: body.scrollWidth > root.clientWidth + 1 && getComputedStyle(root).overflowX !== "visible",
    viewportOffenders,
    landmarks: {
      header: document.querySelectorAll("header").length,
      nav: document.querySelectorAll("nav, [role=\"navigation\"]").length,
      main: Array.from(document.querySelectorAll("main, [role=\"main\"]")).filter(visible).length,
      footer: Array.from(document.querySelectorAll("footer")).filter(visible).length,
      h1: Array.from(document.querySelectorAll("h1")).filter(visible).length,
    },
    accessibility: {
      visibleInteractive: interactive.length,
      missingNames,
      missingImageAlt: Array.from(document.querySelectorAll("img:not([alt])")).filter(visible).length,
      duplicateIds,
      dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible).map((dialog) => ({
        modal: dialog.getAttribute("aria-modal"),
        label: accessibleName(dialog),
      })),
    },
    metadata: {
      description: document.querySelector('meta[name="description"]')?.content || "",
      keywords: document.querySelector('meta[name="keywords"]')?.content || "",
      robots: document.querySelector('meta[name="robots"]')?.content || "",
      canonical: document.querySelector('link[rel="canonical"]')?.href || "",
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || "",
      ogDescription: document.querySelector('meta[property="og:description"]')?.content || "",
      structuredDataValid,
      structuredDataType,
    },
    activeElement: active ? {
      tag: active.tagName.toLowerCase(),
      className: typeof active.className === "string" ? active.className : "",
      name: accessibleName(active),
      focusVisible: active.matches?.(":focus-visible") === true,
    } : null,
    aboutInView: aboutRect ? aboutRect.bottom > 0 && aboutRect.top < innerHeight : null,
  };
}

async function main() {
  await mkdir(artifacts, { recursive: true });
  const appServer = makeAppServer();
  const fakeBackend = makeFakeSupabaseServer();
  let chrome;
  let client;
  let profileDir;
  let debugReservation;

  try {
    const appPort = await listen(appServer);
    const backendPort = await listen(fakeBackend);
    const appOrigin = `http://127.0.0.1:${appPort}`;
    const backendOrigin = `http://127.0.0.1:${backendPort}`;

    const sanitizedEnv = {
      ...process.env,
      PORTFOLIO_SITE_URL: appOrigin,
      PORTFOLIO_ENABLE_ADMIN: "true",
      PORTFOLIO_SHOW_ADMIN_LINK: "true",
      PORTFOLIO_ENABLE_TWEAKS: "false",
      PORTFOLIO_NO_INDEX: "false",
      VITE_SUPABASE_URL: backendOrigin,
      SUPABASE_URL: backendOrigin,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_browser_verification",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_browser_verification",
      VITE_SUPABASE_ANON_KEY: " ",
      SUPABASE_ANON_KEY: " ",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "127.0.0.1,localhost",
    };
    const build = await runProcess(process.execPath, ["scripts/build.mjs"], { env: sanitizedEnv });
    process.stdout.write(build.stdout);
    if (build.stderr) process.stderr.write(build.stderr);

    const generatedConfig = await readFile(path.join(dist, "assets", "config.js"), "utf8");
    record(generatedConfig.includes(appOrigin), "Verification build did not use its loopback site URL");
    record(generatedConfig.includes(backendOrigin), "Verification build did not use its loopback backend URL");
    record(!/https:\/\//i.test(generatedConfig), "Verification config unexpectedly contains a non-loopback HTTPS endpoint");
    record(!/supabase\.co/i.test(generatedConfig), "Verification config contains a real Supabase hostname");

    const chromePath = await findChrome();
    debugReservation = createServer();
    const debugPort = await listen(debugReservation);
    await closeServer(debugReservation);
    debugReservation = null;
    profileDir = await mkdtemp(path.join(os.tmpdir(), "raisa-browser-verify-"));

    chrome = spawn(chromePath, [
      "--headless=new",
      ...(process.env.CHROME_NO_SANDBOX === "true" ? ["--no-sandbox", "--disable-setuid-sandbox"] : []),
      "--disable-gpu",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-domain-reliability",
      "--disable-features=OptimizationGuideModelDownloading,MediaRouter,Translate",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-pings",
      "--password-store=basic",
      "--use-mock-keychain",
      "--hide-scrollbars",
      "--mute-audio",
      "--window-size=1440,900",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let chromeStderr = "";
    chrome.stderr.on("data", (chunk) => { chromeStderr += chunk; });
    chrome.once("exit", (code) => {
      if (code && !client) failures.push(`Headless browser exited before verification with code ${code}: ${chromeStderr.slice(-500)}`);
    });

    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const pageTarget = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
    if (!pageTarget) throw new Error("Headless Chrome did not expose a page target.");
    client = new CdpClient(await connectSocket(pageTarget.webSocketDebuggerUrl));

    const runtimeMessages = [];
    const browserLogEntries = [];
    const exceptions = [];
    const loadingFailures = [];
    client.on("Runtime.consoleAPICalled", (params) => {
      runtimeMessages.push({
        type: params.type,
        text: (params.args || []).map((arg) => arg.value ?? arg.description ?? "").join(" "),
      });
    });
    client.on("Runtime.exceptionThrown", (params) => {
      exceptions.push(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || "Uncaught browser exception");
    });
    client.on("Log.entryAdded", (params) => browserLogEntries.push({
      level: params.entry?.level,
      text: params.entry?.text || "",
      url: params.entry?.url || "",
    }));
    client.on("Network.loadingFailed", (params) => loadingFailures.push({
      errorText: params.errorText || "",
      blockedReason: params.blockedReason || "",
      canceled: params.canceled === true,
    }));
    client.on("Fetch.requestPaused", async (params) => {
      const url = params.request?.url || "";
      if (isLoopbackUrl(url)) {
        await client.send("Fetch.continueRequest", { requestId: params.requestId });
      } else {
        blockedExternalRequests.push(url);
        await client.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" });
      }
    });

    await Promise.all([
      client.send("Page.enable"),
      client.send("Runtime.enable"),
      client.send("Log.enable"),
      client.send("Network.enable"),
      client.send("Fetch.enable", { patterns: [
        { urlPattern: "http://*", requestStage: "Request" },
        { urlPattern: "https://*", requestStage: "Request" },
        { urlPattern: "ws://*", requestStage: "Request" },
        { urlPattern: "wss://*", requestStage: "Request" },
      ] }),
    ]);
    await client.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    const navigate = async (url, selector) => {
      const consoleStart = runtimeMessages.length;
      const logStart = browserLogEntries.length;
      const exceptionStart = exceptions.length;
      const loadingStart = loadingFailures.length;
      const previousUrl = await evaluate(client, "location.href");
      const previousDocument = new URL(previousUrl);
      const nextDocument = new URL(url);
      previousDocument.hash = "";
      nextDocument.hash = "";
      const hashNavigation = previousUrl !== url && previousDocument.href === nextDocument.href;
      const load = hashNavigation ? null : client.waitFor("Page.loadEventFired", 15000);
      await client.send("Page.navigate", { url });
      await load?.catch((error) => {
        throw new Error(`Could not load ${url}: ${error.message}. Browser: ${chromeStderr.slice(-1500)}`);
      });
      record(await poll(client, `Boolean(document.querySelector(${JSON.stringify(selector)}))`, 10000), `Route did not render ${selector}`, { url });
      await evaluate(client, "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))", { awaitPromise: true });
      return {
        consoleStart,
        logStart,
        exceptionStart,
        loadingStart,
      };
    };

    for (const viewport of viewports) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 900,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      });

      for (const route of publicRoutes) {
        const markers = await navigate(`${appOrigin}${route.path}`, route.selector);
        if (route.name === "about") {
          const aboutSettled = await poll(client, `(() => {
            const target = document.querySelector('#about, #about-webdev');
            if (!target) return false;
            const rect = target.getBoundingClientRect();
            return rect.bottom > 0 && rect.top <= Math.max(180, innerHeight * 0.3);
          })()`, 3000);
          record(aboutSettled, "About route did not finish scrolling its managed section toward the viewport start", { viewport: viewport.name });
          // scrollIntoView explicitly requests a smooth transition. Once the
          // target reaches the leading viewport region, allow that known
          // transition to settle before recording visual evidence.
          if (aboutSettled) await delay(400);
        }
        if (route.name === "webdev") {
          await poll(client, `(() => {
            const expected = window.PortfolioContent?.load?.()?.studios?.webdev?.pageStats || [];
            const rendered = Array.from(document.querySelectorAll('.page-webdev.visible .page-stats .stat-num')).map((element) => element.textContent || '');
            return expected.length > 0 && expected.every((stat, index) => rendered[index]?.includes(String(stat.value)));
          })()`, 3000);
        }
        const contentVisible = await poll(client, `(() => {
          const selector = ${JSON.stringify(route.name)} === 'home'
            ? '.hero:not(.expanded) .panel-title .char'
            : '.page.visible .service-card';
          const elements = Array.from(document.querySelectorAll(selector));
          return elements.length > 0 && elements.every((element) => Number(getComputedStyle(element).opacity) >= 0.99);
        })()`, 1500);
        record(contentVisible, "Reduced-motion headings and services must be visible without hover or a reveal animation", { route: route.name, viewport: viewport.name });
        if (route.name === "home") {
          record(await evaluate(client, `Array.from(document.querySelectorAll('.panel-title .stack')).every((line) => {
            const chars = Array.from(line.querySelectorAll('.char'));
            const tops = chars.map((char) => char.getBoundingClientRect().top);
            return Math.max(...tops) - Math.min(...tops) < line.getBoundingClientRect().height / 2;
          })`), "Default hero words must not split across lines with fallback fonts", { viewport: viewport.name });
        }
        const state = await evaluate(client, `(${collectPageState.toString()})()`);
        const expectedCanonical = `${appOrigin}${route.canonicalPath === "/" ? "/" : route.canonicalPath}`;
        record(state.pathname === route.path, "Clean route pathname changed unexpectedly", { expected: route.path, actual: state.pathname });
        record(state.viewport.width === viewport.width && state.viewport.height === viewport.height, "Viewport emulation mismatch", { expected: viewport, actual: state.viewport });
        record(!state.horizontalOverflow, "Page has document-level horizontal overflow", { route: route.name, viewport: viewport.name, size: state.documentSize });
        record(state.landmarks.header === 1, "Page must expose exactly one header", { route: route.name, viewport: viewport.name, landmarks: state.landmarks });
        record(state.landmarks.nav >= 1, "Page must expose primary navigation", { route: route.name, viewport: viewport.name, landmarks: state.landmarks });
        record(state.landmarks.main === 1, "Page must expose exactly one visible main landmark", { route: route.name, viewport: viewport.name, landmarks: state.landmarks });
        record(state.landmarks.h1 >= 1, "Page must expose a visible h1", { route: route.name, viewport: viewport.name, landmarks: state.landmarks });
        record(state.accessibility.missingNames.length === 0, "Visible interactive controls need accessible names", { route: route.name, viewport: viewport.name, missing: state.accessibility.missingNames });
        record(state.accessibility.missingImageAlt === 0, "Visible images need alt attributes", { route: route.name, viewport: viewport.name, count: state.accessibility.missingImageAlt });
        record(state.accessibility.duplicateIds.length === 0, "Rendered document has duplicate ids", { route: route.name, viewport: viewport.name, ids: state.accessibility.duplicateIds });
        record(state.metadata.description.length >= 50, "Route metadata needs a meaningful description", { route: route.name, description: state.metadata.description });
        record(state.metadata.robots === "index, follow", "Public route must remain indexable in the verification build", { route: route.name, robots: state.metadata.robots });
        record(state.metadata.canonical === expectedCanonical, "Route canonical URL mismatch", { route: route.name, expectedCanonical, actual: state.metadata.canonical });
        record(state.metadata.ogTitle === state.title && Boolean(state.metadata.ogDescription), "Open Graph metadata must match the route title and description", { route: route.name, metadata: state.metadata });
        record(state.metadata.structuredDataValid, "Structured metadata is missing or invalid", { route: route.name, metadata: state.metadata });
        if (route.name === "about") record(state.aboutInView === true, "About route did not scroll its managed section into view", { viewport: viewport.name });

        const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
        const screenshotFile = path.join(artifacts, `${route.name}-${viewport.name}.png`);
        await writeFile(screenshotFile, Buffer.from(screenshot.data, "base64"));

        await evaluate(client, "document.activeElement?.blur?.(); document.body.focus();");
        await pressKey(client, "Tab", "Tab", 9);
        const focus = await evaluate(client, `(${collectPageState.toString()})().activeElement`);
        record(Boolean(focus?.name) && focus?.tag !== "body", "Keyboard Tab did not reach a named interactive control", { route: route.name, viewport: viewport.name, focus });
        record(focus?.focusVisible === true, "Keyboard-focused control did not match :focus-visible", { route: route.name, viewport: viewport.name, focus });

        const routeExceptions = exceptions.slice(markers.exceptionStart);
        const routeConsoleErrors = runtimeMessages.slice(markers.consoleStart).filter((entry) => entry.type === "error");
        const routeLogErrors = browserLogEntries.slice(markers.logStart).filter((entry) => {
          if (!['error', 'warning'].includes(entry.level)) return false;
          return !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/i.test(entry.text);
        });
        record(routeExceptions.length === 0, "Route raised an uncaught browser exception", { route: route.name, viewport: viewport.name, exceptions: routeExceptions });
        record(routeConsoleErrors.length === 0, "Route emitted console.error", { route: route.name, viewport: viewport.name, errors: routeConsoleErrors });
        record(routeLogErrors.length === 0, "Route emitted unexpected browser log errors", { route: route.name, viewport: viewport.name, errors: routeLogErrors });

        results.push({
          kind: "public",
          route: route.name,
          viewport,
          screenshot: path.relative(root, screenshotFile),
          state,
          console: {
            errors: routeConsoleErrors,
            warnings: runtimeMessages.slice(markers.consoleStart).filter((entry) => entry.type === "warning"),
            browserErrors: routeLogErrors,
            exceptions: routeExceptions,
            loadingFailures: loadingFailures.slice(markers.loadingStart),
          },
        });
      }
    }

    // Headings must also be readable with touch and keyboard when motion is enabled.
    for (const input of ["touch", "keyboard"]) {
      const viewport = input === "touch" ? viewports[0] : viewports[2];
      await client.send("Emulation.setTouchEmulationEnabled", { enabled: input === "touch" });
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width, height: viewport.height, deviceScaleFactor: 1,
        mobile: input === "touch", screenWidth: viewport.width, screenHeight: viewport.height,
      });
      await client.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
      });
      const markers = await navigate(`${appOrigin}/`, ".hero:not(.expanded)");
      await poll(client, "!document.querySelector('.loading-screen')", 5000);
      if (input === "keyboard") await evaluate(client, "document.querySelector('.panel-graphic').focus()");
      const titlesVisible = await poll(client, `(() => {
        const selector = ${JSON.stringify(input)} === 'touch' ? '.hero .panel-title .char' : '.panel-graphic .panel-title .char';
        const chars = Array.from(document.querySelectorAll(selector));
        return chars.length > 0 && chars.every((char) => Number(getComputedStyle(char).opacity) >= 0.99);
      })()`, 3000);
      record(titlesVisible, "Hero title is unreadable with motion enabled", { input });
      if (input === "touch") record(await evaluate(client, "matchMedia('(pointer: coarse)').matches"), "Touch verification must use a coarse pointer");
      record(exceptions.slice(markers.exceptionStart).length === 0, "Hero input flow raised an exception", { input, exceptions: exceptions.slice(markers.exceptionStart) });
      const consoleErrors = runtimeMessages.slice(markers.consoleStart).filter((entry) => entry.type === "error");
      record(consoleErrors.length === 0, "Hero input flow emitted console.error", { input, errors: consoleErrors });
      const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const screenshotFile = path.join(artifacts, `home-${input}-motion.png`);
      await writeFile(screenshotFile, Buffer.from(screenshot.data, "base64"));
      results.push({ kind: "hero-input", input, motion: "no-preference", viewport, screenshot: path.relative(root, screenshotFile), titlesVisible, consoleErrors });
    }
    await client.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await client.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    // Legacy hash compatibility remains important for existing inbound links.
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 1440,
      screenHeight: 900,
    });
    const legacyMarkers = await navigate(`${appOrigin}/#graphic`, ".page-graphic.visible");
    const legacyState = await evaluate(client, `(${collectPageState.toString()})()`);
    record(legacyState.pathname === "/" && legacyState.hash === "#graphic", "Legacy #graphic route is not preserved", legacyState);
    record(exceptions.slice(legacyMarkers.exceptionStart).length === 0, "Legacy route raised an uncaught exception", exceptions.slice(legacyMarkers.exceptionStart));
    const legacyShot = path.join(artifacts, "legacy-graphic-desktop-1440x900.png");
    const legacyPng = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(legacyShot, Buffer.from(legacyPng.data, "base64"));
    results.push({ kind: "legacy", route: "#graphic", viewport: viewports[2], screenshot: path.relative(root, legacyShot), state: legacyState });

    // Exercise a real project dialog, including initial focus, Tab wrapping,
    // Escape close, and focus restoration to the trigger.
    await navigate(`${appOrigin}/graphic`, ".page-graphic.visible");
    const serviceOpened = await evaluate(client, `(() => {
      const visible = (element) => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
      const trigger = Array.from(document.querySelectorAll('.page-graphic.visible .service-card')).find(visible);
      if (!trigger) return false;
      trigger.click();
      return true;
    })()`);
    record(serviceOpened, "Could not find a graphic service control for dialog verification");
    const projectReady = await poll(client, "Boolean(Array.from(document.querySelectorAll('.page-graphic.visible .category-project-image')).find((element) => element.getBoundingClientRect().width > 0))", 5000);
    record(projectReady, "Graphic project cards did not render for dialog verification");
    const projectOpened = projectReady && await evaluate(client, `(() => {
      const trigger = Array.from(document.querySelectorAll('.page-graphic.visible .category-project-image')).find((element) => element.getBoundingClientRect().width > 0);
      if (!trigger) return false;
      window.__browserVerificationDialogTrigger = trigger;
      trigger.focus();
      trigger.click();
      return true;
    })()`);
    record(projectOpened, "Could not open the graphic project dialog");
    record(await poll(client, "Boolean(document.querySelector('.project-lightbox[role=dialog][aria-modal=true]'))", 5000), "Graphic project dialog did not expose modal semantics");
    await evaluate(client, "new Promise((resolve) => requestAnimationFrame(resolve))", { awaitPromise: true });
    const dialogInitial = await evaluate(client, `(() => {
      const dialog = document.querySelector('.project-lightbox[role=dialog]');
      const active = document.activeElement;
      return { exists: Boolean(dialog), activeClass: active?.className || '', activeLabel: active?.getAttribute?.('aria-label') || '', labelledBy: dialog?.getAttribute('aria-labelledby') || '' };
    })()`);
    record(dialogInitial.exists && /project-lightbox-close/.test(dialogInitial.activeClass), "Project dialog did not focus its close button", dialogInitial);
    const trapPrepared = await evaluate(client, `(() => {
      const dialog = document.querySelector('.project-lightbox[role=dialog]');
      const focusable = Array.from(dialog?.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])') || []).filter((element) => element.getBoundingClientRect().width > 0);
      if (focusable.length < 1) return { count: focusable.length, prepared: false };
      window.__browserVerificationDialogFirst = focusable[0];
      focusable[focusable.length - 1].focus();
      return { count: focusable.length, prepared: true };
    })()`);
    record(trapPrepared.prepared, "Project dialog did not expose focusable controls", trapPrepared);
    if (trapPrepared.prepared) {
      await pressKey(client, "Tab", "Tab", 9);
      const trapped = await evaluate(client, "document.activeElement === window.__browserVerificationDialogFirst");
      record(trapped, "Project dialog did not wrap Tab focus to its first control");
    }
    await pressKey(client, "Escape", "Escape", 27);
    record(await poll(client, "!document.querySelector('.project-lightbox[role=dialog]')", 5000), "Escape did not close the project dialog");
    await evaluate(client, "new Promise((resolve) => requestAnimationFrame(resolve))", { awaitPromise: true });
    record(await evaluate(client, "document.activeElement === window.__browserVerificationDialogTrigger"), "Project dialog did not restore focus to its trigger");

    // Verify direct case-study dialog semantics and keyboard dismissal.
    const caseFixture = await evaluate(client, `(() => {
      const content = window.PortfolioContent?.load?.();
      const cases = Object.keys(content?.cases || {});
      const work = (content?.works?.graphic || []).find((item) => cases.includes(item.id) || cases.includes(item.slug));
      return { caseCount: cases.length, caseIds: cases.slice(0, 12), workId: work?.id || '', workSlug: work?.slug || '' };
    })()`);
    record(caseFixture.caseCount > 0 && Boolean(caseFixture.workId), "Public fallback content does not expose a linked graphic case study", caseFixture);
    const caseRouteId = caseFixture.workId || "g1";
    const caseMarkers = await navigate(`${appOrigin}/graphic/${encodeURIComponent(caseRouteId)}`, ".case-sheet[role=dialog][aria-modal=true]");
    await evaluate(client, "new Promise((resolve) => requestAnimationFrame(resolve))", { awaitPromise: true });
    const caseState = await evaluate(client, `(${collectPageState.toString()})()`);
    const caseDialog = await evaluate(client, `(() => {
      const dialog = document.querySelector('.case-sheet[role=dialog]');
      return { label: dialog?.getAttribute('aria-label') || '', closeFocused: document.activeElement?.classList?.contains('case-close') === true };
    })()`);
    record(Boolean(caseDialog.label) && caseDialog.closeFocused, "Case-study dialog is missing a label or initial close focus", caseDialog);
    record(caseState.pathname === `/graphic/${caseRouteId}`, "Nested case-study clean route changed unexpectedly", caseState.pathname);
    record(caseState.metadata.robots === "index, follow", "Public case study must remain indexable", caseState.metadata);
    record(caseState.metadata.structuredDataType === "CreativeWork", "Case-study structured metadata must use CreativeWork", caseState.metadata);
    record(caseState.landmarks.main === 1, "Case-study route must keep one visible main landmark", caseState.landmarks);
    record(!caseState.horizontalOverflow, "Case-study route has document-level horizontal overflow", caseState.documentSize);
    record(exceptions.slice(caseMarkers.exceptionStart).length === 0, "Case-study route raised an uncaught exception", exceptions.slice(caseMarkers.exceptionStart));
    record(runtimeMessages.slice(caseMarkers.consoleStart).filter((entry) => entry.type === "error").length === 0, "Case-study route emitted console.error", runtimeMessages.slice(caseMarkers.consoleStart));
    const caseScreenshotFile = path.join(artifacts, "case-study-desktop-1440x900.png");
    const caseScreenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(caseScreenshotFile, Buffer.from(caseScreenshot.data, "base64"));
    results.push({
      kind: "case-study",
      route: `graphic/${caseRouteId}`,
      viewport: viewports[2],
      screenshot: path.relative(root, caseScreenshotFile),
      fixture: caseFixture,
      state: caseState,
      dialog: caseDialog,
    });
    await pressKey(client, "Escape", "Escape", 27);
    record(await poll(client, "!document.querySelector('.case-sheet[role=dialog]') && location.pathname === '/graphic'", 5000), "Escape did not close the case-study dialog to /graphic");

    // The unauthenticated admin surface is tested without entering or sending
    // credentials. The configured backend is the fake loopback service above.
    for (const viewport of viewports) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 900,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      });
      const markers = await navigate(`${appOrigin}/admin`, ".admin-login");
      record(await poll(client, "Boolean(document.querySelector('.admin-login form, form.admin-login'))", 5000), "Admin login form did not become available", viewport);
      const adminState = await evaluate(client, `(${collectPageState.toString()})()`);
      const adminForm = await evaluate(client, `(() => {
        const form = document.querySelector('form.admin-login');
        const email = form?.querySelector('input[type=email]');
        const password = form?.querySelector('input[type=password]');
        const submit = form?.querySelector('button[type=submit]');
        return {
          form: Boolean(form),
          emailLabel: email?.labels?.[0]?.textContent?.trim() || '',
          passwordLabel: password?.labels?.[0]?.textContent?.trim() || '',
          passwordType: password?.type || '',
          submitText: submit?.textContent?.trim() || '',
          submitEnabled: submit ? !submit.disabled : false,
        };
      })()`);
      record(adminForm.form && Boolean(adminForm.emailLabel) && Boolean(adminForm.passwordLabel), "Admin login fields need programmatic labels", { viewport: viewport.name, adminForm });
      record(adminForm.passwordType === "password", "Admin password field is not masked", { viewport: viewport.name, adminForm });
      record(/sign in securely/i.test(adminForm.submitText), "Admin login does not expose the secure sign-in action", { viewport: viewport.name, adminForm });
      record(adminState.metadata.robots === "noindex, nofollow", "Admin route must be noindex", { viewport: viewport.name, robots: adminState.metadata.robots });
      record(/Admin/i.test(adminState.title), "Admin route title must identify the admin surface", { viewport: viewport.name, title: adminState.title });
      record(!adminState.horizontalOverflow, "Admin login has document-level horizontal overflow", { viewport: viewport.name, size: adminState.documentSize });
      record(adminState.accessibility.missingNames.length === 0, "Admin login has unnamed interactive controls", { viewport: viewport.name, missing: adminState.accessibility.missingNames });
      record(exceptions.slice(markers.exceptionStart).length === 0, "Admin login raised an uncaught exception", { viewport: viewport.name, exceptions: exceptions.slice(markers.exceptionStart) });
      record(runtimeMessages.slice(markers.consoleStart).filter((entry) => entry.type === "error").length === 0, "Admin login emitted console.error", { viewport: viewport.name, entries: runtimeMessages.slice(markers.consoleStart) });

      const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const screenshotFile = path.join(artifacts, `admin-login-${viewport.name}.png`);
      await writeFile(screenshotFile, Buffer.from(screenshot.data, "base64"));
      results.push({ kind: "admin-login", route: "admin", viewport, screenshot: path.relative(root, screenshotFile), state: adminState, form: adminForm });
    }

    // A server-injected, test-only SDK stub renders the authenticated owner
    // shell without writing a fixture into dist and without authenticating to
    // any service. This exercises responsive dashboard layout only; it does
    // not claim to replace a staging RLS/auth integration test.
    for (const viewport of viewports) {
      await client.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.width < 900,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      });
      const markers = await navigate(`${appOrigin}/admin?browserMock=owner`, ".visual-admin-toolbar");
      await evaluate(client, `Array.from(document.querySelectorAll('.visual-admin-toolbar button')).find(button => button.textContent === 'Settings')?.click()`);
      record(await poll(client, "Boolean(document.querySelector('.visual-drawer-navigation select'))"), "Editor settings drawer did not open", viewport);
      await evaluate(client, `(() => { const select = document.querySelector('.visual-drawer-navigation select'); if (select) { select.value = 'dashboard'; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
      record(await poll(client, "window.__BROWSER_VERIFICATION_OWNER_MOCK__ === true && Boolean(document.querySelector('.admin-shell'))", 8000), "Owner dashboard mock did not unlock the admin shell", viewport);
      const ownerDashboardReady = await poll(client, `(() => {
        const published = Array.from(document.querySelectorAll('.admin-dashboard-stat small'));
        const activityReady = Boolean(document.querySelector('.admin-activity-list'));
        return published.length === 4 && published.every((item) => !/Published snapshot:\\s*0\\s*$/i.test(item.textContent || '')) && activityReady;
      })()`, 8000);
      record(ownerDashboardReady, "Owner dashboard did not hydrate published counts and recent activity", viewport);
      const ownerState = await evaluate(client, `(${collectPageState.toString()})()`);
      const ownerShell = await evaluate(client, `(() => {
        const shell = document.querySelector('.admin-shell');
        const navigation = document.querySelector('.visual-drawer-navigation');
        const main = document.querySelector('.admin-main, .admin-content');
        const text = shell?.innerText || '';
        const viewportRect = shell?.getBoundingClientRect();
        return {
          mockActive: window.__BROWSER_VERIFICATION_OWNER_MOCK__ === true,
          shell: Boolean(shell),
          navigation: Boolean(navigation),
          main: Boolean(main),
          ownerLabel: /owner/i.test(document.querySelector(".visual-admin-brand")?.textContent || ""),
          dashboardLabel: /dashboard/i.test(text),
          draftStatus: /draft/i.test(text),
          publishedStatus: /publish/i.test(text),
          publishedCounts: Array.from(document.querySelectorAll('.admin-dashboard-stat small')).map((item) => item.textContent?.trim() || ''),
          activityItems: document.querySelectorAll('.admin-activity-item').length,
          shellWidth: viewportRect ? Math.round(viewportRect.width) : 0,
        };
      })()`);
      record(ownerShell.mockActive && ownerShell.shell && ownerShell.navigation, "Authenticated owner shell is missing its primary regions", { viewport: viewport.name, ownerShell });
      record(ownerShell.ownerLabel && ownerShell.dashboardLabel, "Authenticated owner shell is missing role/dashboard context", { viewport: viewport.name, ownerShell });
      record(ownerShell.draftStatus && ownerShell.publishedStatus, "Dashboard is missing draft/published status", { viewport: viewport.name, ownerShell });
      record(ownerShell.activityItems >= 1, "Dashboard recent activity did not render", { viewport: viewport.name, ownerShell });
      record(ownerState.metadata.robots === "noindex, nofollow", "Authenticated admin route must remain noindex", { viewport: viewport.name, robots: ownerState.metadata.robots });
      record(!ownerState.horizontalOverflow, "Authenticated admin shell has document-level horizontal overflow", { viewport: viewport.name, size: ownerState.documentSize, offenders: ownerState.viewportOffenders });
      record(ownerState.accessibility.missingNames.length === 0, "Authenticated admin shell has unnamed interactive controls", { viewport: viewport.name, missing: ownerState.accessibility.missingNames });
      record(ownerState.accessibility.duplicateIds.length === 0, "Authenticated admin shell has duplicate ids", { viewport: viewport.name, ids: ownerState.accessibility.duplicateIds });
      record(exceptions.slice(markers.exceptionStart).length === 0, "Authenticated owner shell raised an uncaught exception", { viewport: viewport.name, exceptions: exceptions.slice(markers.exceptionStart) });
      record(runtimeMessages.slice(markers.consoleStart).filter((entry) => entry.type === "error").length === 0, "Authenticated owner shell emitted console.error", { viewport: viewport.name, entries: runtimeMessages.slice(markers.consoleStart) });

      const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      const screenshotFile = path.join(artifacts, `admin-owner-${viewport.name}.png`);
      await writeFile(screenshotFile, Buffer.from(screenshot.data, "base64"));
      results.push({ kind: "admin-owner-mock", route: "admin", viewport, screenshot: path.relative(root, screenshotFile), state: ownerState, shell: ownerShell });
    }

    const uniqueExternal = [...new Set(blockedExternalRequests)];
    record(uniqueExternal.every((url) => !isLoopbackUrl(url)), "Loopback request was mistakenly classified as external", uniqueExternal);
    record(localBackendRequests.every((request) => !/[?&](password|token|secret)=/i.test(request.url)), "Verification backend request URL contains sensitive data", localBackendRequests);

    const report = {
      generatedAt: new Date().toISOString(),
      build: {
        mode: "local-only browser verification",
        siteOrigin: appOrigin,
        backendOrigin,
        adminEnabled: true,
        noIndex: false,
        realEnvironmentUsed: false,
        ownerFixture: "served from verifier memory only; not written to dist",
        distState: "LOCAL-ONLY VERIFICATION BUILD — rebuild with the intended deployment environment before release",
      },
      summary: {
        passed: failures.length === 0,
        scenarios: results.length,
        screenshots: results.filter((result) => result.screenshot).length,
        blockedExternalRequests: uniqueExternal.length,
        localBackendRequests: localBackendRequests.length,
        failures: failures.length,
        warnings: warnings.length,
      },
      blockedExternalRequests: uniqueExternal,
      localBackendRequests,
      failures,
      warnings,
      results,
    };
    await writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2), "utf8");

    console.log(`Browser verification scenarios: ${report.summary.scenarios}`);
    console.log(`Screenshots: ${report.summary.screenshots}`);
    console.log(`External requests blocked before network: ${report.summary.blockedExternalRequests}`);
    console.log(`Loopback backend requests: ${report.summary.localBackendRequests}`);
    console.log(`Report: ${path.relative(root, path.join(artifacts, "report.json"))}`);
    console.log("dist state: LOCAL-ONLY verification build; run npm run build with the intended environment before deployment.");
    if (failures.length) {
      console.error(`Browser verification failed (${failures.length} assertion${failures.length === 1 ? "" : "s"}):`);
      for (const failure of failures) console.error(`- ${failure}`);
      process.exitCode = 1;
    } else {
      console.log("Browser verification passed.");
    }
  } finally {
    if (client) {
      try { await client.send("Browser.close"); } catch (_) {}
      await client.close().catch(() => {});
    }
    if (chrome && chrome.exitCode == null) {
      chrome.kill();
      await Promise.race([
        new Promise((resolve) => chrome.once("exit", resolve)),
        delay(2000),
      ]);
    }
    await closeServer(debugReservation).catch(() => {});
    await closeServer(appServer).catch(() => {});
    await closeServer(fakeBackend).catch(() => {});
    if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch(async (error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
