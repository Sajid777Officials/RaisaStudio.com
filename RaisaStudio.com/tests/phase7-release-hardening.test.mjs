import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("local development serves only built output on loopback", async () => {
  const [packageSource, preview] = await Promise.all([
    read("package.json"),
    read("scripts/preview.mjs"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(packageJson.scripts.dev, "npm run build && node scripts/preview.mjs dist");
  assert.match(preview, /const host = "127\.0\.0\.1"/);
  assert.match(preview, /server\.listen\(port, host/);
  assert.match(preview, /segment\.startsWith\("\."\)/);
  assert.match(preview, /realpathSync\(file\)/);
  assert.match(preview, /X-Content-Type-Options/);
});

test("build validates the public site origin and separates CSP directives", async () => {
  const [build, vercelSource] = await Promise.all([
    read("scripts/build.mjs"),
    read("vercel.json"),
  ]);
  const vercel = JSON.parse(vercelSource);

  assert.match(build, /PORTFOLIO_SITE_URL must use HTTPS/);
  assert.match(build, /must be an origin without a path, query, or fragment/);
  assert.match(build, /must not contain credentials/);
  assert.match(build, /form-action 'self' mailto:;/);
  assert.match(build, /\$\{runtimeCsp\} frame-ancestors 'none';/);
  assert.doesNotMatch(vercelSource, /https:\/\/\*\.supabase\.co/);
  const csp = vercel.headers
    .flatMap((rule) => rule.headers || [])
    .find((header) => header.key === "Content-Security-Policy");
  assert.equal(csp?.value, "frame-ancestors 'none';");
});

test("build rejects an unsafe or ambiguous public site URL", () => {
  for (const siteUrl of ["javascript:alert(1)", "https://user:pass@example.com", "https://example.com/portfolio?draft=1"]) {
    const result = spawnSync(process.execPath, ["scripts/build.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PORTFOLIO_SITE_URL: siteUrl,
      },
    });

    assert.notEqual(result.status, 0, `${siteUrl} should be rejected`);
    assert.match(`${result.stdout}\n${result.stderr}`, /PORTFOLIO_SITE_URL/);
  }
});

test("generated CSP gives form-action and frame-ancestors independent directives", async () => {
  const headers = await read("dist/_headers");
  const cspLine = headers.split(/\r?\n/).find((line) => line.includes("Content-Security-Policy:"));

  assert.ok(cspLine, "generated CSP header is present");
  assert.match(cspLine, /form-action 'self' mailto:;/);
  assert.match(cspLine, /;\s*frame-ancestors 'none';/);
});

test("generated entry assets remain valid on nested clean routes", async () => {
  const [build, manifest] = await Promise.all([
    read("scripts/build.mjs"),
    read("dist/site.webmanifest"),
  ]);

  for (const reference of [
    'href="/favicon.svg"',
    'href="/site.webmanifest"',
    'href="/assets/styles.css"',
    'src="/assets/config.js"',
    'src="/assets/vendor.js"',
    'src="/assets/framer-motion.js"',
    'src="/assets/app.js"',
  ]) {
    assert.ok(build.includes(reference), `expected root-relative reference ${reference}`);
  }
  assert.equal(JSON.parse(manifest).start_url, "/");
});

test("public media cache refreshes before signed expiry and on tab visibility", async () => {
  const content = await read("content.jsx");

  assert.match(content, /PORTFOLIO_MEDIA_MANIFEST_KEY\s*=\s*["']raisa-portfolio-signed-media-v1["']/);
  assert.match(content, /PORTFOLIO_PUBLIC_CACHE_MAX_AGE_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/);
  assert.match(content, /PORTFOLIO_MEDIA_SIGNED_TTL_SECONDS\s*=\s*5\s*\*\s*60/);
  assert.match(content, /createSignedUrls\s*\([\s\S]{0,160}PORTFOLIO_MEDIA_SIGNED_TTL_SECONDS/);
  assert.match(content, /refreshAt:[\s\S]{0,160}PORTFOLIO_MEDIA_REFRESH_SKEW_MS/);
  assert.match(content, /document\.addEventListener\(\s*["']visibilitychange["']/);
  assert.match(content, /document\.visibilityState\s*===\s*["']visible["'][\s\S]{0,80}refresh\(\)/);
  assert.match(content, /mediaEnvelope\.expiresAt\s*<=\s*Date\.now\(\)/);
  assert.match(content, /Math\.min\(expiresAt,\s*now\s*\+\s*15\s*\*\s*1000\)/);
  assert.match(content, /expiresAt\s*<=\s*now[\s\S]{0,80}now\s*\+\s*60\s*\*\s*1000/);
  assert.match(content, /content:\s*projected/);
  assert.doesNotMatch(content, /JSON\.stringify\(hydrated\)/);
});
