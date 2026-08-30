# Secure media operations

## Scope and security boundary

Managed content stores `media://<uuid>` references, never durable signed URLs or
raw private paths. The browser may reserve and upload bytes with the signed-in
user's session, but it cannot declare an upload safe. The authenticated
`verify-portfolio-media` Edge Function downloads the server-derived reserved
object, fully decodes every bounded frame with ImageMagick WASM, hashes the
original bytes with SHA-256, and calls a `service_role`-only verification RPC.
The service key exists only in the Edge runtime.

| Component | Boundary |
|---|---|
| `portfolio-media-drafts` | Private staging; Editor or higher can insert only at an RPC-reserved path |
| `portfolio-media-public` | Private immutable delivery; public signed reads require enabled, referenced, published state |
| `portfolio-uploads` | Legacy public/read-only compatibility; no new direct writes |
| `portfolio_media_assets` | Canonical state, ownership, immutable object identity, decoded facts, checksum, and alt text |
| `portfolio_media_references` | Server-derived current draft/published references |
| `portfolio_revisions` | Retained historical references; these also block deletion |

The canonical delivery bucket is not public. `get_public_media_manifest`
returns approved bucket/path pairs, and the public client batches them through
`createSignedUrls(..., 300)`. Canonical direct `/object/public/` URLs are
invalid. The legacy bucket may continue returning its historical public URL.
Signed URLs are bearer capabilities until their 300-second expiry; unpublish
prevents new issuance but cannot revoke one already issued.

## Migration order

Back up database and Storage separately, pause CMS writes, and use a maintenance
window. Apply migrations in filename order:

```text
supabase/migrations/202607260001_secure_portfolio_cms.sql
supabase/migrations/202607290001_portfolio_schema_v1.sql
supabase/migrations/202607290002_seed_portfolio_content_v1.sql
supabase/migrations/202607290003_secure_media_lifecycle.sql
supabase/migrations/202607290004_admin_operations.sql
supabase/migrations/202608040005_private_verified_media_and_strict_content.sql
```

Migration 005 is intentionally forward-only. It makes the canonical delivery
bucket private, introduces trusted verification markers, closes the content
schema, and changes public delivery to signed URLs. It never fabricates a
trusted marker for an old object.

### Required 005 rollout

1. Back up all database rows, policies/functions, and all three media buckets.
2. Inventory every canonical non-legacy asset, including its status, staging
   object, delivery object, current references, and whether `verified_at` is
   null. Confirm the preserved staging source exists for every asset that must
   remain publishable.
3. Configure `PORTFOLIO_ALLOWED_ORIGINS` as comma-separated exact origins, for
   example `https://raisastudio.com,https://www.raisastudio.com`. No wildcard,
   path, credentials, query, or fragment is accepted. HTTPS is required except
   HTTP loopback (`localhost`, `127.0.0.1`, or `[::1]`) for local testing.
4. Deploy `verify-portfolio-media` first while the old frontend remains active;
   it is dormant because the old client does not invoke it. The checked-in
   `supabase/config.toml` sets `verify_jwt = true` and bundles `magick.wasm` via
   `static_files`.
5. Apply 005 in the maintenance window. Existing unverified canonical media now
   fails closed; this is expected and is not an automatic backfill.
6. Using an active Owner/Publisher (or the original Editor for that asset),
   invoke the verifier for each preserved canonical staging object. If a source
   is missing or fails decoding, replace/re-upload it through the new workflow;
   never write verification columns or trust-backfill metadata manually.
7. Run the Auth/RLS/Storage matrix and fault tests in staging, then deploy the
   matching signed-delivery frontend. End maintenance only after public pages
   render every expected image.

The vendored WASM is from `@imagemagick/magick-wasm@0.0.41`, is 14,593,449
bytes, and has SHA-256
`ba99b5aa165304d1091e0310d20e9a23afa9226ca16a2c12ccfd2d7ecf2840a9`.
Its upstream license and notice are retained under the function's
`third_party/` directory. Static-file deployment requires Supabase CLI 2.7 or
newer with its local Docker bundler; do not pass `--use-api`, because API-only
deployment omits `static_files`. The 14.59 MB WASM keeps the locally bundled
function below the 20 MB function limit, but staging must still prove bundle
acceptance, cold start, CPU, memory, and worst-case bounded full-decode behavior.

## Role and operation matrix

| Operation | Viewer | Editor | Publisher | Owner |
|---|---:|---:|---:|---:|
| List media and inspect usage | Yes | Yes | Yes | Yes |
| Obtain authorized draft previews | Yes | Yes | Yes | Yes |
| Reserve/upload/verify own private upload | No | Yes | Yes | Yes |
| Verify another user's upload | No | No | Yes | Yes |
| Create replacement and edit draft alt text | No | Yes | Yes | Yes |
| Save media tokens in a draft | No | Yes | Yes | Yes |
| Prepare/finalize promotion | No | No | Yes | Yes |
| Publish content containing media | No | No | Yes | Yes |
| Request private cleanup when never referenced | No | Yes | Yes | Yes |
| Delete delivery/legacy media after all guards clear | No | No | Yes | Yes |

UI visibility is not authorization. Postgres RPC grants, table RLS, Storage RLS,
and Edge JWT/role/origin checks enforce this matrix.

## Accepted image contract

- MIME types: JPEG, PNG, WebP, and GIF
- Maximum encoded size: 3 MiB
- Maximum decoded edge: 6,000 pixels
- Maximum decoded area per frame: 12 megapixels
- Maximum animation frames: 120
- Maximum decoded area across all frames: 24 megapixels
- Alternative text: 1-500 trimmed characters when an image is present
- Verification: magic/container parse, complete ImageMagick decode, exact MIME
  and reservation size, SHA-256, frame/dimension limits, and immutable Storage
  object ID/update/ETag binding
- Generated paths: randomized server-issued IDs; original display name is
  sanitized to 200 characters
- Crop output: at most 2,400 pixels on the longest edge
- GIF: original-only crop choice so animation is preserved

Browser checks are early feedback only. A renamed HTML file, truncated file,
polyglot, malformed container, decompression/dimension bomb, excessive
animation, or client-lied dimensions must fail at the Edge/SQL boundary.

## Upload and crop workflow

1. The user selects an image and supplies alternative text.
2. Browser checks reject obvious type/signature/size/dimension problems and
   optionally create a crop. These checks are not trusted.
3. `create_portfolio_media_upload` or `create_portfolio_media_replacement`
   reserves a randomized path in `portfolio-media-drafts`.
4. The authenticated client uploads exactly there with `upsert: false`.
5. The client invokes `verify-portfolio-media` with only `{ "assetId": "..." }`.
   Bucket, path, reserved MIME, and size are loaded server-side.
6. The Edge Function authenticates the JWT, requires an active
   Owner/Publisher/Editor, downloads through its server client, parses and fully
   decodes, hashes, and calls `record_portfolio_media_verification` using the
   built-in service key.
7. That service-only RPC binds decoded facts to the exact immutable Storage
   identity and moves `reserved` to `staged`. The response supplies the
   `media://` token and trusted preview facts.

`finalize_portfolio_media_upload` is compatibility/read-after-verify only. It
cannot accept browser dimensions as a verification marker. A failed verifier
means the asset is unusable; keep the error visible and clean up only through
the guarded workflow.

## Preview and publication workflow

- Admin draft previews use short-lived signed URLs; do not store them in JSON,
  logs, exports, or cache entries.
- `prepare_portfolio_media_promotion` locks the singleton then referenced assets
  in UUID order, requires the verified source identity to be unchanged, and
  reserves a new immutable canonical delivery path.
- Storage RLS permits the prepared copy only when its server metadata/ETag
  matches the verified source.
- `finalize_portfolio_media_promotion` rechecks source and destination identity
  before marking the asset published.
- `publish_portfolio` locks content then referenced assets, validates the strict
  content/public allowlist, and refuses tokens whose trusted copy is absent.
- `get_public_media_manifest` includes only current referenced published assets
  while the site is enabled; the client signs canonical paths for 300 seconds.

A failed copy/publish leaves the previous published snapshot in place. Never
substitute a draft signed URL or raw path.

## Replacement workflow

1. Reserve and verify a new asset; never overwrite the previous object.
2. Put the new `media://` token in the working draft and save.
3. Owner/Publisher promotes and publishes it.
4. The previous asset remains readable while current or retained revision
   references exist. Deletion is a separate guarded operation.

## Alternative-text workflow

Every nonempty cover/gallery image requires nonblank alt text at both client and
database boundaries. Managed asset alt text is copied to its published form at
the publication boundary. Use placement-specific gallery/cover alt fields when
one asset needs different descriptions in different contexts. Do not put file
names, URLs, or “image of” boilerplate in alt text.

## Safe deletion workflow

1. Inspect `get_portfolio_media_usage` and retained revision history.
2. Remove current draft/published references through save/publish.
3. A retained revision reference still blocks deletion. Preserve the audit
   export, then use a separately reviewed privileged retention procedure to
   prune eligible revisions if policy permits; there is no browser bypass.
4. Call `request_portfolio_media_deletion`. It locks the singleton first, then
   the asset, and rechecks current plus retained references.
5. Remove only the exact Storage paths returned by that operation.
6. Call `finalize_portfolio_media_deletion`; it repeats the same lock order and
   guards, confirms bytes are gone, and records the terminal state.

Never delete by copying a dashboard path or directly editing metadata.

## Legacy-media transition

`portfolio-uploads` remains public/read-only so existing URL-valued content can
render. Do not add or overwrite objects there. Replace legacy URLs incrementally
with verified managed tokens. Remove a legacy object only after current and
retained revision references are cleared and an independent object backup has
been verified. Legacy metadata backfill is not byte verification.

## Backup and rollback

Back up migration history, schema/grants/policies/functions, content/revisions/
activity/staff/media tables, all bucket bytes and object metadata, current draft
and published JSON, the deployed frontend, and environment-variable names.
Database backup alone may not contain Storage bytes.

Prefer another forward migration. If application rollback is unavoidable,
pause writes, restore a compatible content revision and frontend together, and
keep new tables/buckets until reconciliation is complete. Never drop applied
migrations or buckets as a rollback.

## Post-migration verification

In isolated staging verify:

- exact-origin CORS, missing/expired JWT, inactive/non-editor roles, and
  cross-editor ownership fail;
- renamed HTML, magic mismatch, truncation/trailing bytes, malformed JPEG scans,
  dimension bombs, and frame/total-pixel bombs fail;
- verifier retry is idempotent and altered Storage identity fails;
- canonical buckets are anonymous-direct-read denied while approved signed URLs
  work and expire after 300 seconds;
- disabled site, hidden/unpublished records, stale references, and unverified
  media cannot mint public delivery;
- Viewer/Editor/Publisher/Owner behavior matches the matrix;
- concurrent save/publish/restore/unpublish/delete does not deadlock or delete a
  current/retained reference;
- upload/copy/delete interruption and retry remain recoverable;
- legacy public URLs still render and reject direct writes.

Repository checks are static/mocked because this workspace has no Deno,
PostgreSQL, Supabase CLI, or Docker runtime. No migration, function deployment,
bucket change, upload, signing operation, or live/local Supabase mutation was
performed during implementation.
