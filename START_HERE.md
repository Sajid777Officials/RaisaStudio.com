# RaisaStudio audited GitHub update

The source review and confirmed fixes are complete. No remote repository,
Supabase project, credentials, or deployment was modified.

## Contents

- `RaisaStudio.com/`: complete reviewed source, migrations, tests, documentation,
  and browser evidence. Includes the required pinned media-verifier WASM.
- `RaisaStudio_GitHub_Update.patch`: complete binary-capable Git patch against
  `b74c6071a19e8755ad92a3f65cc1b7d51b4d479f` in
  https://github.com/Sajid777Officials/RaisaStudio.com.
- `verification-summary.json`: final local verification and patch comparison.
- `SHA256SUMS`: hashes of the delivered files other than this checksum list.

Read `RaisaStudio.com/docs/FINAL_VERIFICATION_REPORT.md` for the confirmed
issues, fixes, verification, and remaining limits. The complete source-file
review/change inventory is `RaisaStudio.com/docs/AUDIT_FILE_INVENTORY.md`.

## Apply the patch

Use a clean checkout of the baseline commit. These commands assume this folder
contains the patch and will create a separate checkout named `github-update`:

```bash
git clone https://github.com/Sajid777Officials/RaisaStudio.com.git github-update
cd github-update
git switch -c fix/codebase-audit b74c6071a19e8755ad92a3f65cc1b7d51b4d479f
git apply --check ../RaisaStudio_GitHub_Update.patch
git apply ../RaisaStudio_GitHub_Update.patch
npm ci
npm run seed:check
npm run check
```

Node.js 22 or newer is required. If `git apply --check` reports a mismatch,
check the branch and local changes before applying anything. The full source
folder is also included for a normal file-based GitHub update; copy its contents
into the repository root, not as a nested `RaisaStudio.com` subdirectory.

With Chrome/Chromium available, run:

```bash
CHROME_PATH=/path/to/chrome npm run verify:browser
CHROME_PATH=/path/to/chrome npm run verify:editor
```

Use `CHROME_NO_SANDBOX=true` only where a controlled container requires it.
`playwright-core` uses the supplied browser and does not download one. With Deno
installed, `npm run typecheck:edge` checks the Edge verifier. There is no
configured linter or frontend TypeScript project.

Review and commit the changes, then push your update branch:

```bash
git diff --check
git add .
git commit -m "Fix CMS editor, content contracts, media verification, and UI regressions"
git push -u origin fix/codebase-audit
```

These are instructions for the repository owner; this audit did not perform the
push or open a pull request.

## Database and deployment

If migrations through 005 are already applied, the database update is only:

`supabase/migrations/202610090006_content_contract_compatibility.sql`

Fresh installations apply all seven migrations in `README_DEPLOY.md` order.
Migration 005 also has a correction because its previous validation prevented a
fresh install from reaching 006. Do not rerun applied migrations. Seed migration
002 and historical revisions are preserved.

The ZIP excludes `.env`, Git internals, installed dependencies, generated build
output, and stale compiled Vercel assets. Keep existing environment settings,
and configure the browser-safe values shown in `.env.example` as needed.
`PORTFOLIO_ENABLE_ADMIN=true` plus the Supabase URL/publishable key is needed for
the CMS; an unconfigured build intentionally uses read-only defaults.

Browser verification uses local simulated services and can leave a verification
build in `dist`. Before deployment, run `npm run build` using the intended
production environment. Do not upload a browser-verification build.

The local PostgreSQL tests use PGlite and Auth/Storage stubs. Real Supabase
Auth/Realtime/Storage/Edge behavior, concurrent service requests, and hosting
fallback/headers still need the staging checks documented in
`docs/FINAL_VERIFICATION_CHECKLIST.md`. This package is GitHub-update-ready;
it is not evidence of a live production deployment.
