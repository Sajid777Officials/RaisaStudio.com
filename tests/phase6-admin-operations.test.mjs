import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

async function loadContentApi(supabase) {
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
      PortfolioCaseData: {},
      PortfolioSupabase: supabase,
      dispatchEvent() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "content.jsx" });
  return context.window.PortfolioContent;
}

test("owner-managed staff migration is server-authorized and protects the final owner", async () => {
  const sql = await read("supabase/migrations/202607290004_admin_operations.sql");

  for (const functionName of [
    "list_portfolio_admin_users",
    "add_portfolio_admin_user",
    "update_portfolio_admin_user",
    "get_portfolio_activity",
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\s*\\(`, "i"));
  }

  assert.equal((sql.match(/security definer/gi) || []).length, 4);
  assert.equal((sql.match(/set search_path = ''/gi) || []).length, 4);
  assert.match(sql, /public\.has_admin_role\(array\['owner'\]\)/i);
  assert.match(sql, /lock table public\.admin_users in share row exclusive mode/i);
  assert.ok(
    (sql.match(/lock table public\.admin_users in share row exclusive mode/gi) || []).length >= 2,
    "Both add/upsert and update paths must serialize the final-owner invariant"
  );
  assert.match(sql, /The last active owner cannot be demoted or deactivated/i);
  assert.match(sql, /Staff activation state is required/i);
  assert.match(sql, /from auth\.users as account/i);
  assert.match(sql, /No Supabase Auth account exists for that email address/i);
  assert.match(sql, /normalized_role not in \('owner', 'publisher', 'editor', 'viewer'\)/i);
  assert.match(sql, /on conflict \(user_id\) do update/i);
  assert.match(sql, /admin_user\.assigned/i);
  assert.match(sql, /admin_user\.updated/i);
  assert.match(sql, /admin_user\.deactivated/i);
  assert.match(sql, /'previous_role', previous_row\.role/i);
  assert.match(sql, /'previous_is_active', previous_row\.is_active/i);
  assert.doesNotMatch(sql, /service_role|supabase_service/i);
});

test("staff and enriched activity functions expose only authenticated RPC grants", async () => {
  const sql = await read("supabase/migrations/202607290004_admin_operations.sql");

  for (const signature of [
    "list_portfolio_admin_users\\(\\)",
    "add_portfolio_admin_user\\(text, text\\)",
    "update_portfolio_admin_user\\(uuid, text, boolean\\)",
    "get_portfolio_activity\\(integer, integer\\)",
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${signature} from public`, "i"));
    assert.match(sql, new RegExp(`grant execute on function public\\.${signature} to authenticated`, "i"));
  }

  assert.doesNotMatch(sql, /grant execute[\s\S]+to anon/i);
});

test("activity RPC is active-staff-only, bounded, and returns audit identities and targets", async () => {
  const sql = await read("supabase/migrations/202607290004_admin_operations.sql");

  assert.match(
    sql,
    /public\.has_admin_role\(array\['owner', 'publisher', 'editor', 'viewer'\]\)/i
  );
  assert.match(sql, /greatest\(coalesce\(p_offset, 0\), 0\)/i);
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 20\), 1\), 100\)/i);
  for (const field of [
    "action",
    "resource_type",
    "resource_id",
    "created_at",
    "actor_id",
    "actor_email",
  ]) {
    assert.match(sql, new RegExp(`'${field}'`, "i"));
  }
  assert.match(sql, /order by activity\.created_at desc, activity\.id desc/i);
  assert.match(sql, /left join auth\.users as account/i);
  assert.match(sql, /'count',\s*\(select count\(\*\) from public\.portfolio_activity_log\)/i);
  assert.match(sql, /\bcommit;\s*$/i);
});

test("deployment and admin documentation covers secure operations and all acceptance gates", async () => {
  const [readme, guide, checklist] = await Promise.all([
    read("README_DEPLOY.md"),
    read("docs/ADMIN_GUIDE.md"),
    read("docs/FINAL_VERIFICATION_CHECKLIST.md"),
  ]);

  assert.match(readme, /202607290003_secure_media_lifecycle\.sql[\s\S]+202607290004_admin_operations\.sql/i);
  assert.match(readme, /docs\/ADMIN_GUIDE\.md/i);
  assert.match(readme, /docs\/FINAL_VERIFICATION_CHECKLIST\.md/i);
  assert.match(readme, /no separate lint or type-check command/i);

  for (const topic of [
    "Sign in and session behavior",
    "Roles and permissions",
    "Create an account and assign a role",
    "Edit and save a draft",
    "Preview",
    "Publish",
    "Unpublish",
    "Restore a revision",
    "Media workflow",
    "Revision conflict recovery",
    "Safe sign out",
  ]) {
    assert.match(guide, new RegExp(`## ${topic}`, "i"));
  }

  assert.match(guide, /branded login surface/i);
  for (const role of ["Owner", "Publisher", "Editor", "Viewer"]) {
    assert.match(guide, new RegExp(`\\b${role}\\b`));
  }
  assert.match(guide, /Supabase Dashboard[\s\S]+Authentication[^]*Users/i);
  assert.match(guide, /CMS never creates Auth\s+accounts or sets passwords/i);
  assert.match(guide, /last active Owner/i);
  assert.match(guide, /updates the role and reactivates that row/i);
  assert.match(guide, /Owner access changed while it was being\s+processed/i);
  assert.match(guide, /another session changed the draft/i);
  assert.match(guide, /server session revocation could not be confirmed/i);
  assert.match(guide, /MEDIA_OPERATIONS\.md/i);
  assert.doesNotMatch(guide, /service_role[^`\n]*key[^.\n]*(?:put|paste|store|use) in (?:the )?(?:browser|frontend)/i);

  for (let acceptance = 1; acceptance <= 13; acceptance += 1) {
    assert.match(checklist, new RegExp(`\\| ${acceptance} \\|`));
  }
  assert.match(checklist, /375[^]*768[^]*1440/);
  assert.match(checklist, /Staging required/i);
  assert.match(checklist, /lint\/type-check unavailable/i);
  assert.match(checklist, /final local visual matrix has run[\s\S]*?does not claim that live Supabase integration has run/i);
});

test("content API centralizes staff and enriched activity RPC contracts", async () => {
  const calls = [];
  const owner = {
    user_id: "123e4567-e89b-42d3-a456-426614174000",
    email: "owner@example.test",
    role: "owner",
    is_active: true,
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
  };
  const editor = {
    ...owner,
    user_id: "123e4567-e89b-42d3-a456-426614174001",
    email: "editor@example.test",
    role: "editor",
  };
  const activity = {
    id: 42,
    action: "admin_user.assigned",
    resource_type: "admin_user",
    resource_id: editor.user_id,
    metadata: { role: "editor" },
    created_at: "2026-07-29T01:00:00.000Z",
    actor_id: owner.user_id,
    actor_email: owner.email,
  };

  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === "list_portfolio_admin_users") {
        return { data: [owner], error: null };
      }
      if (name === "add_portfolio_admin_user") {
        return { data: editor, error: null };
      }
      if (name === "update_portfolio_admin_user") {
        return {
          data: { ...editor, role: "publisher", is_active: false },
          error: null,
        };
      }
      if (name === "get_portfolio_activity") {
        return { data: { items: [activity], count: 1 }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };

  const api = await loadContentApi(supabase);
  const listed = await api.listAdminUsers();
  const added = await api.addAdminUser(" Editor@Example.Test ", "EDITOR");
  const updated = await api.updateAdminUser(editor.user_id, "PUBLISHER", false);
  const feed = await api.loadActivity({ offset: -4, limit: 500 });

  assert.deepEqual(JSON.parse(JSON.stringify(listed)), [owner]);
  assert.deepEqual(JSON.parse(JSON.stringify(added)), editor);
  assert.equal(updated.role, "publisher");
  assert.equal(updated.is_active, false);
  assert.equal(feed.items[0].actor_email, owner.email);
  assert.equal(feed.count, 1);
  assert.equal(api.listPortfolioAdminUsers, api.listAdminUsers);
  assert.equal(api.addPortfolioAdminUser, api.addAdminUser);
  assert.equal(api.updatePortfolioAdminUser, api.updateAdminUser);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: "list_portfolio_admin_users" },
    {
      name: "add_portfolio_admin_user",
      args: {
        p_email: "editor@example.test",
        p_role: "editor",
      },
    },
    {
      name: "update_portfolio_admin_user",
      args: {
        p_user_id: editor.user_id,
        p_role: "publisher",
        p_is_active: false,
      },
    },
    {
      name: "get_portfolio_activity",
      args: {
        p_offset: 0,
        p_limit: 100,
      },
    },
  ]);
});

test("staff and activity wrappers fail closed on malformed data or unsafe arguments", async () => {
  const calls = [];
  const supabase = {
    rpc: async (name) => {
      calls.push(name);
      if (name === "list_portfolio_admin_users") {
        return { data: {}, error: null };
      }
      if (name === "get_portfolio_activity") {
        return { data: { items: [], count: null }, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
  };
  const api = await loadContentApi(supabase);

  await assert.rejects(
    () => api.listAdminUsers(),
    /staff list is unavailable/i
  );
  await assert.rejects(
    () => api.updateAdminUser(
      "123e4567-e89b-42d3-a456-426614174001",
      "editor",
      undefined
    ),
    /activation state/i
  );
  await assert.rejects(
    () => api.loadActivity(),
    /activity feed is unavailable/i
  );
  assert.deepEqual(calls, [
    "list_portfolio_admin_users",
    "get_portfolio_activity",
  ]);
});

test("advanced admin UI wires protected operations and structured editing end to end", async () => {
  const [admin, styles] = await Promise.all([
    read("admin-panel.jsx"),
    read("styles.css"),
  ]);

  for (const contract of [
    /function AdminStaffPage\(/,
    /PortfolioContent\.listAdminUsers\(\)/,
    /PortfolioContent\.addAdminUser\(normalizedEmail, role\)/,
    /PortfolioContent\.updateAdminUser\(record\.user_id, record\.role, record\.is_active\)/,
    /canManageStaff \? \[\["staff"/,
    /activeTab === "staff" && canManageStaff/,
    /PortfolioContent\.unpublish\(publishedRevision\)/,
    /Unpublish site/,
    /setPublicEnabled\(state\.publicEnabled !== false\)/,
    /published=\{publishedContent\}/,
    /publicEnabled=\{publicEnabled\}/,
  ]) {
    assert.match(admin, contract);
  }

  for (const operation of [
    "duplicateService",
    "duplicateCategoryProject",
    "duplicateWork",
    "duplicateCase",
  ]) {
    assert.match(admin, new RegExp(`const ${operation} =`));
    assert.match(admin, new RegExp(`${operation}=\\{${operation}\\}`));
  }
  assert.match(admin, /adminCreateSafeId\(/);
  assert.match(admin, /adminCreateUniqueSlug\(/);
  assert.match(admin, /duplicateCase[\s\S]*?project_id: ""/);
  assert.match(admin, /linkCaseProject=\{linkCaseProject\}/);

  assert.match(admin, /const ADMIN_SEO_PAGES = \[/);
  assert.match(admin, /SEO by public page/);
  assert.match(admin, /updatePageSeo\(page, key, value\)/);
  assert.match(admin, /title="Case SEO"/);
  assert.match(admin, /updateCaseSeo=\{updateCaseSeo\}/);
  assert.match(admin, /Keywords, comma separated/);
  assert.match(admin, /Hero hover label/);

  assert.match(admin, /function adminCollectFieldErrors\(/);
  assert.match(admin, /revealValidationErrors\(nextFieldErrors\)/);
  assert.match(admin, /querySelector\('\[aria-invalid="true"\]'\)/);
  assert.match(admin, /firstErrorPath=\{Object\.keys\(fieldErrors\)\[0\] \|\| ""\}/);

  assert.match(admin, /Live preview/);
  assert.match(admin, /replace\(\/\[\._-\]\+\/g, " "\)/);
  assert.match(admin, /window\.setTimeout\(async \(\) => \{/);
  assert.match(admin, /onPreview\(adminClone\(hydrated\), \{ \.\.\.previewTarget, keepOpen: true \}\)/);
  assert.match(admin, /onPreview\(adminClone\(hydrated\), \{ \.\.\.previewTarget, keepOpen: false \}\)/);
  assert.match(admin, /stopLivePreview\(\{ restore: true \}\)/);
  assert.match(admin, /Jump to page \/ section/);

  assert.match(admin, /function adminCollectMediaReferences\(/);
  assert.match(admin, /workingReferences\.has\(record\.reference_token\)/);
  assert.match(admin, /Referenced by the unsaved browser working copy/);

  assert.match(admin, /window\.addEventListener\("focus", recheckAccess\)/);
  assert.match(admin, /document\.addEventListener\("visibilitychange", onVisibility\)/);
  assert.match(admin, /loadAuthorizedState\(data\.session, \{ hydrateDraft: false \}\)/);
  assert.match(admin, /role="dialog" aria-modal="true"/);
  assert.match(admin, /role="tab"[\s\S]*?aria-selected=\{activeTab === key\}/);
  assert.match(admin, /aria-label=\{show \? "Hide password" : "Show password"\}/);
  assert.doesNotMatch(admin, /admin-password-toggle[^>]+tabIndex=\{-1\}/);

  for (const selector of [
    ".admin-toolbar-navigation",
    ".admin-live-preview-toggle",
    ".admin-public-status",
    ".admin-activity-list",
    ".admin-seo-pages",
    ".admin-staff-card",
    ".admin-inline-warning",
    ".admin-field-error",
  ]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
});

test("admin source has no common UTF-8 mojibake sequences", async () => {
  const admin = await read("admin-panel.jsx");
  assert.doesNotMatch(admin, /(?:Â|Ã|â€|â€¦|�)/);
});
