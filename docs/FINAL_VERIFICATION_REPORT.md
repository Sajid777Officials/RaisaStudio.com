# Final CMS verification report

**Verification date:** 2026-08-31  
**Repository:** RAISA Studio portfolio CMS  
**Release scope:** source, migrations, Edge Function source, generated static
build, and local browser verification

## Release decision

**Local/source acceptance: PASS.** The final tree builds, the guarded seed is
intact, all available automated tests pass, the vendored verifier WASM performs
a real pixel decode, the responsive browser matrix passes, and the normal
generated build contains neither browser-fixture endpoints nor privileged-key
markers.

**Production activation: NOT APPROVED YET.** The remaining gates require the
real staging Supabase runtime and target hosting platform; they cannot be
replaced by source inspection or in-memory browser fixtures.

Production activation is a separate gate. No live Supabase database, Auth
tenant, Storage bucket, environment file, hosting project, or public deployment
was changed during this work. Real role/RLS/Storage and concurrency evidence
must be recorded against a disposable or backed-up staging project before a
production release is approved.

## Implemented controls

- Supabase password authentication plus active database role verification.
- Owner, Publisher, Editor, and Viewer permissions enforced by protected RPCs,
  grants, RLS, and Storage policies rather than UI visibility alone.
- Isolated draft, authorized preview, publish, whole-site unpublish, revision,
  restoration, conflict, and activity workflows.
- Structured editors for site, route SEO, studios, services, category projects,
  selected work, case studies, navigation, footer, contact, social links,
  integrations, staff, media, and supporting content.
- Managed media tokens, private staging, trusted byte verification, immutable
  promotion, private signed delivery, replacement, usage inspection, and
  reference/revision-aware deletion.
- Clean routes with legacy-hash compatibility, local pinned runtime bundles,
  restrictive browser policy, responsive layouts, keyboard/focus behavior,
  and reduced-motion handling.

## Automated verification

Final results from Windows, Node.js 24.13.0, and npm 11.6.2:

| Command | Result |
|---|---|
| `npm run seed:check` | PASS — immutable migration 002 checksum `14a82361ccff180240f7444a378721c46eb5c8c1a68f18f8d7c45aeaa6fb6b57`; current defaults normalize to the canonical inventory |
| `npm run build` | PASS — 12 JSX files; normal admin/backend-enabled artifact restored after browser verification |
| Focused content/backend/UI suites | PASS — 25 tests, including alias cleanup, exact gallery-parent repair, HTTPS validation, lock ordering, and a real ImageMagick WASM decode |
| `npm run check` | PASS — final build plus all 72 tests |
| `npm run verify:browser` | PASS — 20 scenarios, 20 screenshots, 0 failures, 0 warnings |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| `npm ls --all --omit=optional` | PASS — resolved dependency tree; ImageMagick WASM pinned to `0.0.41` |

There is no separate lint or type-check script in `package.json`; those checks
must not be reported as passed.

## Browser evidence

The final matrix passed 20 scenarios with 20 screenshots, zero failures, zero
warnings, and zero console issues at 375×812, 768×1024, and 1440×900. It covered
12 public route/viewport combinations, a clean nested case route, a legacy hash
route, three unauthenticated Admin layouts, and three in-memory Owner layouts.
Representative home, case-study, mobile-admin, and desktop-admin screenshots
were also visually reviewed after the run.

Evidence directory: `artifacts/browser-verification/`.

The browser harness never submits credentials, blocks non-loopback requests,
uses only in-memory auth/content fixtures, removes its temporary Chrome profile,
and closes its loopback servers. It intentionally leaves a local-only build, so
`npm run build` was run afterward; the restored artifact was checked for
loopback/fixture markers and privileged-key strings.

The two blocked requests were the optional Google Fonts stylesheet and GitHub
API integration. Their denial is expected in this hermetic run and did not
produce a warning, exception, or console error.

## Staging-only acceptance gates

The following cannot be proven by static/VM tests or a loopback browser stub:

1. Real login/logout, token expiry/revocation, inactive/Auth-only users, and
   cross-tab private-state cleanup.
2. Direct RPC/RLS/Storage denial and allowed behavior for anonymous, Viewer,
   Editor, Publisher, and Owner sessions.
3. Draft isolation, publish propagation, whole-site unpublish, signed URL
   expiry, Realtime refresh, and offline/fault recovery against real services.
4. Valid, spoofed, corrupt, truncated, oversized, dimension-bomb, animation,
   and polyglot media verification in the deployed Edge runtime.
5. Interrupted upload/promotion/deletion recovery and the concurrent
   save/delete lock interleaving.
6. Full CRUD, ordering, duplication, filtering, pagination, validation,
   preview, publication, restoration, and staff lifecycle with disposable
   staging records.
7. Host-specific clean-route fallback, production origin/CSP headers, canonical
   URLs, indexing policy, and social-crawler metadata behavior.

Use `docs/FINAL_VERIFICATION_CHECKLIST.md` to record actors, revisions, asset
IDs, browser/viewports, observed responses, and defect references. Do not test
destructive recovery against production.

## Known platform boundary

Route title, description, keywords, canonical, Open Graph, Twitter, and JSON-LD
values update in the running SPA from the published CMS document. A purely
static host still returns its generic build-time HTML before JavaScript runs;
social crawlers that never execute JavaScript require a host-specific
SSR/edge-rendering layer. That hosting decision and crawler evidence remain a
production release gate rather than an unverified local claim.

## Production activation order

1. Back up the target database and Storage objects separately.
2. Create the required Auth test accounts in staging.
3. Deploy/configure the trusted media-verification function without exposing
   its service-role key to the browser.
4. Apply migrations in the documented order during a controlled window.
5. Run the complete staging matrix and reconcile every failure.
6. Configure the exact public site origin, Supabase URL, publishable key,
   indexing choice, and SPA fallback on the hosting platform.
7. Build and inspect the final artifact, then approve production deployment as
   a separate, explicit action.
