import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("legacy browser passcodes and fallback sessions are absent", async () => {
  const source = (
    await Promise.all([
      read("Portfolio.html"),
      read("admin-panel.jsx"),
      read("admin.jsx"),
      read("scripts/build.mjs"),
      read("README_DEPLOY.md"),
    ])
  ).join("\n");

  const forbidden = [
    "66221266",
    "PORTFOLIO_ADMIN_PASSCODE",
    "adminPasscode",
    "Use passcode instead",
    "vox_admin",
    "browser-only mode",
  ];

  for (const value of forbidden) {
    assert.equal(source.includes(value), false, `Found forbidden legacy auth value: ${value}`);
  }
});

test("admin UI and content layer use the same protected draft/publish contract", async () => {
  const [content, admin] = await Promise.all([
    read("content.jsx"),
    read("admin-panel.jsx"),
  ]);

  for (const api of [
    "getAdminProfile",
    "loadAdminState",
    "saveDraft",
    "publishDraft",
    "loadActivity",
    "loadRevisions",
    "restoreRevision",
  ]) {
    assert.match(content, new RegExp(`\\b${api}\\b`));
    assert.match(admin, new RegExp(`PortfolioContent\\.${api}\\b`));
  }

  assert.doesNotMatch(admin, /PortfolioContent\.(save|reset)\b/);
  assert.match(admin, /This account does not have active portfolio admin access/);
  assert.match(admin, /Only an owner or publisher can publish/);
  assert.match(admin, /authRequestRef/);
  assert.match(admin, /authorizedUserIdRef/);
  assert.match(admin, /loadAuthorizedState\(session, \{ hydrateDraft \}\)/);
  assert.match(admin, /beforeunload/);
});

test("database migration denies direct draft access and enforces role checks", async () => {
  const sql = await read("supabase/migrations/202607260001_secure_portfolio_cms.sql");

  assert.match(sql, /alter table public\.portfolio_content enable row level security/i);
  assert.match(sql, /revoke all on table public\.portfolio_content from anon, authenticated/i);
  assert.match(sql, /security definer/gi);
  assert.match(sql, /public\.has_admin_role\(array\['owner', 'publisher', 'editor'\]\)/i);
  assert.match(sql, /public\.has_admin_role\(array\['owner', 'publisher'\]\)/i);
  assert.match(sql, /get_published_portfolio/i);
  assert.match(sql, /save_portfolio_draft/i);
  assert.match(sql, /publish_portfolio/i);
  assert.match(sql, /portfolio_publish_events/i);
  assert.match(sql, /bucket_id = 'portfolio-uploads'/i);
  assert.match(sql, /storage\.foldername\(name\)/i);
  assert.match(sql, /storage_path like/i);
  assert.match(sql, /create or replace function public\.can_delete_portfolio_upload/i);
  assert.match(sql, /strpos\(content\.draft_json::text, upload\.public_url\) = 0/i);
  assert.match(sql, /strpos\(content\.published_json::text, upload\.public_url\) = 0/i);
  assert.match(sql, /public\.can_delete_portfolio_upload\(name\)/i);
  assert.match(sql, /create or replace function public\.log_portfolio_upload_activity/i);
  assert.match(sql, /create trigger portfolio_upload_activity_trigger/i);
});

test("generated browser config contains no privileged or legacy auth material", async () => {
  const config = await read("dist/assets/config.js");

  assert.doesNotMatch(config, /adminPasscode|PORTFOLIO_ADMIN_PASSCODE/i);
  assert.doesNotMatch(config, /sb_secret_|service_role/i);
  assert.match(config, /"adminEnabled": (?:true|false)/);
  const context = { window: {} };
  vm.runInNewContext(config, context);
  const generated = context.window.PortfolioConfig;
  assert.equal(typeof generated.showAdminLink, "boolean");
  if (!generated.adminEnabled) assert.equal(generated.showAdminLink, false);
});

test("build rejects a Supabase secret key before writing browser assets", () => {
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_test_value",
      PORTFOLIO_ENABLE_ADMIN: "true",
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /secret key cannot be embedded in the browser/i);
});

test("build rejects unsafe backend URL schemes before writing browser assets", () => {
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_URL: "javascript:alert(1)",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value",
      PORTFOLIO_ENABLE_ADMIN: "true",
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /must use HTTPS/i);
});

test("build rejects legacy service_role JWT keys", () => {
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: `header.${payload}.signature`,
      PORTFOLIO_ENABLE_ADMIN: "true",
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /service_role key cannot be embedded/i);
});

test("production security headers restrict framing and backend origins", async () => {
  const [headers, html, legacyHtml, vendor, packageJson] = await Promise.all([
    read("dist/_headers"),
    read("dist/index.html"),
    read("Portfolio.html"),
    read("dist/assets/vendor.js"),
    read("package.json"),
  ]);

  assert.match(headers, /X-Frame-Options: DENY/i);
  assert.match(headers, /X-Content-Type-Options: nosniff/i);
  assert.match(headers, /frame-ancestors 'none'/i);
  assert.match(headers, /object-src 'none'/i);
  assert.match(headers, /connect-src 'self' https:\/\/api\.github\.com/i);
  assert.doesNotMatch(headers, /https:\/\/\*\.supabase\.co/i);
  assert.match(headers, /script-src 'self';/i);
  assert.doesNotMatch(headers, /unpkg\.com/i);
  assert.match(html, /<script src="\/assets\/vendor\.js"><\/script>/i);
  assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
  assert.match(legacyHtml, /<script src="dist\/assets\/vendor\.js"><\/script>/i);
  assert.doesNotMatch(legacyHtml, /<script[^>]+https?:\/\//i);
  assert.doesNotMatch(legacyHtml, /unpkg\.com|type="text\/babel"/i);
  assert.ok(vendor.length > 100_000, "The locally bundled runtime asset should not be empty.");

  const dependencies = JSON.parse(packageJson).dependencies || {};
  for (const name of ["react", "react-dom", "@supabase/supabase-js", "gsap", "three"]) {
    assert.match(dependencies[name] || "", /^\d+\.\d+\.\d+$/, `${name} must be pinned exactly.`);
  }
});

test("public UI consumes managed content, honors visibility, and supports draft preview", async () => {
  const [app, shared, graphic, webdev, styles] = await Promise.all([
    read("app.jsx"),
    read("shared.jsx"),
    read("graphic-page.jsx"),
    read("webdev-page.jsx"),
    read("styles.css"),
  ]);

  assert.match(app, /PortfolioContent\.subscribe/);
  assert.match(app, /CFG\.showAdminLink/);
  assert.match(app, /globalSeo\.canonicalUrl/);
  assert.match(app, /pageSeo\.canonicalUrl/);
  assert.match(app, /property="og:image"/);
  assert.match(app, /onPreview=\{previewDraft\}/);
  assert.match(shared, /site\?\.navigation/);
  assert.match(shared, /site\?\.socialLinks/);
  assert.match(shared, /site\?\.footer/);
  for (const page of [graphic, webdev]) {
    assert.match(page, /allowUnpublished = false/);
    assert.match(page, /filter\(project => allowUnpublished \|\| project\.is_published !== false\)/);
  }
  assert.match(styles, /\.portfolio-preview-banner/);
  assert.match(styles, /@media \(max-width: 900px\)/);
});

test("content API sends public, draft, and publish operations to the expected RPCs", async () => {
  const source = await read("content.jsx");
  const calls = [];
  const cached = new Map();
  const rpcResults = {
    get_published_portfolio: {
      site: {
        brandName: "Published Brand",
        contact: { email: "published@example.com" },
        seo: { title: "Published title", description: "Published description" },
      },
    },
    get_admin_profile: {
      user_id: "00000000-0000-0000-0000-000000000001",
      role: "owner",
      is_active: true,
    },
    get_portfolio_admin_state: {
      draft_json: { site: { brandName: "Draft Brand" } },
      published_json: { site: { brandName: "Published Brand" } },
      draft_revision: 4,
      published_revision: 2,
    },
    save_portfolio_draft: {
      draft_revision: 5,
      updated_at: "2026-07-26T00:00:00.000Z",
    },
    publish_portfolio: {
      published_json: { site: { brandName: "Published Brand" } },
      published_revision: 3,
      published_at: "2026-07-26T00:01:00.000Z",
    },
  };

  const context = {
    console,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    localStorage: {
      getItem: (key) => cached.get(key) ?? null,
      setItem: (key, value) => cached.set(key, value),
    },
    window: {
      PortfolioCaseData: {},
      dispatchEvent: () => {},
      PortfolioSupabase: {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return { data: rpcResults[name], error: null };
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context);

  const api = context.window.PortfolioContent;
  const published = await api.loadAsync();
  assert.equal(published.site.brandName, "Published Brand");

  const profile = await api.getAdminProfile();
  assert.equal(profile.role, "owner");

  const state = await api.loadAdminState();
  assert.equal(state.draftRevision, 4);
  assert.equal(state.publishedRevision, 2);

  const saved = await api.saveDraft(state.draft, 4);
  assert.equal(saved.draftRevision, 5);

  const publishedResult = await api.publishDraft(5);
  assert.equal(publishedResult.publishedRevision, 3);

  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      "get_published_portfolio",
      "get_admin_profile",
      "get_portfolio_admin_state",
      "save_portfolio_draft",
      "prepare_portfolio_media_promotion",
      "publish_portfolio",
    ]
  );
  assert.equal(calls[3].args.p_expected_revision, 4);
  assert.equal(calls[4].args.p_expected_draft_revision, 5);
  assert.equal(calls[5].args.p_expected_draft_revision, 5);
});
