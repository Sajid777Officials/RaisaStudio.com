import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";
import React from "react";
import { createFixtureState } from "../scripts/visual-editor-fixture.mjs";

async function client(backend = null, extra = {}) {
  const events = new Map();
  const storage = new Map();
  const context = vm.createContext({
    React, console, URL, Date, setTimeout, clearTimeout, ...extra,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    window: { PortfolioSupabase: backend, PortfolioCaseData: { g1: { title: "First case", side: "graphic" } },
      PortfolioIcons: {}, addEventListener: (type, fn) => events.set(type, fn), removeEventListener: (type) => events.delete(type), dispatchEvent() {} },
  });
  const source = await readFile(new URL("../content.jsx", import.meta.url), "utf8");
  vm.runInContext(source, context);
  const admin = await readFile(new URL("../admin-panel.jsx", import.meta.url), "utf8");
  vm.runInContext((await transform(`${admin}\nglobalThis.adminTest = { adminValidateContent, adminCollectFieldErrors, adminLoadMediaCatalog, adminClearMediaAccess, adminResolveMediaValue, adminMediaRecordCache };`, { loader: "jsx" })).code, context);
  return { api: context.window.PortfolioContent, admin: context.adminTest, events };
}

test("raw validation accepts a work whose slug equals its own id and rejects repeated gallery ids", async () => {
  const { api, admin } = await client();
  const content = api.normalize(api.defaults);
  content.works.graphic[0].slug = content.works.graphic[0].id;
  assert.equal(admin.adminValidateContent(content), "");
  const parent = content.projects.graphic[0];
  const image = { id: "one", project_id: parent.id, image_url: "https://example.test/a.png", alt_text: "A", sort_order: 1 };
  parent.gallery_images = [image, { ...image, sort_order: 2 }];
  assert.match(admin.adminValidateContent(content), /unique/i);
});

test("public cache hydration never reassigns content when its service was hidden", async () => {
  const { api } = await client();
  const content = api.normalize(api.defaults);
  const category = content.services.graphic[0].slug;
  content.services.graphic[0].is_active = false;
  const projected = api.toPublicContent(content);
  const reloaded = api.toPublicContent(projected);
  assert.equal(reloaded.services.graphic.some((service) => service.slug === category), false);
  assert.equal(reloaded.projects.graphic[0].category_id, category);
  assert.equal(reloaded.works.graphic[0].category_id, category);
});

test("media catalog reads beyond 500 assets and tolerates an interrupted upload", async () => {
  const records = Array.from({ length: 503 }, (_, index) => {
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return { asset_id: id, storage_path: `drafts/${id}/image.png`, name: `Image ${index}`, status: "staged" };
  });
  const calls = [];
  const backend = {
    rpc: async (name, { p_offset, p_limit }) => {
      assert.equal(name, "list_portfolio_media"); calls.push(p_offset);
      return { data: { items: records.slice(p_offset, p_offset + p_limit), count: records.length }, error: null };
    },
    storage: { from: () => ({ createSignedUrl: async (path) => path === records[0].storage_path
      ? { error: new Error("Missing staged object") }
      : { data: { signedUrl: `https://example.test/${path}` }, error: null } }) },
  };
  const { admin } = await client(backend);
  assert.equal((await admin.adminLoadMediaCatalog()).length, 503);
  assert.equal((await admin.adminLoadMediaCatalog()).length, 503);
  assert.equal(calls.at(-1), 500);
  assert.equal(await admin.adminResolveMediaValue(`media://${records[502].asset_id}`), `https://example.test/${records[502].storage_path}`);
});

test("a signed URL resolving after sign-out cannot repopulate the private cache", async () => {
  let finish;
  let signing;
  const started = new Promise((resolve) => { signing = resolve; });
  const backend = {
    rpc: async () => ({ data: { count: 1, items: [{ asset_id: "00000000-0000-4000-8000-000000000001", storage_path: "drafts/00000000-0000-4000-8000-000000000001/image.png" }] } }),
    storage: { from: () => ({ createSignedUrl: () => { signing(); return new Promise((resolve) => { finish = resolve; }); } }) },
  };
  const { admin } = await client(backend);
  const pending = admin.adminLoadMediaCatalog();
  await started;
  admin.adminClearMediaAccess();
  finish({ data: { signedUrl: "https://example.test/private" } });
  await assert.rejects(pending, /session changed/i);
  assert.equal(admin.adminMediaRecordCache.size, 0);
});

test("publication refresh works without Realtime and ignores an in-flight result after cleanup", async () => {
  let finish;
  const backend = { rpc: () => new Promise((resolve) => { finish = resolve; }) };
  const { api, events } = await client(backend);
  const updates = [];
  const unsubscribe = api.subscribe((content) => updates.push(content));
  const pending = events.get("portfolio-content-published")();
  unsubscribe();
  finish({ data: { publicEnabled: false }, error: null });
  await pending;
  assert.equal(updates.length, 0);
  assert.equal(events.size, 0);
});

test("production output includes contextual editor code and its layout", async () => {
  const [js, css] = await Promise.all(["app.js", "styles.css"].map((name) => readFile(new URL(`../dist/assets/${name}`, import.meta.url), "utf8")));
  assert.ok(js.includes("PortfolioVisualEditor") && js.includes("PortfolioWorkspaceUtils"));
  for (const selector of [".visual-admin-toolbar", ".visual-admin-drawer", ".visual-editor-picker"]) assert.ok(css.includes(selector));
});

test("browser fixture restoration accepts the same revision argument as the database", () => {
  const fixture = createFixtureState({ site: { brandName: "Fixture" } });
  const result = fixture.rpc("restore_portfolio_revision", {
    p_revision_id: fixture.state.revisions[0].id,
    p_expected_revision: fixture.state.draftRevision,
  }, "owner");
  assert.equal(result.error, null);
  assert.equal(result.data.draft_revision, 8);
});
