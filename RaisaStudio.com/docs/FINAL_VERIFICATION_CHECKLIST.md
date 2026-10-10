# Final CMS Verification Checklist

This checklist maps the 13 acceptance areas to the evidence that exists in the
repository and the work that still requires a disposable local or staging
Supabase project. The final local visual matrix has run; this remains a release
gate and does not claim that live Supabase integration has run.

## Status key

- **Automated** — covered by the local build or Node/VM, PostgreSQL, and image-decoder regression suite.
- **Partial** — useful automated evidence exists, but it cannot prove the full
  browser/Auth/database/Storage behavior.
- **Staging required** — must be exercised against a non-production Supabase
  project with real Auth, RLS, RPC, Realtime, and Storage behavior.
- **Unavailable** — the repository has no command for that check.

## Acceptance matrix

| # | Acceptance area | Automated evidence | Manual/staging verification | Current status |
|---:|---|---|---|---|
| 1 | Login, logout, expired sessions, and unauthorized access | `tests/security.test.mjs` rejects legacy/fallback auth; `tests/phase2-regressions.test.mjs` exercises access loss, preview clearing, and resolved sign-out errors. | Sign in with an active account, an Auth-only account, an inactive staff account, bad credentials, and an expired/revoked session. Verify logout removes private state in two tabs. | **Partial — staging required** |
| 2 | Permissions for every role | SQL contract tests inspect role checks, grants, RLS boundaries, last-Owner protection, and media role splits. | Use separate Owner, Publisher, Editor, Viewer, Auth-only, and anonymous sessions. Attempt every protected RPC directly as well as through the UI. | **Partial — staging required** |
| 3 | Create, read, update, delete, reorder, publish, unpublish, and restore | Content-contract and regression tests cover canonical mutations, ordering, publication RPCs, whole-site unpublish, and restore contracts; source checks cover confirmations and draft operations. | Perform the full lifecycle for a disposable service, project, case, and section. Verify revisions/activity and retry after deliberate conflicts. | **Partial — staging required** |
| 4 | Draft isolation from public visitors | Security/content-contract tests inspect protected draft access and the sanitized anonymous projection. | Save a unique marker as draft, request public content anonymously, inspect the Network response, and verify the marker is absent until publish. | **Partial — staging required** |
| 5 | Preview accuracy | VM/source checks cover authorized preview state and managed-media hydration. | Compare unsaved preview against the same page after publish at 375, 768, and 1440 px, including navigation, hidden records, crop, alt text, and route metadata. | **Partial — visual staging required** |
| 6 | Public updates after publish without source edits | Tests exercise publish RPC use, sanitized delivery, short public-cache expiry, signed-manifest refresh, unpublish cache clearing, and runtime configuration. | Publish a unique staging change without rebuilding, then verify it in a signed-out window, a second browser, and after a hard reload/realtime event. Confirm canonical signed URLs refresh before 300 seconds. Whole-site unpublish must clear the application cache and prevent new signing; record that an already issued bearer URL can remain valid only until its existing expiry. | **Partial — staging required** |
| 7 | Navigation, footer, social, contact, page, section, project, service, and SEO editing | Contract/security tests verify managed public content and canonical aliases; source checks cover the structured editors. | Change every listed content family, save/preview/publish, inspect visible output plus `<title>`, description, canonical, Open Graph values, links, and structured metadata where present. | **Partial — staging required** |
| 8 | Upload, crop, replace, validation, and protected deletion | Media-security and release-hardening suites cover browser preflight, the Edge verifier contract, trusted metadata binding, private signed delivery, promotion, immutable replacement, manifests, retained-revision guards, and reference-aware deletion. | In the deployed Edge runtime, test valid JPEG/PNG/WebP/GIF plus spoofed, corrupt, truncated, trailing-data/polyglot, oversized, over-dimensioned, excessive-frame, and excessive-total-pixel files. Exercise crop output, animated GIF retention, progress/failure, replacement, referenced/revision-delete denial, eligible cleanup, promotion, signed URL expiry, and an origin/JWT denial. | **Partial — staging required** |
| 9 | Search, filters, sorting, and pagination | Source/static checks cover the admin list controls and server-side activity bounds; SQL caps activity pages at 100. | Populate more than one page of records, combine queries/filters/sorts, clear filters, navigate first/last pages, and confirm stable empty results on desktop and keyboard-only use. | **Partial — staging/manual required** |
| 10 | Loading, empty, validation, database, and network-error states | VM/source tests cover session checking, validation, empty/activity fallbacks, conflicts, sign-out errors, and protected failure paths. | Throttle/offline the browser, return denied/timeout/RPC/Storage failures in staging, and verify actionable messages, retained drafts, retry behavior, focus, and no false success. | **Partial — fault-injection staging required** |
| 11 | Responsive behavior near 375 px, 768 px, and 1440 px | Public-integration checks inspect responsive CSS, focus visibility, and reduced-motion rules. The final `npm run verify:browser` run passed 22 scenarios/22 screenshots with zero failures, warnings, or console issues at 375×812, 768×1024, and 1440×900. | Repeat the critical paths with real staging Auth/content/media; also check preview, uploads, 200% zoom, and any browser/OS combinations required by the release. The loopback fixture is not evidence of real Auth/RLS/Storage. | **Partial — local browser PASS; staging required** |
| 12 | Existing routes and functionality for regressions | Regression and public-integration tests cover clean routes, legacy hashes, unpublished direct-case rejection, local bundles, metadata, and sitemap routes; the browser harness covers representative clean and legacy routes. | Navigate every public route and legacy deep link; test browser back/forward, hard refresh, external links, contact actions, animation/reduced motion, static-asset MIME behavior, and admin open/close. On the production host, prove that extensionless application routes rewrite to `index.html` with a successful SPA response and that real static assets are still served with their correct content types. | **Partial — host and end-to-end staging required** |
| 13 | Lint, build, type-check, and available automated tests | Current local results and exact test/scenario counts are recorded in `FINAL_VERIFICATION_REPORT.md`, including PostgreSQL execution, image full-decode regressions, and Deno Edge type-check. | Repeat on Node.js 22 or newer in release CI from a clean `npm ci`. Investigate any environmental difference. | **Automated local gates PASS; lint unavailable; Edge type-check configured** |

## Staging prerequisites

- Use a disposable or backed-up non-production Supabase project.
- Configure `PORTFOLIO_ALLOWED_ORIGINS` with comma-separated exact staging
  origins and deploy `verify-portfolio-media` with JWT verification enabled
  before activating migration `202608040005`. Keep the service-role key inside
  the Edge runtime; never place it in browser configuration or evidence.
- Deploy the verifier with Supabase CLI 2.7 or newer and its local Docker
  bundler so `static_files` includes the vendored WASM. Do not use `--use-api`.
- Inventory existing canonical `portfolio-media-public` rows before migration
  `202608040005`. Reverify each exact preserved staging source or plan a
  replacement/republication. Do not automatically trust-backfill old rows;
  unverified canonical media is expected to fail closed after hardening.
- Apply migrations in the exact order and controlled rollout sequence in
  `README_DEPLOY.md`, then deploy the matching frontend.
- Create distinct Auth accounts for Owner, Publisher, Editor, Viewer, an
  inactive staff user, and an Auth-only user.
- Use synthetic content and non-sensitive test images.
- Keep one signed-out/private browser and at least two simultaneous authorized
  sessions for isolation and conflict checks.
- Confirm no secret or `service_role` key is present in browser configuration,
  source maps, logs, screenshots, or exported evidence.

## Release execution record

Copy this block into the release ticket and replace every placeholder:

```text
Commit/build:
Environment:
Supabase project (non-secret identifier):
Tester/date:
npm run seed:check:
npm run build:
npm run check:
npm run verify:browser (scenario/screenshot/failure/warning counts):
npm run verify:editor:
npm run typecheck:edge:
npm audit --audit-level=high:
Edge verifier version/JWT setting/allowed origins:
Migration 005 canonical inventory and re-verification:
Owner:
Publisher:
Editor:
Viewer:
Auth-only/inactive/anonymous:
CRUD and revision conflict:
Draft isolation:
Preview/public comparison:
Publish/unpublish/restore:
Media lifecycle:
Signed delivery refresh/expiry/unpublish:
Concurrent content/delete lock interleaving:
Search/filter/sort/pagination:
Fault injection:
375 px:
768 px:
1440 px:
Route regression:
Production-host SPA fallback and static-asset delivery:
Accessibility/keyboard:
Open defects and severity:
Release decision:
```

Do not mark an item complete solely because its control is visible. Record the
observed result, affected revision or asset, role used, browser/viewport, and
any defect reference. Production deployment and destructive production
database/Storage testing require separate approval.
