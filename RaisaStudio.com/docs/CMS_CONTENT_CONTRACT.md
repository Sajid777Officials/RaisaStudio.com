# CMS content contract

## Version and source of truth

The persisted document contract is `schemaVersion: 1`.

- Browser normalization: `content.jsx`
- Reviewable JSON Schema: `supabase/portfolio-content-v1.schema.json`
- Baseline database contract: `supabase/migrations/202607290001_portfolio_schema_v1.sql`
- Current strict validation and public projection:
  `supabase/migrations/202608040005_private_verified_media_and_strict_content.sql`
  with forward compatibility fixes in `202610090006_content_contract_compatibility.sql`
- Immutable initial seed: `supabase/migrations/202607290002_seed_portfolio_content_v1.sql`

The historical `v2` browser-cache suffix is only a cache namespace. It is not a
content schema version. Documents without a version marker are upgraded to v1.
The database accepts the one-way legacy alias `schema_version`, rejects a
document containing both spellings, removes the alias, and stores only
`schemaVersion`. A future version must have an explicit application and database
migration.

## Root collections

Schema v1 preserves the application shape:

- `site`: brand, contact, navigation, social, footer, and SEO
- `studios.graphic` and `studios.webdev`: page, hero, statistics, labels,
  visibility switches, and About copy
- `services.graphic` and `services.webdev`
- `projects.graphic` and `projects.webdev`: service-category projects
- `works.graphic` and `works.webdev`: selected work
- `cases`: case studies keyed by a stable route identifier
- optional `techStack` and `integrations`

Stored arrays and the `cases` map are authoritative when present. An explicit
empty collection means “no records” and is not repopulated from source defaults.
Defaults are used only when normalization encounters an omitted legacy or
first-run collection.

The managed studio fields include `heroHoverLabel`, `backLabel`, `crumbLabel`,
`stackLabel` (web), `servicesTitle`, `servicesSubtitle`,
`categoryCrumbLabel`, `allServicesLabel`, `workCtaLabel`, `projectCtaLabel`,
`loadMoreLabel`, `showTechStack` (web), `showServices`, `showPortfolio`, and
`showAbout`. Migration 005 fills only missing copies of these keys in existing
nonempty snapshots; an explicit JSON null or existing value is preserved and
then evaluated by the strict validator.

## Identities, relationships, and order

- Service, project, work, case-key, case-ID, and case-slug route aliases use a
  bounded path-safe identifier. `/`, `?`, `#`, `%`, whitespace, control
  characters, and reserved routes are rejected.
- Service/project/work IDs and slugs are unique across aliases in their scope;
  case key/ID/slug aliases are globally unambiguous.
- `order` and `sort_order` are bounded nonnegative integers. Palette/icon/index
  values, grid span, and integration limit have explicit integer ranges.
- Every project and work `category_id` resolves to exactly one service on the
  same side.
- Every case `project_id` resolves to exactly one work on its declared side,
  and only one case may refer to that work.
- Required names/titles and route fields must be trimmed and nonblank.

Pre-005 seed work used display-derived category values. During the coordinated
005 migration, any category already resolving to exactly one side-local service
is preserved; only missing/invalid values receive a deterministic side-local
service fallback. The migration records repair counts, validates the resulting
entire snapshot, and never drops a work.

The structured editor still performs early checks, but Postgres independently
enforces these relationships for every direct RPC caller.

## Draft and public representations

Postgres stores complete validated draft and published snapshots for authorized
editing, history, and restore. Anonymous callers never receive either raw
snapshot. `sanitize_published_portfolio(jsonb)` builds a new document from an
explicit allowlist of public fields; it does not subtract a short list from the
stored object.

The projection:

- keeps only allowlisted `site`, `studios`, service, project, work, case,
  technology, integration, gallery, and SEO fields;
- removes navigation/social records with `is_visible: false`;
- removes services with `is_active: false`;
- removes projects and works with `is_published: false`;
- removes a case unless the case itself is published and it resolves to an
  included work on the declared side; and
- preserves array order.

Draft preview uses the full authorized document. Whole-site publication is
stored separately in `portfolio_content.public_enabled`. When disabled,
`get_published_portfolio` returns the authoritative unavailable marker rather
than stale content. Publishing enables the site again.

## Strict server validation

Migration 005 replaces the permissive baseline validator. Save, publish,
restore, and the 005 forward reconciliation reject:

- non-object documents, unsupported/ambiguous versions, documents above 2 MiB,
  missing structures, wrong JSON types, and oversized collections;
- unknown leaf/record fields, `_`/`$` private keys, prototype-pollution keys,
  credential/token/storage metadata names, and unsafe control characters;
- unsafe schemes, malformed HTTPS hosts, credentials in URLs, backslashes,
  unbounded contact email values, and invalid `media://<uuid>` references;
- blank required display/route values, duplicate or cross-alias identifiers,
  ambiguous/missing relationships, and noninteger or out-of-range numbers; and
- a cover/gallery image without trimmed bounded alternative text.

The JSON Schema is a reviewable client contract and is closed with
`additionalProperties: false` for fixed records. Postgres remains the
authorization and write-validation boundary.

## Concurrency and callable boundaries

All content mutations retain optimistic revision checks. Save, publish,
restore, unpublish, and media deletion serialize in one lock order: the
singleton content row first, then referenced asset rows sorted by ID. This
prevents publication/deletion races. Media deletion is also denied while any
retained revision refers to the asset.

| Operation | Viewer | Editor | Publisher | Owner |
|---|---:|---:|---:|---:|
| Read admin state/history | Yes | Yes | Yes | Yes |
| Save validated draft | No | Yes | Yes | Yes |
| Publish or whole-site unpublish | No | No | Yes | Yes |
| Restore revision | No | No | Yes | Yes |
| Read sanitized published content/manifest | Public | Public | Public | Public |

Anonymous access is limited to `get_published_portfolio`,
`get_public_media_manifest`, and the narrowly scoped Storage signed-read
predicate. Authenticated admin state/save/publish/restore/unpublish/history,
activity, staff, and media RPCs enforce active roles. Helper functions and
canonical tables are not general browser write surfaces. Trusted byte
verification is the separate `verify-portfolio-media` Edge boundary described
in `docs/MEDIA_OPERATIONS.md`.

## Seed and forward reconciliation

Run `npm run seed:check`. It verifies migration 002's embedded JSON, semantic
checksum, and record inventory, then verifies that current defaults normalize
successfully. It no longer asserts that an immutable 2026 seed is byte-for-byte
identical to an evolving current editor contract.

Migration 002 initializes only an unequivocally pristine singleton and never
merges or overwrites an in-use CMS. Migration 005 owns forward reconciliation:
it locks the singleton, repairs the known pre-005 work relationship defect,
fills missing managed studio keys, strictly validates every nonempty current
draft and published snapshot, and records revisions/activity (plus a publish
event when the published snapshot changes). It does not trust-backfill media.

Never edit or regenerate an applied migration. Future intentional changes need
a new forward migration.

## Deployment procedure

1. Back up the database and Storage, inventory canonical assets, and pause CMS
   writes for the coordinated cutover.
2. Verify migration history and `npm run seed:check`.
3. Configure exact Edge origins and deploy the dormant verifier with its pinned
   static WASM as documented in `docs/MEDIA_OPERATIONS.md`.
4. Apply migrations in filename order through 006. A malformed legacy snapshot
   fails closed and must be deliberately repaired; it is never silently leaked.
5. Reverify preserved canonical staging sources or replace/re-upload them.
   Unverified legacy canonical objects intentionally fail closed.
6. Exercise Auth/RLS/Storage/Edge roles and fault cases in staging, deploy the
   matching frontend, and record evidence before production.

All migrations were executed in disposable PGlite PostgreSQL tests. No Edge
deployment or live Supabase database/Storage mutation was performed. Navigation
IDs may use built-in names such as `about`; reserved-name restrictions apply to
record route aliases. Ordinary multiline text, seeded project `num`, and case
timestamps are supported. Gallery IDs must be unique within their parent.
Restoration reconciles legacy work categories and missing studio defaults into
the new draft without changing the retained historical revision.
