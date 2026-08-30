import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");
const mediaMigration = "supabase/migrations/202607290003_secure_media_lifecycle.sql";
const mediaId = "123e4567-e89b-42d3-a456-426614174000";
const mediaToken = `media://${mediaId}`;

async function loadContentApi(supabase) {
  const source = await read("content.jsx");
  const storage = new Map();
  const events = [];
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
      removeItem: (key) => storage.delete(key),
    },
    window: {
      PortfolioCaseData: {},
      PortfolioSupabase: supabase,
      dispatchEvent: (event) => events.push(event),
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "content.jsx" });
  return { api: context.window.PortfolioContent, storage, events };
}

test("Phase 4 migration creates private staging and immutable public media boundaries", async () => {
  const sql = await read(mediaMigration);

  assert.match(sql, /create table if not exists public\.portfolio_media_assets/i);
  assert.match(sql, /create table if not exists public\.portfolio_media_references/i);
  assert.match(sql, /alter table public\.portfolio_media_assets enable row level security/i);
  assert.match(sql, /alter table public\.portfolio_media_references enable row level security/i);
  assert.match(sql, /revoke all on table public\.portfolio_media_assets from anon, authenticated/i);
  assert.match(sql, /revoke all on table public\.portfolio_media_references from anon, authenticated/i);

  assert.match(
    sql,
    /portfolio-media-drafts[\s\S]{0,500}(?:false|public\s*=\s*false)/i,
    "The draft bucket must be private"
  );
  assert.match(
    sql,
    /portfolio-media-public[\s\S]{0,500}(?:true|public\s*=\s*true)/i,
    "The published bucket must be explicitly public"
  );
  assert.match(sql, /3145728/);
  for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
    assert.match(sql, new RegExp(mime.replace("/", "\\/"), "i"));
  }

  for (const legacyPolicy of [
    "Editors can upload portfolio objects",
    "Editors can update portfolio objects",
    "Editors can delete portfolio objects",
    "Editors can insert uploads",
    "Editors can update uploads",
    "Editors can delete uploads",
  ]) {
    assert.match(
      sql,
      new RegExp(`drop policy if exists [\"']${legacyPolicy}[\"']`, "i"),
      `Expected the migration to retire legacy direct-write policy: ${legacyPolicy}`
    );
  }

  const createdPolicies = sql.match(/create policy[\s\S]*?;/gi) || [];
  const publishedUpdatePolicy = createdPolicies.find(
    (policy) =>
      /for\s+update/i.test(policy) &&
      /portfolio-media-public/i.test(policy)
  );
  assert.equal(
    publishedUpdatePolicy,
    undefined,
    "Published objects must never receive an UPDATE policy"
  );
});

test("media RPCs are hardened and enforce the intended role split", async () => {
  const sql = await read(mediaMigration);
  const rpcNames = [
    "create_portfolio_media_upload",
    "finalize_portfolio_media_upload",
    "list_portfolio_media",
    "get_public_media_manifest",
    "prepare_portfolio_media_promotion",
    "finalize_portfolio_media_promotion",
    "create_portfolio_media_replacement",
    "update_portfolio_media_alt_text",
    "get_portfolio_media_usage",
    "request_portfolio_media_deletion",
    "finalize_portfolio_media_deletion",
  ];

  for (const rpc of rpcNames) {
    assert.match(sql, new RegExp(`create or replace function public\\.${rpc}\\s*\\(`, "i"));
  }

  const functionCount = (sql.match(/create or replace function public\./gi) || []).length;
  const hardenedCount = (sql.match(/set search_path = ''/gi) || []).length;
  assert.equal(functionCount, hardenedCount, "Every media function must pin an empty search_path");

  assert.match(sql, /public\.has_admin_role\(array\['owner', 'publisher', 'editor', 'viewer'\]\)/i);
  assert.match(sql, /public\.has_admin_role\(array\['owner', 'publisher', 'editor'\]\)/i);
  assert.match(sql, /public\.has_admin_role\(array\['owner', 'publisher'\]\)/i);
  assert.match(sql, /grant execute on function public\.list_portfolio_media/i);
  assert.match(sql, /grant execute on function public\.get_public_media_manifest/i);
  assert.match(sql, /grant execute on function public\.prepare_portfolio_media_promotion/i);
  assert.match(sql, /grant execute on function public\.request_portfolio_media_deletion/i);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)\s+on\s+public\.portfolio_media_assets\s+to\s+authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(?:insert|update|delete)\s+on\s+public\.portfolio_media_references\s+to\s+authenticated/i);
});

test("publish, replacement, and deletion are reference-aware and immutable", async () => {
  const sql = await read(mediaMigration);

  assert.match(sql, /media:\\\/\\\/|media:\/\/|media:\\\/\//i);
  assert.match(sql, /portfolio_media_references/i);
  assert.match(sql, /draft/i);
  assert.match(sql, /published/i);
  assert.match(sql, /create or replace function public\.publish_portfolio\s*\(/i);
  assert.match(sql, /prepare_portfolio_media_promotion/i);
  assert.match(sql, /finalize_portfolio_media_promotion/i);
  assert.match(sql, /create_portfolio_media_replacement/i);
  assert.match(sql, /request_portfolio_media_deletion/i);
  assert.match(sql, /finalize_portfolio_media_deletion/i);
  assert.match(sql, /for update/i);
  assert.match(
    sql,
    /portfolio_media_references[\s\S]{0,1800}(?:exists|count)/i,
    "Deletion must consult canonical draft and published references"
  );
  assert.doesNotMatch(
    sql,
    /strpos\(content\.(?:draft_json|published_json)::text/i,
    "The new lifecycle must not use brittle substring deletion guards"
  );
  assert.doesNotMatch(
    sql,
    /storage\.objects[\s\S]{0,1000}\bfor\s+update\b[\s\S]{0,1000}portfolio-media-public/i,
    "Published Storage objects must not be mutable in place"
  );
});

test("admin media UI validates bytes, dimensions, alt text, and uses managed operations", async () => {
  const admin = await read("admin-panel.jsx");

  assert.match(admin, /ADMIN_MEDIA_MAX_BYTES\s*=\s*3\s*\*\s*1024\s*\*\s*1024/);
  assert.match(admin, /ADMIN_MEDIA_MAX_EDGE\s*=\s*6000/);
  assert.match(admin, /ADMIN_MEDIA_MAX_PIXELS\s*=\s*12\s*\*\s*1000\s*\*\s*1000/);
  assert.match(admin, /ADMIN_MEDIA_MAX_FRAMES\s*=\s*120/);
  assert.match(admin, /ADMIN_MEDIA_MAX_TOTAL_PIXELS\s*=\s*24\s*\*\s*1000\s*\*\s*1000/);
  assert.match(admin, /adminImageSignatureMatches/);
  assert.match(admin, /createImageBitmap/);
  assert.match(admin, /file\.slice\(0,\s*32\)\.arrayBuffer\(\)/);
  assert.match(admin, /file contents do not match the selected image type/i);
  assert.match(admin, /maxLength=\{500\}/);
  assert.match(admin, /Alternative text is required/i);
  assert.match(admin, /<progress\s+max="100"/);
  assert.match(admin, /role="status"\s+aria-live="polite"/);
  assert.match(admin, /adminCropImageFile/);
  assert.match(admin, /file\.type === "image\/gif"[\s\S]{0,100}"original"/);

  for (const rpc of [
    "create_portfolio_media_upload",
    "list_portfolio_media",
    "create_portfolio_media_replacement",
    "update_portfolio_media_alt_text",
    "request_portfolio_media_deletion",
    "finalize_portfolio_media_deletion",
  ]) {
    assert.match(admin, new RegExp(`\\b${rpc}\\b`, "i"));
  }
  assert.match(admin, /sb\.rpc\s*\(/);
  assert.match(admin, /sb\.functions\.invoke\s*\(\s*["']verify-portfolio-media["']/);
  assert.match(admin, /body:\s*\{\s*assetId:\s*reservation\.asset_id\s*\}/);
  assert.match(admin, /adminAssertVerifiedMediaResponse\s*\(data,\s*reservation\)/);
  assert.match(admin, /checksum_sha256/);
  assert.match(admin, /verified_at/);
  assert.match(admin, /verification_version/);
  assert.doesNotMatch(admin, /p_width:\s*inspection\.width/);
  assert.doesNotMatch(admin, /p_height:\s*inspection\.height/);
  assert.doesNotMatch(admin, /sb\.rpc\s*\(\s*["']finalize_portfolio_media_upload["']/);

  assert.match(admin, /ADMIN_MEDIA_DRAFT_BUCKET\s*=\s*["']portfolio-media-drafts["']/);
  assert.match(admin, /safe\.bucket\s*!==\s*ADMIN_MEDIA_DRAFT_BUCKET/);
  assert.match(admin, /\.from\(safe\.bucket\)/);
  assert.match(admin, /\.createSignedUrl\s*\([^,]+,\s*600\s*\)/);
  assert.match(admin, /upsert:\s*false/);
  assert.match(admin, /media:\/\/|`media:\/\/\$\{/);
  assert.doesNotMatch(admin, /\.getPublicUrl\s*\(/);
  assert.doesNotMatch(admin, /\.from\(["']portfolio_uploads["']\)\s*\.\s*(?:insert|update|delete)\s*\(/);
  assert.doesNotMatch(admin, /\.from\(["']portfolio-uploads["']\)\s*\.\s*(?:upload|update|remove)\s*\(/);
});

test("upload verification fails closed and cleans up an untrusted reservation", async () => {
  const admin = await read("admin-panel.jsx");

  assert.match(
    admin,
    /catch\s*\(verifierError\)\s*\{[\s\S]{0,240}adminRequestMediaDeletion\(reservation,\s*\{\s*bestEffort:\s*true\s*\}\)[\s\S]{0,120}throw verifierError/,
  );
  assert.match(admin, /value\.status\s*!==\s*["']staged["']/);
  assert.match(admin, /\^\[0-9a-f\]\{64\}\$/);
  assert.doesNotMatch(admin, /service[_-]?role/i);
});

test("public loading retains only safe legacy-bucket URLs", async () => {
  const calls = [];
  const supabase = {
    rpc: async (name) => {
      calls.push(name);
      if (name === "get_published_portfolio") {
        return {
          data: {
            schemaVersion: 1,
            site: {
              brandName: "Media site",
              seo: { title: "Media site", description: "Media contract", ogImage: mediaToken },
            },
          },
          error: null,
        };
      }
      if (name === "get_public_media_manifest") {
        return {
          data: {
            [mediaToken]: {
              bucket: "portfolio-uploads",
              path: `legacy/${mediaId}.webp`,
              public_url: "https://cdn.example.test/immutable/image.webp",
              alt_text: "Published example",
            },
            "media://123e4567-e89b-42d3-a456-426614174001": {
              bucket: "portfolio-uploads",
              path: "legacy/123e4567-e89b-42d3-a456-426614174001.webp",
              public_url: "javascript:alert(1)",
            },
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const { api } = await loadContentApi(supabase);
  const content = await api.loadAsync();

  assert.equal(content.site.seo.ogImage, "https://cdn.example.test/immutable/image.webp");
  assert.deepEqual(calls, ["get_published_portfolio", "get_public_media_manifest"]);
});

test("canonical private media uses batched signed URLs and separate tokenized caches", async () => {
  const rpcCalls = [];
  const storageCalls = [];
  const publicPath = `published/${mediaId}/immutable.webp`;
  const supabase = {
    rpc: async (name) => {
      rpcCalls.push(name);
      if (name === "get_published_portfolio") {
        return {
          data: {
            schemaVersion: 1,
            site: {
              brandName: "Bucket manifest",
              seo: { title: "Bucket manifest", description: "Bucket/path row", ogImage: mediaToken },
            },
            projects: {
              graphic: [{ id: "hidden", title: "Hidden", is_published: false }],
              webdev: [],
            },
          },
          error: null,
        };
      }
      if (name === "get_public_media_manifest") {
        return {
          data: {
            [mediaToken]: {
              bucket: "portfolio-media-public",
              path: publicPath,
              public_url: `https://cdn.example.test/storage/v1/object/public/portfolio-media-public/${publicPath}`,
              alt_text: "Manifest image",
            },
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: {
      from: (bucket) => ({
        createSignedUrls: async (paths, expiresIn) => {
          storageCalls.push({ bucket, paths, expiresIn });
          return {
            data: paths.map((objectPath) => ({
              path: objectPath,
              signedUrl: `https://cdn.example.test/storage/v1/object/sign/${bucket}/${objectPath}?token=signed`,
            })),
            error: null,
          };
        },
        getPublicUrl: () => { throw new Error("canonical media must never use a public URL"); },
      }),
    },
  };
  const { api, storage } = await loadContentApi(supabase);
  const content = await api.loadAsync();

  assert.equal(
    content.site.seo.ogImage,
    `https://cdn.example.test/storage/v1/object/sign/portfolio-media-public/${publicPath}?token=signed`
  );
  assert.deepEqual(rpcCalls, ["get_published_portfolio", "get_public_media_manifest"]);
  assert.deepEqual(JSON.parse(JSON.stringify(storageCalls)), [
    { bucket: "portfolio-media-public", paths: [publicPath], expiresIn: 300 },
  ]);

  const contentEnvelope = JSON.parse(storage.get(api.key));
  const manifestEnvelope = JSON.parse(storage.get(api.mediaManifestKey));
  assert.equal(contentEnvelope.content.site.seo.ogImage, mediaToken);
  assert.equal(contentEnvelope.content.projects.graphic.length, 0);
  assert.doesNotMatch(storage.get(api.key), /token=signed/);
  assert.match(manifestEnvelope.manifest[mediaToken].public_url, /\/object\/sign\/portfolio-media-public\//);
  assert.ok(manifestEnvelope.refreshAt < manifestEnvelope.expiresAt);
});

test("expired signed media and offline refreshes fail closed", async () => {
  const publicPath = `published/${mediaId}/immutable.webp`;
  let offline = false;
  const supabase = {
    rpc: async (name) => {
      if (offline) return { data: null, error: new Error("offline") };
      if (name === "get_published_portfolio") {
        return {
          data: {
            schemaVersion: 1,
            site: { seo: { title: "Fresh", description: "Fresh", ogImage: mediaToken } },
          },
          error: null,
        };
      }
      if (name === "get_public_media_manifest") {
        return {
          data: {
            [mediaToken]: { bucket: "portfolio-media-public", path: publicPath },
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths) => ({
          data: paths.map((objectPath) => ({
            path: objectPath,
            signedUrl: `https://cdn.example.test/storage/v1/object/sign/portfolio-media-public/${objectPath}?token=short`,
          })),
          error: null,
        }),
      }),
    },
  };
  const { api, storage } = await loadContentApi(supabase);
  const fresh = await api.loadAsync();
  assert.match(fresh.site.seo.ogImage, /token=short/);

  const contentEnvelope = JSON.parse(storage.get(api.key));
  const mediaEnvelope = JSON.parse(storage.get(api.mediaManifestKey));
  contentEnvelope.expiresAt = Date.now() + 60_000;
  mediaEnvelope.expiresAt = Date.now() - 1;
  storage.set(api.key, JSON.stringify(contentEnvelope));
  storage.set(api.mediaManifestKey, JSON.stringify(mediaEnvelope));
  assert.equal(api.load().publicEnabled, false, "an expired signed URL must not be hydrated");

  contentEnvelope.expiresAt = Date.now() - 1;
  storage.set(api.key, JSON.stringify(contentEnvelope));
  offline = true;
  const stale = await api.loadAsync();
  assert.equal(stale.publicEnabled, false, "offline refresh must not extend stale content");
});

test("old canonical public caches are discarded while legacy media remains usable", async () => {
  const supabase = {};
  const { api, storage } = await loadContentApi(supabase);
  storage.set(api.key, JSON.stringify({
    schemaVersion: 1,
    site: {
      seo: {
        title: "Unsafe old cache",
        description: "Unsafe old cache",
        ogImage: `https://cdn.example.test/storage/v1/object/public/portfolio-media-public/published/${mediaId}.webp`,
      },
    },
  }));
  assert.equal(api.load().publicEnabled, false);
  assert.equal(storage.has(api.key), false, "unsafe canonical cache should be removed");

  const legacyUrl = `https://cdn.example.test/storage/v1/object/public/portfolio-uploads/${mediaId}.webp`;
  storage.set(api.key, JSON.stringify({
    version: 1,
    cachedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    content: {
      schemaVersion: 1,
      site: { seo: { title: "Legacy", description: "Legacy", ogImage: legacyUrl } },
    },
  }));
  assert.equal(api.load().site.seo.ogImage, legacyUrl);
});

test("an explicit unpublished response clears every public cache", async () => {
  let unpublished = false;
  const supabase = {
    rpc: async (name) => {
      assert.equal(name, "get_published_portfolio");
      return unpublished
        ? { data: {}, error: null }
        : {
            data: {
              schemaVersion: 1,
              site: { seo: { title: "Published", description: "Published", ogImage: "" } },
            },
            error: null,
          };
    },
  };
  const { api, storage } = await loadContentApi(supabase);
  assert.equal((await api.loadAsync()).publicEnabled, true);
  storage.set(api.mediaManifestKey, JSON.stringify({ expiresAt: Date.now() + 60_000 }));

  unpublished = true;
  const unavailable = await api.loadAsync();
  assert.equal(unavailable.publicEnabled, false);
  assert.equal(storage.has(api.key), false);
  assert.equal(storage.has(api.mediaManifestKey), false);
});

test("publish promotes draft media before content and hydrates the result", async () => {
  const calls = [];
  const copyCalls = [];
  const signCalls = [];
  const progress = [];
  const publicPath = `published/${mediaId}/immutable.webp`;
  const publishedDocument = {
    schemaVersion: 1,
    site: {
      brandName: "Published media",
      seo: { title: "Published media", description: "Published", ogImage: mediaToken },
    },
  };
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "prepare_portfolio_media_promotion") {
        return {
          data: {
            items: [{
              asset_id: mediaId,
              source_bucket: "portfolio-media-drafts",
              source_path: `drafts/${mediaId}.webp`,
              destination_bucket: "portfolio-media-public",
              destination_path: `published/${mediaId}/immutable.webp`,
            }],
          },
          error: null,
        };
      }
      if (name === "finalize_portfolio_media_promotion") return { data: {}, error: null };
      if (name === "publish_portfolio") {
        return {
          data: {
            published_json: publishedDocument,
            published_revision: 9,
            published_at: "2026-07-29T00:00:00.000Z",
          },
          error: null,
        };
      }
      if (name === "get_public_media_manifest") {
        return {
          data: {
            [mediaToken]: {
              bucket: "portfolio-media-public",
              path: publicPath,
              public_url: null,
            },
          },
          error: null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: {
      from: (bucket) => ({
        copy: async (sourcePath, destinationPath, options) => {
          copyCalls.push({ bucket, sourcePath, destinationPath, options });
          return { data: {}, error: null };
        },
        createSignedUrls: async (paths, expiresIn) => {
          signCalls.push({ bucket, paths, expiresIn });
          return {
            data: paths.map((objectPath) => ({
              path: objectPath,
              signedUrl: `https://cdn.example.test/storage/v1/object/sign/${bucket}/${objectPath}?token=publish`,
            })),
            error: null,
          };
        },
      }),
    },
  };
  const { api, events } = await loadContentApi(supabase);
  const result = await api.publishDraft(7, {
    onProgress: (event) => progress.push(event),
  });

  assert.deepEqual(
    calls.map(({ name }) => name),
    [
      "prepare_portfolio_media_promotion",
      "finalize_portfolio_media_promotion",
      "publish_portfolio",
      "get_public_media_manifest",
    ]
  );
  assert.deepEqual(JSON.parse(JSON.stringify(copyCalls)), [{
    bucket: "portfolio-media-drafts",
    sourcePath: `drafts/${mediaId}.webp`,
    destinationPath: `published/${mediaId}/immutable.webp`,
    options: { destinationBucket: "portfolio-media-public" },
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(signCalls)), [
    { bucket: "portfolio-media-public", paths: [publicPath], expiresIn: 300 },
  ]);
  assert.equal(
    result.publicContent.site.seo.ogImage,
    `https://cdn.example.test/storage/v1/object/sign/portfolio-media-public/${publicPath}?token=publish`
  );
  assert.equal(result.publishedRevision, 9);
  assert.equal(events.length, 1);
  assert.ok(progress.some((entry) => entry.stage === "media"));
  assert.ok(progress.some((entry) => entry.stage === "publish"));
});

test("deployment and recovery documentation covers the complete media lifecycle", async () => {
  const [readme, guide] = await Promise.all([
    read("README_DEPLOY.md"),
    read("docs/MEDIA_OPERATIONS.md"),
  ]);

  assert.match(readme, /202607290003_secure_media_lifecycle\.sql/);
  assert.match(readme, /docs\/MEDIA_OPERATIONS\.md/);
  assert.match(readme, /portfolio-media-drafts/);
  assert.match(readme, /portfolio-media-public/);
  assert.match(readme, /legacy[\s\S]{0,160}read-only/i);

  for (const topic of [
    "Role and operation matrix",
    "Upload and crop workflow",
    "Preview and publication workflow",
    "Replacement workflow",
    "Alternative-text workflow",
    "Safe deletion workflow",
    "Legacy-media transition",
    "Backup and rollback",
    "Post-migration verification",
  ]) {
    assert.match(guide, new RegExp(topic, "i"));
  }
  assert.match(guide, /3 MiB/);
  assert.match(guide, /6,000 pixels/);
  assert.match(guide, /12 megapixels/);
  assert.match(guide, /Maximum animation frames: 120/);
  assert.match(guide, /24 megapixels/);
  assert.match(guide, /1[–-]500/);
  assert.match(guide, /300-second expiry/);
  assert.match(guide, /No migration[\s\S]{0,180}live\/local Supabase/i);
});
