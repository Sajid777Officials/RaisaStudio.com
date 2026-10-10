# Codebase audit and verification report

Audit date: 2026-10-09 (UTC). Repository: `Sajid777Officials/RaisaStudio.com`.
GitHub patch baseline: `b74c6071a19e8755ad92a3f65cc1b7d51b4d479f`.

## Outcome and scope

The project-owned source, configuration, migrations, schemas, tests, scripts,
and documentation were reviewed. Confirmed defects were corrected, the supplied
contextual-editor work was preserved and integrated, and executable regression
coverage was added. The source and patch are ready for GitHub review. Nothing
was pushed, merged, or deployed to GitHub, Supabase, or a hosting provider.

The review used both supplied ZIPs and the repository baseline. Requirements
were derived from the deployment guide, CMS/media contracts, editable-content
inventory, tests, and implementation; no separate product specification was
provided. `AUDIT_FILE_INVENTORY.md` records the file-level review scope.

## Architecture and intended behavior

- React 18 runs a static SPA, compiled by esbuild from 14 ordered JSX modules.
  Runtime libraries are locally bundled. Clean routes cover Home, Graphic,
  Software, About, and cases; legacy hash links remain supported.
- `content.jsx` owns defaults, normalization, public projection, cache, and
  publication refresh. Visitors consume published content; authorized staff
  can privately preview saved or unsaved drafts.
- The contextual editor and structured forms use Supabase Auth and active
  database staff roles. Protected RPCs separate save, publish, unpublish,
  restore, and staff operations; optimistic revisions detect stale writes.
- PostgreSQL migrations enforce content validation, roles/RLS, revision history,
  and media references. Uploads enter private staging, undergo trusted Edge
  verification with pinned ImageMagick WASM decoding, and promote to immutable
  private objects delivered through expiring signed URLs.
- The host supplies SPA fallback and headers. Browser JavaScript updates route
  metadata; non-JavaScript social crawlers still need host rendering support.

## Confirmed issues and corrections

| Area | Root cause and focused fix | Principal files |
|---|---|---|
| Editor missing in production | Contextual editor/helper modules and CSS were omitted from the build. Bundle them in order, fix the stylesheet entry, and complete toolbar/drawer/resource layout. | `scripts/build.mjs`, `Portfolio.html`, `visual-editor.jsx`, `visual-editor.css`, `workspace-utils.jsx` |
| Wrong contextual record | Index-based or stale selection and retained filters selected or hid the wrong item. Use stable record/gallery IDs, select/reveal the exact item, and align annotations. | `admin-panel.jsx`, studio pages, `case-sheet.jsx`, `shared.jsx`, `app.jsx` |
| Lost edits and stale saves | Save responses could overwrite newer edits or arrive after session changes; mutations could overlap. Serialize operations, track edit/access generations, preserve dirty work, and show failures. Reset/import/restore use the same bookkeeping. | `admin-panel.jsx` |
| Upload overwrites image/alt | Separate callbacks updated stale gallery snapshots. Apply media and alt text atomically, synchronize aliases, and use `alt_text` consistently. | `admin-panel.jsx` |
| Typing loses focus | Editable labels/values were React keys. Replace them with stable row identity for those fixed-order form rows. | `admin-panel.jsx` |
| Incomplete/stale media previews | Reads stopped at 500 assets; one incomplete object could break all previews; signed URLs expired or repopulated cache after sign-out. Fetch all pages, isolate signing failures, refresh URLs, and reject stale-session results. | `admin-panel.jsx` |
| Crop and nested dialogs | WebP crop output lost alpha; competing keyboard handlers could close multiple overlays. Preserve supported alpha and respect nested-dialog keyboard/focus ownership. | `admin-panel.jsx`, `app.jsx`, `case-sheet.jsx`, both studio pages |
| Preview/public mismatch | Lists filtered unpublished records even in private preview; open dialogs held stale objects. Pass explicit preview permission, derive dialogs from current IDs, and clear unavailable items. | `app.jsx`, `graphic-page.jsx`, `webdev-page.jsx` |
| Case aliases and visibility | Lookup, metadata, and navigation disagreed about keys/IDs/slugs and hidden cases. Resolve aliases consistently and enforce publication checks on linked work and related/previous/next cases. | `app.jsx`, `case-sheet.jsx`, `shared.jsx` |
| Public refresh/category drift | Refresh assumed Realtime and notified after cleanup. Public hydration reassigned references when inactive services were removed. Support local publication events independently, discard stale results, and preserve public category references. | `content.jsx` |
| Browser lifecycle | Hash changes were not observed; storage failures interrupted flows; requests/animations outlived components. Add hash handling, guarded storage, cancellation, and cleanup. | `app.jsx`, `webdev-page.jsx`, `admin-panel.jsx` |
| Statistics render incorrectly | Numeric animation stripped decimals/formatting or retained stale values. Restrict numeric parsing and restore the exact configured display value. | `webdev-page.jsx` |
| Hidden titles/content | Titles required mouse hover; reduced-motion CSS kept delays while JS still hid reveal elements. Keep visible fallbacks, bypass hover for touch/reduced motion, handle keyboard focus, skip JS reveals, and clear delays. | `hero.jsx`, both studio pages, `styles.css` |
| Split-header readability | Blend modes inside the header stacking context failed over the cream/navy split; the default long title broke mid-word with fallback fonts. Give split navigation a readable surface and size the Software title line to fit. | `styles.css`, `scripts/verify-browser.mjs` |
| Effects/control resilience | Effects assumed rendering APIs or ran when unnecessary; native cursor hiding did not depend on initialization. Guard canvas/WebGL/zero-size states, skip reduced-motion loops, condition cursor hiding, and label tuning controls. | `hero.jsx`, `cursor.jsx`, `styles.css`, `tweaks-panel.jsx` |
| Fresh migrations fail | Strict validation rejected built-in `about` navigation ID and poster `num`. Correct the fresh-install migration and add migration 006 for existing installations; preserve immutable seed 002. | migrations 005/006, content JSON schema |
| UI/database contract mismatch | Multiline text and case timestamps were rejected; identical work ID/slug counted twice in client validation. Align accepted fields/text while retaining strict unsupported-field/control-character rejection. | `admin-panel.jsx`, migrations 005/006, JSON schema |
| Unsafe stored aliases/links | Validation coalesced image aliases and missed unsafe secondary values; relative URLs admitted unsafe encodings. Check every alias, harden relative URLs, and reject duplicate gallery IDs in client/database. | `admin-panel.jsx`, migrations 005/006 |
| Historical restore fails | Old revisions lacked current studio fields/category references. Reconcile known legacy shapes before validation without rewriting historical revisions. | migrations 005/006 |
| Media decode/request limits | Animation frame rectangles could exceed the logical canvas before decode; valid GIF subframes were rejected; request caps applied after reading. Bound GIF/APNG/WebP geometry, accept valid subframes, cap streamed bodies, and fix the Deno hash input type. | Edge verifier `index.ts` |
| Build and verification mismatches | Netlify used Node 20 despite a 22+ requirement; preview missed MIME types; fixtures used an invalid async default parameter/wrong restore argument; tests targeted obsolete UI. Align runtime, MIME, fixture contracts, and meaningful assertions. | `netlify.toml`, preview/fixture scripts, existing tests |

## Verification

Environment: Linux, Node.js 24.19.0, npm 11.9.0, Chromium 153, Deno 2.9.6.

| Check | Result |
|---|---|
| `npm ci` | Passed with the exact lockfile |
| `npm run build` | Passed; 14 JSX files |
| `npm run seed:check` | Passed; immutable seed SHA-256 `14a82361ccff180240f7444a378721c46eb5c8c1a68f18f8d7c45aeaa6fb6b57` |
| `npm run check` | 94 tests passed; 0 failed/skipped |
| `npm run verify:browser` | 22 scenarios and 22 screenshots; 0 failures/warnings; includes reduced-motion visibility, touch, keyboard, and default-title wrapping |
| `npm run verify:editor` | 9 scenarios passed; 0 JavaScript errors |
| Edge TypeScript | Deno `check --no-config --node-modules-dir=manual supabase/functions/verify-portfolio-media/index.ts` passed; use `npm run typecheck:edge` with Deno installed |
| Script syntax | `node --check` passed for project-owned JS/MJS scripts/tests; esbuild checks JSX syntax |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| `git diff --check` | Passed |
| Lint/frontend static types | No configured linter or frontend TypeScript project; these unavailable checks are not claimed as passed |

New executable coverage:

- `tests/database-regressions.test.mjs` and `tests/helpers/database.mjs` run all
  seven migrations in PGlite/PostgreSQL with minimal Auth/Storage schemas and
  JWT/role stubs. They exercise seed validity, strict validation, permissions,
  stale revisions, private save, publish/unpublish/restore, last-owner protection,
  and media reserve/verify/promote/reference protections.
- `tests/verifier-regressions.test.mjs` covers animation header bounds, real
  PNG/JPEG/WebP/GIF full decoding, optimized GIFs, and streamed-request limits.
- `tests/client-audit-regressions.test.mjs` covers validation, public category
  preservation, 500+ media assets, sign-out cache races, subscription cleanup,
  editor build inclusion, and fixture restore arguments.
- `scripts/verify-editor.mjs` covers unsaved private preview, save isolation,
  edits during delayed save, failure/retry, exact selection, upload/alt updates,
  typing focus and formatted stats, publication/restoration/unpublication,
  sign-out cleanup, and read-only Viewer controls.
- Existing route/security/UI suites were updated for the corrected contracts.
  The browser harness checks actual title/card opacity, fallback-font wrapping,
  touch/keyboard reading, and same-document hash navigation.

Evidence: `artifacts/browser-verification/` and `artifacts/editor-verification/`.
Representative responsive pages and affected editor screens were visually
inspected. Browser backends are loopback fixtures and external requests are
blocked; Google Fonts/GitHub API blocks are expected. A normal build was restored
after browser verification. Delivery excludes generated `dist` and dependencies.

## GitHub and migration compatibility

The delivery includes complete source and a binary-capable patch against the
baseline above. The patch was checked/applied to a clean baseline worktree and
its resulting files compared byte for byte with the reviewed tree.
`START_HERE.md` in the delivery gives update and verification commands.

For an existing database with migration 005 applied, apply **only new migration
006**. Fresh installations use all seven migrations in documented order. The
correction to 005 is necessary because its old version failed before reaching
006. Do not rerun already applied migrations. Historical seed/revisions remain
unchanged.

## Remaining limits

No known confirmed local/source defect from this audit is left unfixed.

1. No live or local Supabase stack was accessed. PGlite executes PostgreSQL
   functions/policies, but Auth/Storage service tables and JWT helpers are stubs.
   Real login/session expiry, Realtime, signed URL expiry, gateway/JWT/origin
   settings, and concurrent service requests still require staging checks.
2. The decoder executed locally and the Edge file type-checks. Deployed Edge
   cold-start, CPU/memory limits, WASM packaging, and network behavior were not
   exercised in the Supabase Edge runtime.
3. Browser tests use deterministic fixtures. They do not prove production
   GitHub API/fonts, host fallback/CSP, or all browser/assistive-technology
   combinations. Use the documented staging checklist with real accounts.
4. No environment file or credential values were read or included. Dependency
   trees, compiled legacy Vercel assets, build output, and Git internals were
   excluded from project-source review. The third-party WASM binary's size/hash,
   license/notice, and decode behavior were checked; its internals were not
   source-audited.
5. Generated seed SQL scaffolding was reviewed, and every content leaf compared
   with the reviewed defaults/case data. Differences were limited to known
   studio-field/category migrations. Its immutable checksum remains unchanged.
6. Non-JavaScript social crawler metadata remains the documented static-SPA
   hosting boundary. No unrequested SSR replacement was introduced.
