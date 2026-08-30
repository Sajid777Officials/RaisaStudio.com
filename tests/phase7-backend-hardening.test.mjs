import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath, encoding = "utf8") => readFile(path.join(root, relativePath), encoding);
const migrationPath = "supabase/migrations/202608040005_private_verified_media_and_strict_content.sql";
const edgePath = "supabase/functions/verify-portfolio-media/index.ts";

test("005 makes canonical delivery private and gates signed reads by publication state", async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /update storage\.buckets[\s\S]*?public\s*=\s*false[\s\S]*?where id = 'portfolio-media-public'/i);
  assert.match(sql, /create or replace function public\.can_read_portfolio_media_delivery_object/i);
  assert.match(sql, /asset\.status = 'published'/i);
  assert.match(sql, /reference\.scope = 'published'/i);
  assert.match(sql, /content\.public_enabled = true/i);
  assert.match(sql, /has_admin_role\(array\['owner','publisher','editor','viewer'\]\)/i);
  assert.match(sql, /create policy "Phase7 signed reads verified published media"/i);
  assert.match(sql, /to anon, authenticated[\s\S]*?can_read_portfolio_media_delivery_object/i);
  assert.match(sql, /'signed_url_expires_in',[\s\S]*?300/i);
  assert.match(sql, /legacy-public/i);
  assert.match(sql, /public_url',[\s\S]*?legacy_upload_id is not null/i);
});

test("trusted verification binds full decoded bytes to one immutable Storage identity", async () => {
  const sql = await read(migrationPath);
  for (const column of [
    "verified_sha256", "verified_mime_type", "verified_byte_size", "verified_width",
    "verified_height", "verified_frame_count", "verified_total_pixels", "verified_at",
    "verification_version", "verified_storage_object_id", "verified_storage_object_updated_at",
    "verified_storage_object_etag",
  ]) assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"));
  for (const limit of ["3145728", "6000", "12000000", "120", "24000000"]) assert.match(sql, new RegExp(limit));
  assert.match(sql, /create or replace function public\.record_portfolio_media_verification/i);
  assert.match(sql, /portfolio_request_is_service_role\(\)/i);
  assert.match(sql, /grant execute on function public\.record_portfolio_media_verification[\s\S]*?to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.record_portfolio_media_verification[\s\S]{0,100}?to authenticated/i);
  assert.match(sql, /verified media bindings are immutable/i);
  assert.match(sql, /object\.updated_at is not distinct from asset\.verified_storage_object_updated_at/i);
  assert.match(sql, /verified_storage_object_etag/i);
  assert.match(sql, /portfolio_public_copy_matches_verification/i);
  assert.match(sql, /delivery object is not the verified immutable copy/i);
  assert.match(sql, /trusted verify-portfolio-media Edge Function/i);
});

test("Edge verifier is pinned, origin/auth restricted, fully decodes, hashes, and derives the path server-side", async () => {
  const [source, config, wasm] = await Promise.all([
    read(edgePath),
    read("supabase/config.toml"),
    read("supabase/functions/verify-portfolio-media/magick.wasm", null),
  ]);
  assert.match(source, /npm:@supabase\/supabase-js@2\.111\.0/);
  assert.match(source, /npm:@imagemagick\/magick-wasm@0\.0\.41/);
  assert.doesNotMatch(source, /with\s*\{\s*type:\s*["']bytes["']/);
  assert.match(source, /Deno\.readFile\(new URL\("\.\/magick\.wasm", import\.meta\.url\)\)/);
  assert.match(config, /verify_jwt\s*=\s*true/);
  assert.match(config, /static_files\s*=\s*\["\.\/functions\/verify-portfolio-media\/magick\.wasm"\]/);
  assert.equal(wasm.byteLength, 14_593_449);
  assert.equal(createHash("sha256").update(wasm).digest("hex"), "ba99b5aa165304d1091e0310d20e9a23afa9226ca16a2c12ccfd2d7ecf2840a9");

  assert.match(source, /PORTFOLIO_ALLOWED_ORIGINS/);
  assert.match(source, /url\.protocol === "https:" \|\| \(url\.protocol === "http:" && loopback\)/);
  assert.match(source, /auth\.getUser\(token\)/);
  assert.match(source, /\["owner", "publisher", "editor"\]/);
  assert.match(source, /Only assetId is accepted/);
  assert.match(source, /select\("id,owner_id,status,mime_type,byte_size,staging_bucket,staging_path,legacy_upload_id"\)/);
  assert.match(source, /from\(asset\.staging_bucket\)[\s\S]*?download\(asset\.staging_path\)/);
  assert.doesNotMatch(source, /body\.(?:bucket|path|mime|width|height|checksum)/);
  assert.match(source, /probePng/);
  assert.match(source, /probeGif/);
  assert.match(source, /probeJpeg/);
  assert.match(source, /probeWebp/);
  assert.match(source, /scanHeaderLength[\s\S]*?offset \+= scanHeaderLength/);
  assert.match(source, /ImageMagick\.readCollection/);
  assert.match(source, /MagickFormat\.Rgba/);
  assert.match(source, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(source, /record_portfolio_media_verification/);
});

test("vendored verifier WASM instantiates and performs a real pixel decode", async () => {
  const [{ initializeImageMagick, ImageMagick }, wasm] = await Promise.all([
    import("@imagemagick/magick-wasm"),
    read("supabase/functions/verify-portfolio-media/magick.wasm", null),
  ]);
  await initializeImageMagick(wasm);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const decoded = ImageMagick.readCollection(png, (images) => ({
    frames: images.length,
    width: images[0]?.width,
    height: images[0]?.height,
    format: images[0]?.format,
  }));
  assert.deepEqual(decoded, { frames: 1, width: 1, height: 1, format: "PNG" });
});

test("strict server and reviewable schemas reject unknown/private/unsafe and ambiguous content", async () => {
  const [sql, schemaSource] = await Promise.all([read(migrationPath), read("supabase/portfolio-content-v1.schema.json")]);
  const schema = JSON.parse(schemaSource);
  assert.equal(schema.additionalProperties, false);
  for (const name of ["site", "studio", "service", "project", "work", "caseStudy", "galleryImage", "seo"]) {
    assert.equal(schema.$defs[name].additionalProperties, false, `${name} is closed`);
  }
  for (const field of [
    "heroHoverLabel", "backLabel", "crumbLabel", "servicesTitle", "servicesSubtitle",
    "categoryCrumbLabel", "allServicesLabel", "workCtaLabel", "projectCtaLabel",
    "loadMoreLabel", "showTechStack", "showServices", "showPortfolio", "showAbout",
  ]) assert.ok(schema.$defs.studio.properties[field], `studio schema includes ${field}`);

  assert.match(sql, /__proto__/i);
  assert.match(sql, /Unknown field/i);
  assert.match(sql, /portfolio_safe_https_url/i);
  assert.match(sql, /portfolio_safe_email/i);
  assert.match(sql, /cross-alias id\/slug/i);
  assert.match(sql, /category_id must resolve to exactly one service/i);
  assert.match(sql, /project_id must resolve to exactly one work/i);
  assert.match(sql, /requires bounded alternative text/i);
  assert.match(sql, /btrim\(item ->> 'title'\) = ''/i);
  assert.match(sql, /coalesce\(\(case_row\.value ->> 'is_published'\)::boolean, true\)/i);
  assert.match(sql, /jsonb_build_object\([\s\S]*?'schemaVersion'[\s\S]*?'site'[\s\S]*?'studios'[\s\S]*?'services'[\s\S]*?'projects'[\s\S]*?'works'[\s\S]*?'cases'/i);

  const httpsPattern = new RegExp(schema.$defs.https.pattern);
  assert.equal(httpsPattern.test("https://cdn.example.com/a.webp?x=1"), true);
  for (const unsafe of [
    "https://#fragment", "https://user@example.com/a", "https://example.com\\evil",
    "https://example.com/line\nbreak", "javascript:alert(1)", "data:image/png;base64,AAAA",
  ]) assert.equal(httpsPattern.test(unsafe), false, `reject ${JSON.stringify(unsafe)}`);
  const idPattern = new RegExp(schema.$defs.routeIdentifier.pattern);
  assert.equal(idPattern.test("safe-project_1"), true);
  for (const unsafe of ["bad/path", "bad?query", "bad#fragment", "bad%2fpath", " space"]) {
    assert.equal(idPattern.test(unsafe), false, `reject route id ${unsafe}`);
  }
});

test("content and deletion RPCs share singleton-to-asset locking and retained revisions block deletion", async () => {
  const sql = await read(migrationPath);
  for (const rpc of ["save_portfolio_draft", "restore_portfolio_revision", "publish_portfolio", "unpublish_portfolio"]) {
    const start = sql.indexOf(`create or replace function public.${rpc}`);
    assert.notEqual(start, -1, `${rpc} exists`);
    const body = sql.slice(start, sql.indexOf("$function$;", start) + 11);
    assert.match(body, /from public\.portfolio_content where id = 1 for update/i);
    assert.match(body, /lock_portfolio_media_assets/i);
  }
  for (const rpc of ["request_portfolio_media_deletion", "finalize_portfolio_media_deletion"]) {
    const start = sql.indexOf(`create or replace function public.${rpc}`);
    const body = sql.slice(start, sql.indexOf("$function$;", start) + 11);
    const singleton = body.search(/(?:perform|select)[\s\S]*?from public\.portfolio_content[\s\S]*?for update/i);
    const asset = body.search(/select \* into asset from public\.portfolio_media_assets[\s\S]*?for update/i);
    assert.ok(singleton >= 0 && asset > singleton, `${rpc} locks singleton before asset`);
    assert.match(body, /portfolio_media_has_retained_revision_reference/i);
  }
  assert.match(sql, /from public\.portfolio_revisions revision[\s\S]*?extract_portfolio_media_references/i);
  assert.match(sql, /retained revision history and cannot be deleted/i);
});

test("forward reconciliation preserves migration 002 and strictly repairs current snapshots", async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /create or replace function public\.portfolio_fill_missing_studio_defaults/i);
  assert.match(sql, /#> array\['studios',side_name,key_name\] is null/i);
  assert.match(sql, /result = '\{\}'::jsonb then return result/i);
  for (const field of ["heroHoverLabel", "projectCtaLabel", "loadMoreLabel", "showTechStack", "showServices", "showPortfolio", "showAbout"]) {
    assert.match(sql, new RegExp(`'${field}'`));
  }
  assert.match(sql, /'migration\.content_reconciled'/i);
  assert.match(sql, /create or replace function public\.portfolio_repair_work_categories/i);
  assert.match(sql, /create or replace function public\.portfolio_count_invalid_work_categories/i);
  assert.match(sql, /where work_value ->> 'category_id' in \(service ->> 'id', service ->> 'slug'\)/i);
  assert.match(sql, /ordinal = mod\(work_index, service_count\) \+ 1/i);
  assert.match(sql, /next_draft := public\.validate_portfolio_content\(/i);
  assert.match(sql, /next_published := public\.validate_portfolio_content\(/i);
  assert.match(sql, /draft_category_repairs/i);
  assert.match(sql, /published_category_repairs/i);
  assert.match(sql, /insert into public\.portfolio_revisions/i);
  assert.match(sql, /insert into public\.portfolio_publish_events/i);
  assert.doesNotMatch(sql, /update[\s\S]{0,50}202607290002_seed_portfolio_content_v1/i);
});

test("every 005 function pins an empty search path and service secrets never enter browser files", async () => {
  const [sql, edge, client, admin] = await Promise.all([read(migrationPath), read(edgePath), read("content.jsx"), read("admin-panel.jsx")]);
  const functionCount = (sql.match(/create or replace function public\./gi) || []).length;
  const pinnedCount = (sql.match(/set search_path = ''/gi) || []).length;
  assert.equal(pinnedCount, functionCount, "all migration functions pin search_path");
  assert.match(edge, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(`${client}\n${admin}`, /SUPABASE_SERVICE_ROLE_KEY|service_role_key/i);
});
