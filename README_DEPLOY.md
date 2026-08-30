# RAISA Studio Portfolio CMS

The portfolio is a static React/esbuild site with a Supabase-backed CMS. Public
visitors can read only the published content snapshot. Staff edit a separate
draft after Supabase authentication and a database-enforced role check.

## 1. Local setup

Use Node.js 22 or newer and install the exact lockfile dependencies:

```bash
npm ci
cp .env.example .env
npm run dev
```

Set these browser-safe values in `.env`:

```env
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_KEY
PORTFOLIO_ENABLE_ADMIN=true
PORTFOLIO_SHOW_ADMIN_LINK=true
PORTFOLIO_SITE_URL=https://your-domain.com
```

`PORTFOLIO_ENABLE_TWEAKS` enables the optional visual-tuning tools,
`PORTFOLIO_NO_INDEX` emits search-engine no-index metadata, and
`PORTFOLIO_SHOW_ADMIN_LINK` controls only the public Admin-link visibility.

An existing `SUPABASE_ANON_KEY` also works as a compatibility alias. Never use a
Supabase secret key, `service_role` key, database password, or admin password in
this file or in frontend code.

## 2. Install the secure database schema

Back up the target project first. In Supabase, open **SQL Editor → New query**
and apply these files in order:

```text
supabase/migrations/202607260001_secure_portfolio_cms.sql
supabase/migrations/202607290001_portfolio_schema_v1.sql
supabase/migrations/202607290002_seed_portfolio_content_v1.sql
supabase/migrations/202607290003_secure_media_lifecycle.sql
supabase/migrations/202607290004_admin_operations.sql
supabase/migrations/202608040005_private_verified_media_and_strict_content.sql
```

The schema migration preserves existing snapshots and formalizes
`schemaVersion: 1`. The seed initializes only an unequivocally pristine
singleton. It skips any database with existing draft, published, revision,
activity, or actor state rather than merging or overwriting it.

It creates:

- protected draft and published content snapshots;
- optimistic revision checks to prevent one browser overwriting another;
- revision history and activity logs;
- private draft-media staging and private immutable signed-delivery media;
- canonical media assets and draft/published reference records;
- role-protected RPC functions for save, publish, and restore;
- server-side document validation and a sanitized public projection;
- an Owner/Publisher-only whole-site unpublish RPC;
- a public publication event that never exposes draft content.

New media is staged in the private `portfolio-media-drafts` bucket. Published
bytes use immutable generated paths in the private `portfolio-media-public`
bucket and are delivered with 300-second signed URLs; replacement creates a new
asset instead of overwriting a published object. The legacy
`portfolio-uploads` bucket and metadata are retained read-only during the
transition. Do not remove legacy objects until their content references have
been migrated and verified.

Migration 005 is a coordinated cutover, not an automatic trust backfill. Before
production, inventory every existing canonical asset and its preserved staging
source. Deploy the dormant verifier first, apply 005 in a maintenance window,
then reverify each source or replace/re-upload it. Existing unverified canonical
media fails closed after 005. See the exact rollout in
[`docs/MEDIA_OPERATIONS.md`](docs/MEDIA_OPERATIONS.md).

### Deploy the trusted media verifier

`supabase/functions/verify-portfolio-media/index.ts` needs the built-in Edge
secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`. Never copy the service key into `.env`, frontend
code, logs, or content. Add one custom Edge secret:

```text
PORTFOLIO_ALLOWED_ORIGINS=https://raisastudio.com,https://www.raisastudio.com
```

Values are comma-separated exact origins. HTTPS is required except HTTP
loopback for local verification. The checked-in `supabase/config.toml` enables
gateway JWT verification and bundles the pinned ImageMagick WASM using
`static_files`. Deploy with Supabase CLI 2.7 or newer and its local Docker
bundler; do not pass `--use-api`, because API-only deployment does not bundle
`static_files`. The vendored WASM is 14,593,449 bytes and keeps the locally
bundled function below Supabase's 20 MB limit, but CPU, memory, cold-start, and
full-decode behavior still require staging proof. Configure and deploy with
commands like these (replace both placeholders):

```bash
supabase secrets set PORTFOLIO_ALLOWED_ORIGINS="https://raisastudio.com,https://www.raisastudio.com" --project-ref YOUR_PROJECT_REF
supabase functions deploy verify-portfolio-media --project-ref YOUR_PROJECT_REF
```

Deploy to staging and exercise real Auth/RLS/Storage before production. These
commands are documentation only; this repository work did not run a deployment.

## Architecture and callable boundaries

```text
Public browser -> get_published_portfolio + get_public_media_manifest
               -> Storage createSignedUrls(paths, 300) for canonical media

Authenticated admin -> admin state/history/activity/staff RPCs
                    -> save/publish/restore/unpublish RPCs
                    -> reserve/copy/delete media through RPC + Storage RLS
                    -> verify-portfolio-media(assetId only)

Edge verifier -> validates Origin + JWT + active editor role
              -> derives reserved Storage path from protected metadata
              -> full decode + SHA-256 + bounded animation checks
              -> service_role-only record_portfolio_media_verification
```

Anonymous callers can execute only the sanitized public content/manifest
surface and the narrowly scoped Storage read predicate used for signed URLs.
Authenticated staff can call only role-appropriate security-definer RPCs;
canonical tables remain direct-write denied. The Edge Function is the sole
trusted byte-verification writer. `service_role` bypass is never available to a
browser.

The first owner row should look like:

```sql
insert into public.admin_users (user_id, role, is_active)
values ('YOUR_AUTH_USER_UUID', 'owner', true)
on conflict (user_id) do update
set role = excluded.role,
    is_active = excluded.is_active,
    updated_at = now();
```

Create or invite each staff account through trusted Supabase Auth
administration first. Then an existing Owner can assign, change, or deactivate
its CMS role through the owner-only Staff workflow (or reviewed trusted tooling
calling the protected RPCs). The CMS never creates Auth accounts or handles
their passwords. The database prevents demoting or deactivating the final
active Owner.

## 3. Build and preview

```bash
npm run build
npm run preview
```

Open the preview URL and add `#admin`, for example:

```text
http://localhost:4173/#admin
```

Sign in with the Supabase Auth email and password. On a fresh database, verify
that the guarded seed created the expected content. If it intentionally skipped
an existing CMS, review that content instead of replacing it.

1. Review the server draft and publication status.
2. Make a harmless staging-only edit and choose **Save draft**.
3. Confirm that the public site did not change.
4. Choose **Publish** with an Owner or Publisher account.
5. Reload the public site and verify the published projection.

`Portfolio.html` is a compatibility entry for older local bookmarks. Run the
build first; it consumes the same pinned `dist/assets/*` runtime and generated
browser-safe configuration as the production entry.

## Roles

| Role | Read draft/history/media | Save draft | Stage/replace/edit alt/private cleanup | Publish/restore/unpublish | Promote/delete canonical delivery media |
|---|---:|---:|---:|---:|---:|
| `owner` | Yes | Yes | Yes | Yes | Yes |
| `publisher` | Yes | Yes | Yes | Yes | Yes |
| `editor` | Yes | Yes | Yes | No | No |
| `viewer` | Yes | No | No | No | No |

The UI reflects these permissions, but the real enforcement is in Postgres
grants, RLS policies, and protected functions.

## Content workflow

- **Save draft** stores changes privately and creates a revision.
- **Publish** copies the saved draft to the public snapshot.
- **Discard draft** removes only unsaved browser changes.
- **Preview** renders the current working copy in the real portfolio layout for
  this browser only; it does not publish or overwrite the public snapshot.
- **Reload** fetches the latest server draft and revisions.
- **History** can restore an older snapshot into the draft; restoring does not
  publish automatically.
- Records marked unpublished, inactive, or hidden are removed from the
  anonymous public JSON projection rather than only hidden by React.
- Whole-site unpublish is available to Owners and Publishers through the
  confirmed Dashboard action backed by the protected database RPC.
- JPEG, PNG, WebP, and GIF files receive browser preflight before upload. After
  upload, the trusted Edge verifier downloads the private reserved object,
  fully decodes and hashes it, then records its immutable Storage identity.
  Non-GIF images can be cropped; animated GIFs retain their original frames.
- Alternative text is required for new managed assets.
- Draft content stores stable `media://<uuid>` references. Authorized admin
  previews resolve private assets with short-lived signed URLs.
- Publishing promotes verified draft assets to immutable private delivery paths
  before the public document is finalized; public pages receive short-lived
  signed URLs, never a canonical public object URL.
- Replacement creates a new asset and updates the working draft; it never
  overwrites bytes at a published URL.
- Deletion is a prepare/finalize workflow and is denied while the current draft,
  current published snapshot, or any retained revision contains the asset.

## Production hosting

Build command:

```text
npm run build
```

Publish directory:

```text
dist
```

Configure the same environment variables in Netlify, Vercel, Cloudflare Pages,
or the chosen host. The Admin button is visible by default whenever the secure
Supabase backend is enabled. Set `PORTFOLIO_SHOW_ADMIN_LINK=false` only when you
intentionally want to hide it from public navigation; authorized staff can
still open `/#admin`.

Preserve SPA and extensionless-route hard reloads in production. The build emits
a Netlify/Cloudflare Pages-compatible `dist/_redirects` fallback; Vercel uses
the checked-in `vercel.json`. On another host, rewrite unresolved extensionless
and SPA routes to `index.html`, then directly hard-reload `/graphic`, `/webdev`,
`/about`, a service/category route, and a case route before release.

The generated `_headers` file includes CSP, framing protection, MIME sniffing
protection, a restricted referrer policy, and revalidation for unhashed runtime
assets. The exact runtime CSP origin is derived from `SUPABASE_URL`.

The formal content contract is documented in
[`docs/CMS_CONTENT_CONTRACT.md`](docs/CMS_CONTENT_CONTRACT.md).
The page-by-page editable field map and recovery-fallback boundary are in
[`docs/EDITABLE_CONTENT_INVENTORY.md`](docs/EDITABLE_CONTENT_INVENTORY.md).
The media lifecycle, migration, recovery, and admin procedures are documented
in [`docs/MEDIA_OPERATIONS.md`](docs/MEDIA_OPERATIONS.md).
Daily login, role, staff, editing, publishing, conflict-recovery, and sign-out
procedures are in [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md).
The 13-area release gate and staging evidence record are in
[`docs/FINAL_VERIFICATION_CHECKLIST.md`](docs/FINAL_VERIFICATION_CHECKLIST.md).
Record the resulting evidence and residual risks in
[`docs/FINAL_VERIFICATION_REPORT.md`](docs/FINAL_VERIFICATION_REPORT.md).

## Automated checks

```bash
npm run seed:check
npm run build
npm run check
npm run verify:browser
```

`seed:check` verifies migration 002's embedded JSON/checksum/inventory integrity
and confirms that the current defaults normalize successfully. Migration 005,
not a rewrite of immutable migration 002, reconciles newly managed studio fields
by filling missing keys only and recording revision/activity history.
`check` rebuilds production output and runs the available static/VM contract
tests. `verify:browser` performs the local browser matrix and writes evidence
under `artifacts/browser-verification`. Database, Auth, Storage, Edge runtime,
and role integration tests still require a separate local or staging Supabase
project. These repository checks do not upload, promote, delete, or mutate any
live Supabase object.

There is currently no separate lint or type-check command in `package.json`.
Do not report those checks as passed; use the final verification checklist to
record them as unavailable unless scripts are added later.

## Verification checklist

- [ ] Build succeeds with a publishable key.
- [ ] Build rejects `sb_secret_...` and legacy `service_role` JWT keys.
- [ ] No hard-coded passcode or browser-only admin fallback exists.
- [ ] A normal Auth user without `admin_users` access is rejected.
- [ ] `viewer` cannot save, upload, publish, or restore.
- [ ] `editor` can save drafts, stage media, and clean up unreferenced private assets but cannot publish, promote, or delete public media.
- [ ] `owner`/`publisher` can publish, restore, promote, and safely delete media.
- [ ] Draft edits are invisible to logged-out visitors before publication.
- [ ] Unpublished records are absent from the public RPC response.
- [ ] Whole-site unpublish replaces cached public content with the unavailable state.
- [ ] Published edits appear after reload/realtime refresh.
- [ ] Draft media is private and previewed only through an authorized signed URL.
- [ ] Canonical published media is direct-public-read denied and resolves only through approved 300-second signed URLs.
- [ ] Renamed, truncated, malformed, oversized, dimension/frame-bomb media fails trusted Edge verification.
- [ ] Published media cannot be overwritten in place or substituted after verification.
- [ ] Current or retained-revision referenced images cannot be deleted from the media library.
- [ ] Legacy public media still renders but cannot receive new direct writes.
- [ ] Desktop, tablet, and mobile admin layouts remain usable.

Supabase references:

- <https://supabase.com/docs/guides/database/postgres/row-level-security>
- <https://supabase.com/docs/guides/storage/security/access-control>
- <https://supabase.com/docs/guides/getting-started/api-keys>
