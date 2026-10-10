# Audit file inventory

Baseline: `b74c6071a19e8755ad92a3f65cc1b7d51b4d479f`.

This inventory covers 67 project-owned text/source/configuration/test/documentation files. Source and tests were reviewed line by line; generated data and the dependency lockfile also received the checks described below. Status is relative to the GitHub baseline and includes the contextual-editor work supplied in the ZIP.

| File | Review | Change |
|---|---|---|
| `.env.example` | Configuration/schema review | Unchanged |
| `.gitignore` | Configuration/schema review | Unchanged |
| `Portfolio.html` | UI/style/asset review | Modified |
| `README_DEPLOY.md` | Documentation consistency | Modified |
| `admin-panel.jsx` | Source review | Modified |
| `admin.css` | UI/style/asset review | Unchanged |
| `admin.html` | UI/style/asset review | Unchanged |
| `admin.jsx` | Source review | Unchanged |
| `app.jsx` | Source review | Modified |
| `case-sheet.jsx` | Source review | Modified |
| `content.jsx` | Source review | Modified |
| `cursor.jsx` | Source review | Modified |
| `data.jsx` | Source review | Unchanged |
| `docs/ADMIN_GUIDE.md` | Documentation consistency | Modified |
| `docs/AUDIT_FILE_INVENTORY.md` | Documentation consistency | New |
| `docs/CMS_CONTENT_CONTRACT.md` | Documentation consistency | Modified |
| `docs/EDITABLE_CONTENT_INVENTORY.md` | Documentation consistency | Unchanged |
| `docs/FINAL_VERIFICATION_CHECKLIST.md` | Documentation consistency | Modified |
| `docs/FINAL_VERIFICATION_REPORT.md` | Documentation consistency | Modified |
| `docs/MEDIA_OPERATIONS.md` | Documentation consistency | Modified |
| `favicon.svg` | UI/style/asset review | Unchanged |
| `framer-motion-entry.js` | Source review | Unchanged |
| `graphic-page.jsx` | Source review | Modified |
| `hero.jsx` | Source review | Modified |
| `icons.jsx` | Source review | Unchanged |
| `netlify.toml` | Configuration/schema review | Modified |
| `package-lock.json` | Lockfile consistency, clean install, dependency audit | Modified |
| `package.json` | Configuration/schema review | Modified |
| `scripts/build.mjs` | Build/verification script review | Modified |
| `scripts/generate-portfolio-seed.mjs` | Build/verification script review | Unchanged |
| `scripts/preview.mjs` | Build/verification script review | Modified |
| `scripts/verify-browser.mjs` | Build/verification script review | Modified |
| `scripts/verify-editor.mjs` | Build/verification script review | New |
| `scripts/visual-editor-fixture.mjs` | Build/verification script review | New |
| `shared.jsx` | Source review | Modified |
| `styles.css` | UI/style/asset review | Modified |
| `supabase-client.jsx` | Source review | Unchanged |
| `supabase/config.toml` | Configuration/schema review | Unchanged |
| `supabase/functions/verify-portfolio-media/index.ts` | Source review | Modified |
| `supabase/migrations/202607260001_secure_portfolio_cms.sql` | SQL review and PostgreSQL execution | Unchanged |
| `supabase/migrations/202607290001_portfolio_schema_v1.sql` | SQL review and PostgreSQL execution | Unchanged |
| `supabase/migrations/202607290002_seed_portfolio_content_v1.sql` | SQL scaffolding plus complete leaf comparison and immutable checksum | Unchanged |
| `supabase/migrations/202607290003_secure_media_lifecycle.sql` | SQL review and PostgreSQL execution | Unchanged |
| `supabase/migrations/202607290004_admin_operations.sql` | SQL review and PostgreSQL execution | Unchanged |
| `supabase/migrations/202608040005_private_verified_media_and_strict_content.sql` | SQL review and PostgreSQL execution | Modified |
| `supabase/migrations/202610090006_content_contract_compatibility.sql` | SQL review and PostgreSQL execution | New |
| `supabase/portfolio-content-v1.schema.json` | Configuration/schema review | Modified |
| `tests/client-audit-regressions.test.mjs` | Regression/test review | New |
| `tests/database-regressions.test.mjs` | Regression/test review | New |
| `tests/helpers/database.mjs` | Regression/test review | New |
| `tests/phase2-regressions.test.mjs` | Regression/test review | Modified |
| `tests/phase3-content-contract.test.mjs` | Regression/test review | Unchanged |
| `tests/phase4-media-security.test.mjs` | Regression/test review | Unchanged |
| `tests/phase5-public-integration.test.mjs` | Regression/test review | Modified |
| `tests/phase6-admin-operations.test.mjs` | Regression/test review | Modified |
| `tests/phase7-backend-hardening.test.mjs` | Regression/test review | Unchanged |
| `tests/phase7-release-hardening.test.mjs` | Regression/test review | Unchanged |
| `tests/phase7-ui-acceptance.test.mjs` | Regression/test review | Modified |
| `tests/security.test.mjs` | Regression/test review | Modified |
| `tests/verifier-regressions.test.mjs` | Regression/test review | New |
| `tweaks-panel.jsx` | Source review | Modified |
| `vendor-entry.js` | Source review | Unchanged |
| `vercel.json` | Configuration/schema review | Unchanged |
| `visual-editor.css` | UI/style/asset review | New |
| `visual-editor.jsx` | Source review | New |
| `webdev-page.jsx` | Source review | Modified |
| `workspace-utils.jsx` | Source review | New |

## Evidence and exclusions

- `artifacts/browser-verification/`: regenerated report and 22 screenshots; representative screens visually inspected.
- `artifacts/editor-verification/`: new interaction report and screenshots; private preview, contextual editing, and read-only behavior checked.
- Vendored ImageMagick `magick.wasm`: pinned third-party binary; size/hash and actual full-decode behavior verified. License and NOTICE reviewed; binary internals not source-audited.
- No `.env` or credential values were read. `.env.example` contains placeholders and was reviewed.
- `node_modules`, `dist`, `.git`, and duplicate compiled `legacy-vercel-assets` are excluded from source review/delivery. Their generated or third-party contents are not represented as line-audited project source.
- The supplied local editor settings were inspected as ancillary configuration; they are ignored by the repository and excluded from the GitHub patch.
- There is no GitHub Actions workflow, configured linter, or frontend TypeScript project in the supplied tree. The Edge verifier has a checked Deno type-check command.
