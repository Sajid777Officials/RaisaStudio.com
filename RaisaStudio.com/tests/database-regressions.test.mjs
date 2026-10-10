import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { asRole, createDatabase, scalar, seedUsers, userIds } from "./helpers/database.mjs";

test("fresh migrations, strict content, permissions, and revision lifecycle execute in PostgreSQL", async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await seedUsers(db);
  const initial = await scalar(db, "select draft_json from public.portfolio_content where id=1");
  const validate = (content) => scalar(db, "select public.validate_portfolio_content($1::jsonb)", [JSON.stringify(content)]);
  const revision = () => scalar(db, "select draft_revision from public.portfolio_content where id=1");

  await t.test("seed including built-in about navigation and poster num is valid", async () => {
    assert.equal(initial.site.navigation.find((item) => item.id === "about").target, "about");
    assert.equal(initial.projects.graphic.find((item) => item.num).num, "26");
    assert.deepEqual(await validate(initial), initial);
  });
  await t.test("editor textareas, case timestamps, and identical work id/slug are accepted", async () => {
    const content = structuredClone(initial);
    content.studios.graphic.aboutBody = "First line\nSecond line\tTabbed\r\nThird line";
    content.cases.g1.updated_at = "2026-10-09T00:00:00.000Z";
    content.works.graphic[0].slug = content.works.graphic[0].id;
    assert.deepEqual(await validate(content), content);
  });
  await t.test("all stored image aliases and relative links reject unsafe values", async () => {
    for (const family of ["projects", "works"]) {
      const content = structuredClone(initial);
      const record = content[family].graphic[0];
      record[family === "projects" ? "image_url" : "cover_image_url"] = "https://example.test/cover.png";
      record.image = "javascript:alert(1)";
      record.cover_alt = "Cover";
      await assert.rejects(validate(content), /unsafe/i);
    }
    for (const value of ["/a%0d%0aInjected", "/a%5cb", "/a\\b", "/space here"]) {
      assert.equal(await scalar(db, "select public.portfolio_safe_https_url($1,true,false)", [value]), false);
    }
    const content = structuredClone(initial);
    content.site.brandName = "Bad\u0001text";
    await assert.rejects(validate(content), /unsafe string/i);
  });
  await t.test("gallery identity is unique within its parent", async () => {
    const content = structuredClone(initial);
    const record = content.projects.graphic[0];
    const image = { id: "gallery-one", project_id: record.id, image_url: "https://example.test/a.png", alt_text: "Detail", sort_order: 1 };
    record.gallery_images = [image, { ...image, sort_order: 2 }];
    await assert.rejects(validate(content), /duplicate.*image id/i);
  });
  await t.test("anonymous and unauthorized users cannot read drafts or write content", async () => {
    for (const role of ["anonymous", "outsider"]) {
      await asRole(db, role, async () => {
        await assert.rejects(db.query("select draft_json from public.portfolio_content"), /permission denied/i);
        await assert.rejects(scalar(db, "select public.get_portfolio_admin_state()"), /permission denied|access is required/i);
      });
    }
    const expected = await revision();
    await asRole(db, "viewer", async () => {
      assert.ok((await scalar(db, "select public.get_portfolio_admin_state()")).draft_json);
      await assert.rejects(scalar(db, "select public.save_portfolio_draft($1::jsonb,$2)", [JSON.stringify(initial), expected]), /access is required|permission denied/i);
    });
  });
  await t.test("save is private, stale writes fail, publication and unpublication are role protected", async () => {
    const content = structuredClone(initial);
    content.site.brandName = "Private regression marker";
    const expected = await revision();
    await asRole(db, "editor", async () => {
      const saved = await scalar(db, "select public.save_portfolio_draft($1::jsonb,$2)", [JSON.stringify(content), expected]);
      assert.equal(saved.draft_revision, Number(expected) + 1);
      await assert.rejects(scalar(db, "select public.save_portfolio_draft($1::jsonb,$2)", [JSON.stringify(content), expected]), /changed in another session/i);
      await assert.rejects(scalar(db, "select public.publish_portfolio($1)", [saved.draft_revision]), /Publisher access/i);
    });
    await asRole(db, "anonymous", async () => {
      assert.notEqual((await scalar(db, "select public.get_published_portfolio()")).site?.brandName, content.site.brandName);
    });
    const current = await revision();
    const published = await asRole(db, "publisher", () => scalar(db, "select public.publish_portfolio($1)", [current]));
    await asRole(db, "anonymous", async () => {
      assert.equal((await scalar(db, "select public.get_published_portfolio()")).site.brandName, content.site.brandName);
    });
    await asRole(db, "publisher", () => scalar(db, "select public.unpublish_portfolio($1)", [published.published_revision]));
    await asRole(db, "anonymous", async () => {
      assert.equal((await scalar(db, "select public.get_published_portfolio()")).publicEnabled, false);
    });
  });
  await t.test("historical seed revisions restore with deterministic schema reconciliation", async () => {
    const seedSql = await readFile(new URL("../supabase/migrations/202607290002_seed_portfolio_content_v1.sql", import.meta.url), "utf8");
    const legacy = JSON.parse(seedSql.split("$portfolio_content_v1$")[1]);
    const id = await scalar(db, "insert into public.portfolio_revisions(revision,kind,content_json) values (999,'draft',$1::jsonb) returning id", [JSON.stringify(legacy)]);
    const expected = await revision();
    const restored = await asRole(db, "owner", () => scalar(db, "select public.restore_portfolio_revision($1,$2)", [id, expected]));
    assert.equal(restored.draft_json.works.graphic.length, legacy.works.graphic.length);
    assert.equal(restored.draft_json.studios.graphic.showServices, true);
    await validate(restored.draft_json);
    assert.deepEqual(await scalar(db, "select content_json from public.portfolio_revisions where id=$1", [id]), legacy);
  });
  await t.test("owner management preserves the last active owner", async () => {
    await asRole(db, "owner", () => assert.rejects(scalar(db,
      "select public.update_portfolio_admin_user($1,'editor',true)", [userIds.owner]), /last active owner/i));
    await asRole(db, "editor", () => assert.rejects(scalar(db, "select public.list_portfolio_admin_users()"), /active owner/i));
  });
  await t.test("media reservation, trusted verification, promotion, and retained-history guards execute", async () => {
    const reserveSql = "select public.create_portfolio_media_upload('audit.png','image/png',68,'Audit pixel')";
    await asRole(db, "viewer", () => assert.rejects(scalar(db, reserveSql), /access|permission/i));
    const asset = await asRole(db, "editor", () => scalar(db, reserveSql));
    const token = `media://${asset.asset_id}`;
    const metadata = JSON.stringify({ mimetype: "image/png", size: 68, eTag: "audit-object-etag" });
    const insertObject = (bucket, path) => db.query("insert into storage.objects(bucket_id,name,owner,owner_id,metadata) values ($1,$2,$3::uuid,$3::text,$4::jsonb)", [bucket, path, userIds.editor, metadata]);
    await asRole(db, "editor", () => insertObject(asset.storage_bucket, asset.storage_path));
    await asRole(db, "editor", () => assert.rejects(scalar(db, "select public.finalize_portfolio_media_upload($1,1,1)", [asset.asset_id]), /verif/i));
    const verifySql = "select public.record_portfolio_media_verification($1,$2,$3,'image/png',68,1,1,1,1,1)";
    const verifyArgs = [asset.asset_id, userIds.editor, "a".repeat(64)];
    await asRole(db, "editor", () => assert.rejects(scalar(db, verifySql, verifyArgs), /permission denied/i));
    const verified = await asRole(db, "service", () => scalar(db, verifySql, verifyArgs));
    assert.equal(verified.status, "staged");
    await asRole(db, "service", () => assert.rejects(scalar(db, verifySql, [asset.asset_id, userIds.editor, "b".repeat(64)]), /immutable.*binding/i));
    const content = structuredClone(initial);
    content.site.seo.ogImage = token;
    const expected = await revision();
    const saved = await asRole(db, "editor", () => scalar(db, "select public.save_portfolio_draft($1::jsonb,$2)", [JSON.stringify(content), expected]));
    await asRole(db, "publisher", () => assert.rejects(scalar(db, "select public.publish_portfolio($1)", [saved.draft_revision]), /promot|publish/i));
    const promotion = await asRole(db, "publisher", () => scalar(db, "select public.prepare_portfolio_media_promotion($1)", [saved.draft_revision]));
    const destination = promotion.items[0];
    assert.equal(destination.asset_id, asset.asset_id);
    await asRole(db, "publisher", () => insertObject(destination.destination_bucket, destination.destination_path));
    await asRole(db, "publisher", () => scalar(db, "select public.finalize_portfolio_media_promotion($1)", [asset.asset_id]));
    await asRole(db, "publisher", () => scalar(db, "select public.publish_portfolio($1)", [saved.draft_revision]));
    await asRole(db, "anonymous", async () => {
      const manifest = await scalar(db, "select public.get_public_media_manifest()");
      assert.equal(manifest[token].path, destination.destination_path);
      assert.equal(await scalar(db, "select count(*)::integer from storage.objects where bucket_id='portfolio-media-drafts'"), 0);
    });
    await asRole(db, "owner", () => assert.rejects(scalar(db, "select public.request_portfolio_media_deletion($1)", [asset.asset_id]), /reference|published/i));
    const next = await asRole(db, "editor", () => scalar(db, "select public.save_portfolio_draft($1::jsonb,$2)", [JSON.stringify(initial), saved.draft_revision]));
    await asRole(db, "publisher", () => scalar(db, "select public.publish_portfolio($1)", [next.draft_revision]));
    await asRole(db, "owner", () => assert.rejects(scalar(db, "select public.request_portfolio_media_deletion($1)", [asset.asset_id]), /retained revision/i));
  });
});
