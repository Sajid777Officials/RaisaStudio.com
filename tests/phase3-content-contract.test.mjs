import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

async function loadContentApi(supabase = null) {
  const source = await read("content.jsx");
  const storage = new Map();
  const context = {
    console: { log() {}, warn() {}, error() {} },
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    window: {
      PortfolioCaseData: {
        g1: { side: "graphic", title: "Graphic case" },
        g2: { side: "graphic", title: "Second graphic case" },
        w1: { side: "webdev", title: "Web case" },
      },
      PortfolioSupabase: supabase,
      dispatchEvent() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "content.jsx" });
  return context.window.PortfolioContent;
}

test("schema v1 normalization preserves authoritative empty collections", async () => {
  const api = await loadContentApi();
  const baseline = api.normalize(api.defaults);
  assert.equal(baseline.schemaVersion, 1);
  assert.equal(api.schemaVersion, 1);

  const deleted = api.clone(baseline);
  deleted.projects.graphic = [];
  deleted.projects.webdev = [];
  deleted.cases = {};

  const normalized = api.normalize(deleted);
  assert.equal(normalized.projects.graphic.length, 0);
  assert.equal(normalized.projects.webdev.length, 0);
  assert.equal(Object.keys(normalized.cases).length, 0);

  const legacy = api.clone(baseline);
  delete legacy.schemaVersion;
  assert.equal(api.normalize(legacy).schemaVersion, 1);

  const future = api.clone(baseline);
  future.schemaVersion = 2;
  assert.throws(
    () => api.normalize(future),
    /newer than this app supports/
  );
});

test("canonical aliases, case relationships, and public visibility stay aligned", async () => {
  const api = await loadContentApi();
  const draft = api.normalize(api.defaults);

  draft.services.graphic[0].title = "Renamed service";
  draft.services.graphic[0].desc = "Renamed description";
  draft.services.graphic[0].is_active = false;
  draft.site.navigation[0].is_visible = false;
  draft.site.socialLinks[0].is_visible = false;
  draft.works.graphic[0].is_published = false;
  draft.projects.graphic[0].is_published = false;
  draft.cases.orphan = {
    project_id: "missing-work",
    side: "graphic",
    title: "Orphan",
  };

  const normalized = api.normalize(draft);
  assert.equal(normalized.services.graphic[0].name, "Renamed service");
  assert.equal(normalized.services.graphic[0].short_description, "Renamed description");
  assert.equal(normalized.cases.g1.project_id, "g1");
  assert.equal(normalized.cases.orphan.project_id, "");

  const publicContent = api.toPublicContent(normalized);
  assert.equal(publicContent.services.graphic.some((item) => item.id === normalized.services.graphic[0].id), false);
  assert.equal(publicContent.site.navigation.some((item) => item.id === normalized.site.navigation[0].id), false);
  assert.equal(publicContent.site.socialLinks.some((item) => item.id === normalized.site.socialLinks[0].id), false);
  assert.equal(publicContent.works.graphic.some((item) => item.id === "g1"), false);
  assert.equal(publicContent.projects.graphic.some((item) => item.id === normalized.projects.graphic[0].id), false);
  assert.equal(Object.values(publicContent.cases).some((item) => item.project_id === "g1"), false);
  assert.equal(Object.hasOwn(publicContent.cases, "orphan"), false);

  normalized.publicEnabled = false;
  assert.equal(api.toPublicContent(normalized).publicEnabled, false);
});

test("selected works resolve to exactly one side-local service category", async () => {
  const api = await loadContentApi();
  const normalized = api.normalize(api.defaults);

  for (const side of ["graphic", "webdev"]) {
    const services = normalized.services[side];
    assert.equal(normalized.works[side].length, 6);
    for (const work of normalized.works[side]) {
      const matches = services.filter(
        (service) => (service.slug || service.id) === work.category_id
      );
      assert.equal(matches.length, 1, `${side}/${work.id} must resolve to one service`);
    }
  }
});

test("selected-work normalization preserves valid categories and repairs legacy references", async () => {
  const api = await loadContentApi();
  const draft = api.clone(api.defaults);
  draft.services.graphic[4].id = "poster-service-id";
  const validCategoryId = draft.services.graphic[4].slug;
  draft.works.graphic = [
    { ...draft.works.graphic[0], id: "valid-work", category_id: "poster-service-id" },
    { ...draft.works.graphic[1], id: "invalid-work", category_id: "poster-series", cat: "Poster Series" },
    { ...draft.works.graphic[2], id: "missing-work", category_id: undefined, cat: "Display label only" },
  ];

  const firstPass = api.normalize(draft);
  const secondPass = api.normalize(draft);
  const validServiceIds = new Set(
    firstPass.services.graphic.map((service) => service.slug || service.id)
  );

  assert.equal(firstPass.works.graphic.length, 3);
  assert.equal(firstPass.works.graphic[0].category_id, validCategoryId);
  assert.notEqual(firstPass.works.graphic[1].category_id, "poster-series");
  assert.notEqual(firstPass.works.graphic[2].category_id, "display-label-only");
  assert.deepEqual(
    firstPass.works.graphic.map((work) => work.category_id),
    secondPass.works.graphic.map((work) => work.category_id)
  );
  for (const work of firstPass.works.graphic) {
    assert.equal(validServiceIds.has(work.category_id), true);
  }
});

test("normalization canonicalizes service aliases and removes deprecated image aliases", async () => {
  const api = await loadContentApi();
  const draft = api.clone(api.defaults);
  draft.services.graphic[0].id = "packaging-service-id";
  draft.projects.graphic[0].category_id = "packaging-service-id";
  draft.projects.graphic[0].images = [{
    url: "https://cdn.example.test/project.webp",
    alt: "Project detail",
    project_id: "stale-parent-id",
  }];
  draft.projects.graphic[0].gallery_images = undefined;
  draft.works.graphic[0].category_id = "packaging-service-id";
  draft.works.graphic[0].categoryId = "packaging-service-id";
  draft.works.graphic[0].category_slug = draft.services.graphic[0].slug;
  draft.works.graphic[0].images = [{
    src: "https://cdn.example.test/work.webp",
    alt: "Work detail",
    project_id: "stale-parent-id",
  }];
  draft.works.graphic[0].gallery_images = undefined;

  const normalized = api.normalize(draft);
  const project = normalized.projects.graphic[0];
  const work = normalized.works.graphic[0];
  assert.equal(project.category_id, draft.services.graphic[0].slug);
  assert.equal(work.category_id, draft.services.graphic[0].slug);
  assert.equal(Object.hasOwn(project, "images"), false);
  assert.equal(Object.hasOwn(work, "images"), false);
  assert.equal(Object.hasOwn(work, "categoryId"), false);
  assert.equal(Object.hasOwn(work, "category_slug"), false);
  for (const image of [project.gallery_images[0], work.gallery_images[0]]) {
    assert.equal(Object.hasOwn(image, "url"), false);
    assert.equal(Object.hasOwn(image, "src"), false);
    assert.equal(Object.hasOwn(image, "alt"), false);
    assert.match(image.image_url, /^https:\/\//);
    assert.match(image.alt_text, /detail$/i);
  }
  assert.equal(project.gallery_images[0].project_id, project.id);
  assert.equal(work.gallery_images[0].project_id, work.id);
});

test("admin mutations persist canonical service and work order", async () => {
  const [admin, content] = await Promise.all([
    read("admin-panel.jsx"),
    read("content.jsx"),
  ]);

  assert.match(
    admin,
    /const moveService[\s\S]*?moveArrayItem[\s\S]*?order:\s*serviceIndex\s*\+\s*1/
  );
  assert.match(
    admin,
    /const removeService[\s\S]*?filter[\s\S]*?order:\s*serviceIndex\s*\+\s*1/
  );
  assert.match(
    admin,
    /const moveWork[\s\S]*?moveArrayItem[\s\S]*?sort_order:\s*workIndex\s*\+\s*1/
  );
  assert.match(
    admin,
    /const removeWork[\s\S]*?filter[\s\S]*?sort_order:\s*workIndex\s*\+\s*1/
  );
  assert.match(admin, /onSave\(adminClone\(result\.publicContent \|\| result\.published\)\)/);
  assert.doesNotMatch(content, /missingDefaults/);
});

test("incremental migration validates, sanitizes, and protects publication RPCs", async () => {
  const sql = await read("supabase/migrations/202607290001_portfolio_schema_v1.sql");
  const functionCount = (sql.match(/create or replace function public\./gi) || []).length;
  const hardenedCount = (sql.match(/set search_path = ''/gi) || []).length;

  assert.equal(functionCount, hardenedCount);
  assert.ok(functionCount >= 10);
  assert.match(sql, /create or replace function public\.validate_portfolio_content\s*\(/i);
  assert.match(sql, /Portfolio content exceeds the 2 MiB document limit/i);
  assert.match(sql, /contains duplicate id/i);
  assert.match(sql, /create or replace function public\.sanitize_published_portfolio\s*\(/i);
  assert.match(sql, /public\.sanitize_published_portfolio\(\s*coalesce\(stored_content/i);
  assert.match(sql, /'publicEnabled', false/i);
  assert.match(sql, /'publicEnabled', true/i);
  assert.match(sql, /create or replace function public\.unpublish_portfolio\s*\(/i);
  assert.match(sql, /public\.has_admin_role\(array\['owner', 'publisher'\]\)/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /published_json = validated_content/i);
  assert.match(sql, /revoke all on function public\.sanitize_published_portfolio\(jsonb\)/i);
  assert.match(sql, /grant execute on function public\.unpublish_portfolio\(bigint\)\s+to authenticated/i);
  assert.doesNotMatch(sql, /\btruncate\b|\bdrop table\b|\bdelete\s+from\b/i);
});

test("guarded seed contains the exact canonical inventory and overwrite protections", async () => {
  const sql = await read("supabase/migrations/202607290002_seed_portfolio_content_v1.sql");
  const checksumMatch = sql.match(/Canonical JSON SHA-256:\s*([a-f0-9]{64})/i);
  const jsonMatch = sql.match(/\$portfolio_content_v1\$([\s\S]*?)\$portfolio_content_v1\$::jsonb/);

  assert.ok(checksumMatch, "Seed checksum is missing.");
  assert.ok(jsonMatch, "Embedded seed JSON is missing.");

  const content = JSON.parse(jsonMatch[1]);
  const checksum = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");

  assert.equal(checksum, checksumMatch[1].toLowerCase());
  assert.equal(content.schemaVersion, 1);
  assert.equal(Object.hasOwn(content, "schema_version"), false);
  assert.equal(content.services.graphic.length + content.services.webdev.length, 20);
  assert.equal(content.projects.graphic.length + content.projects.webdev.length, 20);
  assert.equal(content.works.graphic.length + content.works.webdev.length, 12);
  assert.deepEqual(
    Object.keys(content.cases).sort(),
    ["g1", "g2", "g3", "g4", "g5", "g6", "w1", "w2", "w3", "w4", "w5", "w6"]
  );
  for (const [caseId, caseData] of Object.entries(content.cases)) {
    assert.equal(caseData.project_id, caseId);
  }

  for (const guard of [
    /draft_json = '\{\}'::jsonb/i,
    /published_json = '\{\}'::jsonb/i,
    /draft_revision = 0/i,
    /published_revision = 0/i,
    /updated_by is null/i,
    /published_by is null/i,
    /published_at is null/i,
    /unpublished_at is null/i,
    /public_enabled is distinct from true/i,
    /exists \(select 1 from public\.portfolio_revisions\)/i,
    /exists \(select 1 from public\.portfolio_activity_log\)/i,
  ]) {
    assert.match(sql, guard);
  }
  assert.match(sql, /lock table public\.portfolio_content/i);
  assert.match(sql, /public\.validate_portfolio_content\(seed_content\)/i);
  assert.doesNotMatch(sql, /\bon conflict\b|\bupsert\b|\|\|\s*seed_content/i);
});

test("documented JSON schema and globally unavailable delivery state are wired", async () => {
  const [schemaSource, content, app, styles] = await Promise.all([
    read("supabase/portfolio-content-v1.schema.json"),
    read("content.jsx"),
    read("app.jsx"),
    read("styles.css"),
  ]);
  const schema = JSON.parse(schemaSource);

  assert.equal(schema.properties.schemaVersion.const, 1);
  for (const key of ["site", "studios", "services", "projects", "works", "cases"]) {
    assert.ok(schema.required.includes(key));
  }
  assert.match(content, /sb\.rpc\("unpublish_portfolio"/);
  assert.match(content, /publicEnabled:\s*false/);
  assert.match(app, /content\.publicEnabled === false/);
  assert.match(app, /portfolio-unpublished/);
  assert.match(styles, /\.portfolio-unpublished/);
});

test("authoritative whole-site unpublish replaces the public cache", async () => {
  const calls = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "get_published_portfolio") {
        return {
          data: { schemaVersion: 1, publicEnabled: false },
          error: null,
        };
      }
      if (name === "unpublish_portfolio") {
        return {
          data: {
            published_json: { schemaVersion: 1, publicEnabled: false },
            published_revision: 8,
            unpublished_at: "2026-07-29T00:00:00.000Z",
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const api = await loadContentApi(supabase);

  const loaded = await api.loadAsync();
  assert.equal(loaded.publicEnabled, false);
  assert.equal(api.load().publicEnabled, false);

  const result = await api.unpublish(7);
  assert.equal(result.publicContent.publicEnabled, false);
  assert.equal(result.publishedRevision, 8);
  assert.equal(api.load().publicEnabled, false);
  assert.deepEqual(
    calls.map(({ name }) => name),
    ["get_published_portfolio", "unpublish_portfolio"]
  );
  assert.equal(calls[1].args.p_expected_published_revision, 7);
});
