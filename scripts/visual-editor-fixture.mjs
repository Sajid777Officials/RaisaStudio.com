// Local browser acceptance fixture. Never imported by the production build.
// Auth, database writes, and image verification are simulations in memory.
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roles = ["owner", "publisher", "editor", "viewer"];
const userId = "00000000-0000-4000-8000-000000000001";
const clone = (value) => structuredClone(value);
const ok = (data) => ({ data, error: null });
const fail = (message) => ({ data: null, error: { message } });

export async function loadFixtureSeed() {
  const sql = await readFile(path.join(root, "supabase/migrations/202607290002_seed_portfolio_content_v1.sql"), "utf8");
  const seed = JSON.parse(sql.split("$portfolio_content_v1$")[1]);
  seed.publicEnabled = true;
  return seed;
}

export function createFixtureState(seed) {
  const state = { draft: clone(seed), published: clone(seed), draftRevision: 7, publishedRevision: 6,
    publicEnabled: true, activity: [], revisions: [], media: new Map(), failures: new Map(), revoked: new Set(), calls: [] };
  const addRevision = (kind, role) => {
    state.revisions.unshift({ id: randomUUID(), revision: kind === "published" ? state.publishedRevision : state.draftRevision,
      kind, created_at: new Date().toISOString(), created_by: userId, content: clone(kind === "published" ? state.published : state.draft) });
    state.activity.unshift({ id: state.activity.length + 1, action: kind === "published" ? "published" : "draft_saved",
      actor_email: `${role}@visual-fixture.invalid`, actor_id: userId, resource_type: "portfolio", resource_id: "1",
      created_at: new Date().toISOString(), details: {} });
  };
  addRevision("published", "owner");
  addRevision("draft", "owner");
  const snapshot = () => ({ draft_json: clone(state.draft), published_json: clone(state.published),
    draft_revision: state.draftRevision, published_revision: state.publishedRevision, public_enabled: state.publicEnabled,
    updated_at: new Date().toISOString(), published_at: new Date().toISOString() });
  function rpc(name, args = {}, role = "anonymous") {
    state.calls.push({ name, role });
    if (state.failures.has(name)) {
      const message = state.failures.get(name);
      state.failures.delete(name);
      return fail(message);
    }
    if (name === "get_published_portfolio") return ok(state.publicEnabled ? clone(state.published) : { publicEnabled: false });
    if (name === "get_public_media_manifest") return ok(Object.fromEntries([...state.media.values()]
      .filter((asset) => state.publicEnabled && JSON.stringify(state.published).includes(asset.reference_token))
      .map((asset) => [asset.reference_token, { bucket: "portfolio-media-public", path: asset.storage_path }])));
    if (!roles.includes(role) || state.revoked.has(role)) return fail("This account does not have active portfolio admin access.");
    if (name === "get_admin_profile") return ok({ user_id: userId, role, is_active: true });
    if (name === "get_portfolio_admin_state") return ok(snapshot());
    if (name === "get_portfolio_activity") return ok({ items: state.activity.slice(args.p_offset || 0, (args.p_offset || 0) + (args.p_limit || 20)), count: state.activity.length });
    if (name === "fixture_revisions") return { ...ok(state.revisions.map(({ content, ...entry }) => entry)), count: state.revisions.length };
    if (name === "list_portfolio_media") return ok({ items: [...state.media.values()].filter((asset) => asset.status !== "deleted").map(({ bytes, ...asset }) => asset), count: state.media.size });
    if (name === "get_portfolio_media_usage") {
      const token = `media://${args.p_asset_id}`;
      const draft = JSON.stringify(state.draft).includes(token) ? ["Draft content"] : [];
      const published = JSON.stringify(state.published).includes(token) ? ["Published content"] : [];
      return ok({ draft, published, draft_count: draft.length, published_count: published.length });
    }
    if (name === "list_portfolio_admin_users") return role === "owner"
      ? ok([{ user_id: userId, email: "owner@visual-fixture.invalid", role: "owner", is_active: true, created_at: new Date().toISOString() }])
      : fail("Only an owner can manage staff.");
    if (role === "viewer") return fail("Your viewer role is read-only.");
    if (name === "save_portfolio_draft") {
      if (args.p_expected_revision !== state.draftRevision) return fail("Another session changed the draft. Reload the latest draft before saving.");
      state.draft = clone(args.p_content);
      state.draftRevision += 1;
      addRevision("draft", role);
      return ok({ draft_revision: state.draftRevision, updated_at: new Date().toISOString() });
    }
    if (["create_portfolio_media_upload", "create_portfolio_media_replacement"].includes(name)) {
      const id = randomUUID();
      const asset = { id, asset_id: id, reference_token: `media://${id}`, name: args.p_name, alt_text: args.p_alt_text,
        mime_type: args.p_mime_type, size: args.p_size, storage_bucket: "portfolio-media-drafts", storage_path: `${userId}/${id}/image`, status: "uploading", can_delete: true };
      state.media.set(id, asset);
      return ok(clone(asset));
    }
    if (name === "update_portfolio_media_alt_text") {
      const asset = state.media.get(args.p_asset_id);
      if (!asset) return fail("Image not found.");
      asset.alt_text = args.p_alt_text;
      const { bytes, ...record } = asset;
      return ok(record);
    }
    if (name === "request_portfolio_media_deletion") {
      const asset = state.media.get(args.p_asset_id);
      if (asset && (JSON.stringify(state.draft).includes(asset.reference_token) || JSON.stringify(state.published).includes(asset.reference_token))) return fail("This image is still referenced.");
      return ok({ objects: [] });
    }
    if (name === "finalize_portfolio_media_deletion") { state.media.delete(args.p_asset_id); return ok({}); }
    if (!["owner", "publisher"].includes(role)) return fail("Only an owner or publisher can publish or restore.");
    if (["prepare_portfolio_media_promotion", "publish_portfolio", "restore_portfolio_revision"].includes(name)) {
      if (args.p_expected_draft_revision !== state.draftRevision) return fail("Another session changed the draft. Reload before publishing or restoring.");
    }
    if (name === "prepare_portfolio_media_promotion") return ok({ items: [] });
    if (name === "publish_portfolio") {
      state.published = clone(state.draft);
      state.published.publicEnabled = true;
      state.publicEnabled = true;
      state.publishedRevision += 1;
      for (const asset of state.media.values()) if (JSON.stringify(state.published).includes(asset.reference_token)) asset.status = "published";
      addRevision("published", role);
      return ok(snapshot());
    }
    if (name === "unpublish_portfolio") {
      if (args.p_expected_published_revision !== state.publishedRevision) return fail("The published revision changed. Reload before unpublishing.");
      state.publicEnabled = false;
      state.publishedRevision += 1;
      return ok({ published_revision: state.publishedRevision, unpublished_at: new Date().toISOString() });
    }
    if (name === "restore_portfolio_revision") {
      const revision = state.revisions.find((entry) => entry.id === args.p_revision_id);
      if (!revision) return fail("Revision not found.");
      state.draft = clone(revision.content);
      state.draftRevision += 1;
      addRevision("draft", role);
      return ok(snapshot());
    }
    return fail(`Unsupported local fixture operation: ${name}`);
  }
  return { state, rpc, snapshot };
}

// This adapter replaces the SDK only in HTML returned by this loopback server.
function browserAdapter() {
  const params = new URLSearchParams(location.search);
  const entry = params.get("fixture");
  if (entry && ["owner", "publisher", "editor", "viewer", "anonymous"].includes(entry)) {
    sessionStorage.setItem("visual-fixture-role", entry);
    params.delete("fixture");
    history.replaceState(null, "", location.pathname + (params.size ? `?${params}` : "") + location.hash);
  }
  let role = sessionStorage.getItem("visual-fixture-role") || "anonymous";
  const listeners = new Set();
  const user = () => role === "anonymous" ? null : { id: "00000000-0000-4000-8000-000000000001", email: `${role}@visual-fixture.invalid` };
  const session = () => user() ? { user: user(), access_token: "local-fixture-only", expires_at: Math.floor(Date.now() / 1000) + 3600 } : null;
  const request = async (name, args = {}) => (await fetch("/__fixture/rpc", { method: "POST", headers: { "Content-Type": "application/json", "X-Fixture-Role": role }, body: JSON.stringify({ name, args }) })).json();
  const mediaUrl = (storagePath) => `${location.origin}/__fixture/media?path=${encodeURIComponent(storagePath)}`;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: session() }, error: null }),
      getUser: async () => ({ data: { user: user() }, error: null }),
      onAuthStateChange(callback) { listeners.add(callback); return { data: { subscription: { unsubscribe() { listeners.delete(callback); } } } }; },
      signInWithPassword: async ({ email, password }) => {
        const requestedRole = String(email).split("@")[0];
        if (!["owner", "publisher", "editor", "viewer"].includes(requestedRole) || password !== "fixture-only") return { data: {}, error: { message: "Use owner@visual-fixture.invalid and fixture-only on this local fixture." } };
        role = requestedRole;
        sessionStorage.setItem("visual-fixture-role", role);
        listeners.forEach((callback) => callback("SIGNED_IN", session()));
        return { data: { user: user(), session: session() }, error: null };
      },
      signOut: async () => {
        role = "anonymous";
        sessionStorage.setItem("visual-fixture-role", role);
        listeners.forEach((callback) => callback("SIGNED_OUT", null));
        return { error: null };
      },
    },
    rpc: request,
    storage: { from() { return {
      createSignedUrl: async (storagePath) => ({ data: { signedUrl: mediaUrl(storagePath) }, error: null }),
      createSignedUrls: async (paths) => ({ data: paths.map((storagePath) => ({ path: storagePath, signedUrl: mediaUrl(storagePath) })), error: null }),
      getPublicUrl: (storagePath) => ({ data: { publicUrl: mediaUrl(storagePath) } }),
      upload: async (storagePath, file) => {
        const bitmap = await createImageBitmap(file);
        const dimensions = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return (await fetch(`/__fixture/upload?path=${encodeURIComponent(storagePath)}&width=${dimensions.width}&height=${dimensions.height}`, { method: "POST", headers: { "Content-Type": file.type, "X-Fixture-Role": role }, body: file })).json();
      },
      remove: async () => ({ data: [], error: null }),
      copy: async () => ({ data: {}, error: null }),
    }; } },
    functions: { invoke: async (name, { body }) => (await fetch("/__fixture/verify", { method: "POST", headers: { "Content-Type": "application/json", "X-Fixture-Role": role }, body: JSON.stringify(body) })).json() },
    from() {
      const chain = { select: () => chain, order: () => chain, range: () => request("fixture_revisions"),
        eq: () => chain, limit: () => chain, maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve, reject) => request("fixture_revisions").then(resolve, reject) };
      return chain;
    },
    channel() { const chain = { on: () => chain, subscribe: () => chain }; return chain; },
    removeChannel: async () => {},
  };
  window.supabase.createClient = () => client;
}

async function bodyOf(request, limit = 4 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new Error("Fixture request too large."); chunks.push(chunk); }
  return Buffer.concat(chunks);
}

export async function createVisualFixtureServer({ seed = await loadFixtureSeed(), dist = path.join(root, "dist") } = {}) {
  const backend = createFixtureState(seed);
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const role = String(request.headers["x-fixture-role"] || "anonymous");
    const send = (body, type = "application/json", status = 200) => {
      response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    try {
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) return send(fail("Cross-origin fixture requests are disabled."), "application/json", 403);
      if (url.pathname === "/__fixture/rpc" && request.method === "POST") {
        const { name, args } = JSON.parse(await bodyOf(request));
        return send(backend.rpc(name, args, role));
      }
      if (url.pathname === "/__fixture/state") return send({ ...backend.snapshot(), calls: backend.state.calls, simulated: true });
      if (url.pathname === "/__fixture/control") {
        const event = url.searchParams.get("event");
        if (event === "fail-save") backend.state.failures.set("save_portfolio_draft", "Simulated save failure. Your unsaved changes are still available.");
        if (event === "fail-publish") backend.state.failures.set("publish_portfolio", "Simulated publish failure. The public snapshot has not changed.");
        if (event === "conflict") backend.state.draftRevision += 1;
        if (event === "revoke-owner") backend.state.revoked.add("owner");
        if (event === "restore-owner") backend.state.revoked.delete("owner");
        if (event === "reset") { const fresh = createFixtureState(seed); Object.assign(backend.state, fresh.state); }
        response.writeHead(303, { Location: "/__fixture/" }); response.end(); return;
      }
      if (url.pathname === "/__fixture/") return send(`<!doctype html><title>Visual editor fixture</title><main style="font:16px system-ui;max-width:800px;margin:50px auto;padding:24px"><h1>Local visual editor fixture</h1><p>All accounts, uploads, verification and writes are simulated in memory. No Supabase requests or production changes are made.</p><p>${[...roles, "anonymous"].map((item) => `<a style="margin-right:16px" href="/admin?fixture=${item}">${item}</a>`).join("")}</p><p><a href="/?fixture=anonymous">Public visitor</a> · <a href="/__fixture/state">Inspect fixture state</a></p><h2>Next-operation controls</h2>${["fail-save", "fail-publish", "conflict", "revoke-owner", "restore-owner", "reset"].map((event) => `<form action="/__fixture/control" style="display:inline"><button style="margin:5px;padding:9px" name="event" value="${event}">${event}</button></form>`).join("")}<p>After setting a control, return to the editor tab. Revocation is checked when the editor window regains focus.</p><p>Local login: owner@visual-fixture.invalid / fixture-only. Substitute publisher, editor, or viewer for owner.</p><p>Draft revision ${backend.state.draftRevision}; published revision ${backend.state.publishedRevision}; public ${backend.state.publicEnabled ? "enabled" : "disabled"}.</p></main>`, "text/html");
      if (url.pathname === "/__fixture/adapter.js") return send(`(${browserAdapter.toString()})();`, "text/javascript");
      if (url.pathname === "/__fixture/upload" && request.method === "POST") {
        if (!["owner", "publisher", "editor"].includes(role) || backend.state.revoked.has(role)) return send(fail("Upload forbidden."), "application/json", 403);
        const asset = [...backend.state.media.values()].find((item) => item.storage_path === url.searchParams.get("path"));
        if (!asset) return send(fail("Reservation not found."), "application/json", 404);
        asset.bytes = await bodyOf(request);
        asset.width = Number(url.searchParams.get("width")); asset.height = Number(url.searchParams.get("height"));
        return send(ok({ path: asset.storage_path }));
      }
      if (url.pathname === "/__fixture/verify" && request.method === "POST") {
        if (!["owner", "publisher", "editor"].includes(role) || backend.state.revoked.has(role)) return send(fail("Verification forbidden."), "application/json", 403);
        const { assetId } = JSON.parse(await bodyOf(request));
        const asset = backend.state.media.get(assetId);
        if (!asset?.bytes) return send(fail("Upload not found."));
        Object.assign(asset, { status: "staged", byte_size: asset.bytes.length, frame_count: 1, total_pixels: asset.width * asset.height,
          checksum_sha256: createHash("sha256").update(asset.bytes).digest("hex"), verified_at: new Date().toISOString(), verification_version: 1 });
        const { bytes, ...record } = asset;
        return send(ok({ ...record, fixture_simulated_verification: true }));
      }
      if (url.pathname === "/__fixture/media") {
        const asset = [...backend.state.media.values()].find((item) => item.storage_path === url.searchParams.get("path"));
        return asset?.bytes ? send(asset.bytes, asset.mime_type) : send("Missing fixture media", "text/plain", 404);
      }
      if (!["GET", "HEAD"].includes(request.method)) return send("Method not allowed", "text/plain", 405);
      if (url.pathname === "/assets/config.js") return send(`window.PortfolioConfig=${JSON.stringify({ adminEnabled: true, showAdminLink: true, tweaksEnabled: false, noIndex: true, siteUrl: "", supabaseUrl: `http://${request.headers.host}`, supabasePublishableKey: "sb_publishable_local_fixture_only" })};window.PORTFOLIO_ENABLE_ADMIN=true;window.PORTFOLIO_ENABLE_TWEAKS=false;`, "text/javascript");
      let file = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (file !== dist && !file.startsWith(`${dist}${path.sep}`)) return send("Forbidden", "text/plain", 403);
      try { if (!(await stat(file)).isFile()) file = path.join(dist, "index.html"); } catch { file = path.join(dist, "index.html"); }
      let content = await readFile(file);
      if (file.endsWith("index.html")) content = content.toString().replace('<script src="/assets/vendor.js"></script>', '<script src="/assets/vendor.js"></script>\n<script src="/__fixture/adapter.js"></script>');
      return send(content, ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" })[path.extname(file)] || "application/octet-stream");
    } catch (error) { send(fail(error.message), "application/json", 500); }
  });
  return { server, backend };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = await createVisualFixtureServer();
  const port = Number(process.env.PORT || 4174);
  server.listen(port, "127.0.0.1", () => console.log(`Local simulated visual editor: http://127.0.0.1:${server.address().port}/__fixture/`));
}
