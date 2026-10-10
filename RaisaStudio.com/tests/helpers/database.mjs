import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFile, readdir } from "node:fs/promises";

// Real PostgreSQL execution with minimal Supabase-owned schemas. This checks
// migrations/RPCs/RLS, not GoTrue, Storage HTTP, Realtime, or the Edge gateway.
export async function createDatabase() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text,
      owner uuid, owner_id text, metadata jsonb, updated_at timestamptz default now(), unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create function storage.foldername(text) returns text[] language sql immutable as $$
      select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    grant usage on schema auth,storage,public to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to anon,authenticated,service_role;
    create publication supabase_realtime;
  `);
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  try {
    for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, directory), "utf8"));
    }
  } catch (error) {
    await db.close();
    throw error;
  }
  return db;
}

export const userIds = Object.fromEntries(["owner", "publisher", "editor", "viewer", "outsider"]
  .map((role, index) => [role, `00000000-0000-4000-8000-00000000000${index + 1}`]));

export async function seedUsers(db) {
  for (const [role, id] of Object.entries(userIds)) {
    await db.query("insert into auth.users(id,email) values ($1,$2)", [id, `${role}@example.test`]);
    if (role !== "outsider") await db.query("insert into public.admin_users(user_id,role) values ($1,$2)", [id, role]);
  }
}

export async function asRole(db, role, callback) {
  const databaseRole = role === "anonymous" ? "anon" : role === "service" ? "service_role" : "authenticated";
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",
    [userIds[role] || "", JSON.stringify({ role: databaseRole, sub: userIds[role] })]);
  await db.exec(`set role ${databaseRole}`);
  try { return await callback(); }
  finally { await db.exec("reset role"); }
}

export async function scalar(db, sql, params = []) {
  const result = await db.query(sql, params);
  return Object.values(result.rows[0] || {})[0];
}
