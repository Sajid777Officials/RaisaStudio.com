import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("admin validates the raw document before normalization and preserves relationship invariants", async () => {
  const admin = await read("admin-panel.jsx");

  assert.match(admin, /const nextFieldErrors = adminCollectFieldErrors\(draft\);[\s\S]*?const validationError = adminValidateContent\(draft\);[\s\S]*?const normalized = adminNormalize\(draft\);/);
  assert.match(admin, /const validationError = adminValidateContent\(parsed\);[\s\S]*?const normalized = adminNormalize\(parsed\);/);
  assert.match(admin, /linkedCaseProjects\.has\(projectId\)/);
  assert.match(admin, /disabled: linkedByOtherCase\.has\(option\.value\)/);
  assert.match(admin, /duplicateCase[\s\S]*?project_id: ""/);
  assert.match(admin, /previousCategoryId[\s\S]*?project\.category_id === previousCategoryId[\s\S]*?work\.category_id === previousCategoryId/);
  assert.match(admin, /caseData\.project_id === previousId \|\| caseData\.project_id === previousSlug/);
  assert.match(admin, /This service still has \$\{linkedCount\} linked project/);
  assert.match(admin, /This project is linked to \$\{linkedCases\.length\} case stud/);
});

test("public case routes resolve through canonical work relationships and respect structured unpublishing", async () => {
  const [app, cases] = await Promise.all([read("app.jsx"), read("case-sheet.jsx")]);

  assert.match(app, /const routeId = work\.slug \|\| work\.id/);
  assert.match(app, /caseData\?\.project_id === \(activeWork\?\.id \|\| caseId\)/);
  assert.match(cases, /item\?\.project_id === \(routeWork\?\.id \|\| caseId\)/);
  assert.match(cases, /const structuredCasePublished = allowUnpublished \|\| structuredCaseData\?\.is_published !== false/);
  assert.match(cases, /baseData \|\| \(allowUnpublished \? buildCaseFromWork\(linkedWork\) : null\)/);
  assert.doesNotMatch(cases, /baseData \|\| buildCaseFromWork\(linkedWork\)/);
});

test("managed studio controls reach every visible public heading, CTA, and optional section", async () => {
  const [admin, content, graphic, webdev] = await Promise.all([
    read("admin-panel.jsx"),
    read("content.jsx"),
    read("graphic-page.jsx"),
    read("webdev-page.jsx"),
  ]);

  for (const field of [
    "servicesTitle",
    "servicesSubtitle",
    "portfolioTitle",
    "portfolioMeta",
    "workCtaLabel",
    "projectCtaLabel",
    "loadMoreLabel",
    "backLabel",
    "crumbLabel",
    "allServicesLabel",
    "categoryCrumbLabel",
    "showServices",
    "showPortfolio",
    "showAbout",
    "stackLabel",
    "showTechStack",
  ]) {
    assert.ok(admin.includes(`"${field}"`), `Admin editor exposes ${field}`);
  }
  for (const publicSource of [graphic, webdev]) {
    assert.match(publicSource, /studio\.servicesTitle/);
    assert.match(publicSource, /studio\.showServices === false/);
    assert.match(publicSource, /studio\.showPortfolio === false/);
    assert.match(publicSource, /studio\.showAbout === false/);
    assert.match(publicSource, /studio\.workCtaLabel/);
    assert.match(publicSource, /studio\.projectCtaLabel/);
    assert.match(publicSource, /studio\.loadMoreLabel/);
    assert.match(publicSource, /studio\.allServicesLabel/);
    assert.match(publicSource, /studio\.categoryCrumbLabel/);
  }
  assert.match(webdev, /studio\.stackLabel/);
  assert.match(webdev, /studio\.showTechStack === false/);
  assert.match(admin, /label="Service ID"[\s\S]*?label="Slug"[\s\S]*?label="Custom icon URL or media reference"/);
  assert.equal((content.match(/projectCtaLabel: "View details"/g) || []).length, 2);
  assert.equal((content.match(/loadMoreLabel: "Load more"/g) || []).length, 2);
});

test("validation errors are field-addressable across links, slugs, and media", async () => {
  const [admin, shared] = await Promise.all([read("admin-panel.jsx"), read("shared.jsx")]);

  assert.match(admin, /function adminIsSafeHttpsUrl[\s\S]*?parsed\.protocol === "https:"/);
  assert.match(admin, /function adminIsSafeNavigationUrl[\s\S]*?safe relative path, fragment, or HTTPS URL/);
  assert.doesNotMatch(admin, /\["http:", "https:"\]/);
  assert.match(admin, /Use a valid HTTPS URL for an external link/);
  assert.match(shared, /function sharedSafeExternalUrl[\s\S]*?parsed\.protocol === "https:"/);
  assert.doesNotMatch(shared, /\["http:", "https:"\]/);

  for (const contract of [
    /site\.navigation\.\$\{index\}\.url/,
    /site\.socialLinks\.\$\{index\}\.url/,
    /Project slug must be unique/,
    /Work slug must be unique/,
    /Service slug must be unique/,
    /gallery_images\.\$\{imageIndex\}\.alt_text/,
    /cover_image_url`, "Use a secure media reference/,
    /cases\.\$\{caseId\}\.cover_alt/,
  ]) {
    assert.match(admin, contract);
  }
});

test("history is paginated and viewer controls are genuinely read-only", async () => {
  const [admin, styles] = await Promise.all([read("admin-panel.jsx"), read("styles.css")]);

  assert.match(admin, /loadRevisions\(\{ offset: \(revisionPage - 1\) \* pageSize, limit: pageSize \}\)/);
  assert.match(admin, /loadActivity\(\{ offset: \(activityPage - 1\) \* pageSize, limit: pageSize \}\)/);
  assert.match(admin, /Actor: \{entry\.actor_email \|\| entry\.actor_id \|\| "System"\}/);
  assert.match(admin, /Target: \{\[entry\.resource_type, entry\.resource_id\]/);
  assert.match(admin, /<time dateTime=\{entry\.created_at\}>/);
  assert.match(admin, /<fieldset className="admin-editor-fieldset" disabled=\{!canEdit\}>/);
  assert.match(admin, /disabled=\{!canEdit\}>Save now/);
  assert.match(admin, /read-only and cannot import content/);
  assert.match(styles, /\.admin-editor-fieldset\[disabled\]/);
});

test("keyboard and authorization semantics cover cards, tabs, login, and closed-panel preview", async () => {
  const [admin, app, graphic, webdev, styles] = await Promise.all([
    read("admin-panel.jsx"),
    read("app.jsx"),
    read("graphic-page.jsx"),
    read("webdev-page.jsx"),
    read("styles.css"),
  ]);

  for (const publicSource of [graphic, webdev]) {
    assert.match(publicSource, /role=\{canOpenCase \? "button" : undefined\}[\s\S]*?tabIndex=\{canOpenCase \? 0 : undefined\}[\s\S]*?canOpenCase && \(event\.key === "Enter" \|\| event\.key === " "\)/);
    assert.match(publicSource, /HasStructuredCase\(work, content\?\.cases\)/);
    assert.match(publicSource, /role="tab"[\s\S]*?aria-selected=\{isActive\}/);
  }
  assert.match(admin, /role="tab"[\s\S]*?aria-selected=\{activeTab === key\}/);
  assert.match(admin, /id="admin-login-error" role="alert" aria-live="assertive"/);
  assert.match(app, /if \(!previewMode \|\| adminOpen\) return undefined;[\s\S]*?PortfolioContent\.getAdminProfile\(\)[\s\S]*?restorePublishedContent\(\)/);
  assert.match(styles, /\.admin-sidebar :where\(button, \[tabindex\]\):focus-visible/);
  assert.match(styles, /\.admin-main :where\(button, input, select, textarea, \[tabindex\]\):focus-visible/);
});

test("browser acceptance fixtures model an enabled published portfolio", async () => {
  const verifier = await read("scripts/verify-browser.mjs");

  assert.match(verifier, /clonePublishedDefaults[\s\S]*?published\.publicEnabled = true/);
  assert.match(verifier, /get_published_portfolio"\) return \{ data: clonePublishedDefaults\(\), error: null \}/);
  assert.match(verifier, /get_published_portfolio"\) return \{ data: cloneDefaults\(\), error: null \}/);
  assert.doesNotMatch(verifier, /get_published_portfolio"\) return \{ data: \{\}, error: null \}/);
});
