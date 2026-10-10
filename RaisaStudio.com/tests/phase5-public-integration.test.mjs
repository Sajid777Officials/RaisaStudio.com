import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("public navigation supports clean paths while preserving legacy hashes", async () => {
  const app = await read("app.jsx");

  assert.match(app, /const legacyHash = window\.location\.hash/);
  assert.match(app, /const cleanPath = window\.location\.pathname/);
  assert.match(app, /const routeValue = legacyHash \|\| cleanPath/);
  assert.match(app, /history\.pushState\(null, "", nextUrl\)/);
  assert.match(app, /`\/\$\{normalizedPath\}\$\{window\.location\.search\}`/);
});

test("managed content reaches public microcopy, contact, and route metadata", async () => {
  const [app, hero, shared] = await Promise.all([
    read("app.jsx"),
    read("hero.jsx"),
    read("shared.jsx"),
  ]);

  assert.match(app, /<LoadingScreen onDone=\{handleReady\} site=\{content\.site\}/);
  assert.match(app, /globalSeo\.pages\?\.\[routeKey\]/);
  assert.match(app, /activeCase\?\.seo \|\| activeWork\?\.seo/);
  assert.match(app, /adminOpen \|\|\s*previewMode/);
  assert.match(app, /caseTitle \? "article" : "website"/);

  assert.match(hero, /studio\.heroHoverLabel \|\| "Click to enter"/);
  assert.match(hero, /<HeroMarquee services=\{\[\.\.\.graphicServices, \.\.\.webdevServices\]\}/);
  assert.doesNotMatch(hero, /const ALL_SERVICES/);

  assert.match(shared, /<header className=\{"nav"/);
  assert.match(shared, /<nav className="nav-links"[^>]*aria-label="Primary navigation"/);
  assert.match(shared, /aria-current=\{isActive\(item\.target\) \? "page"/);
  assert.match(shared, /portfolio-footer-contact/);
  assert.match(shared, /href=\{`mailto:\$\{email\}`\}/);
  assert.match(shared, /href=\{phoneHref\}/);
});

test("tablet/mobile layout, focus visibility, and reduced motion are explicit", async () => {
  const styles = await read("styles.css");

  assert.match(styles, /@media \(max-width: 900px\)/);
  assert.match(styles, /\.stage\s*\{[\s\S]*?transform: none !important;/);
  assert.match(styles, /\.about-section\s*\{[\s\S]*?scroll-margin-top: 108px;/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /:where\(a, button, input, select, textarea, \[tabindex\]\):focus-visible/);
});

test("public overlays trap keyboard focus and restore the invoking control", async () => {
  const [graphic, webdev, cases, app, hero] = await Promise.all([
    read("graphic-page.jsx"),
    read("webdev-page.jsx"),
    read("case-sheet.jsx"),
    read("app.jsx"),
    read("hero.jsx"),
  ]);

  for (const modal of [graphic, webdev]) {
    assert.match(modal, /const dialogRef = React\.useRef\(null\)/);
    assert.match(modal, /const returnFocus = document\.activeElement/);
    assert.match(modal, /event\.key !== "Tab"/);
    assert.match(modal, /event\.stopImmediatePropagation\(\)/);
    assert.match(modal, /returnFocus instanceof HTMLElement/);
    assert.match(modal, /role="dialog" aria-modal="true"/);
    assert.match(modal, /tabIndex="-1"/);
  }

  assert.match(cases, /returnFocusRef\.current = document\.activeElement/);
  assert.match(cases, /role="dialog"/);
  assert.match(cases, /aria-modal="true"/);
  assert.match(app, /className="global-image-viewer"[\s\S]+role="dialog"[\s\S]+aria-modal="true"/);
  assert.match(app, /dialogRef\.current\?\.querySelectorAll/);
  assert.equal((app.match(/role=\{show \? "main" : undefined\}/g) || []).length, 2);
  assert.match(hero, /role=\{isExpanded \? undefined : "main"\}/);
  assert.match(hero, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(hero, /tabIndex=\{isExpanded \? -1 : 0\}/);
});

test("route metadata is DOM-safe and private views are never indexed", async () => {
  const app = await read("app.jsx");

  assert.match(app, /adminOpen \|\|\s*previewMode/);
  assert.match(app, /forceNoIndex \? "noindex, nofollow" : "index, follow"/);
  assert.match(app, /structuredData\.textContent = JSON\.stringify\(structuredPayload\)\.replace\(\/<\/g, "\\\\u003c"\)/);
  assert.doesNotMatch(app, /dangerouslySetInnerHTML/);
});

test("production runtime dependencies are bundled locally and sitemap covers public views", async () => {
  const [build, html] = await Promise.all([
    read("scripts/build.mjs"),
    read("dist/index.html"),
  ]);

  assert.match(build, /entryPoints: \[path\.join\(root, "vendor-entry\.js"\)\]/);
  assert.match(build, /outfile: path\.join\(assets, "vendor\.js"\)/);
  assert.doesNotMatch(build, /https:\/\/unpkg\.com/);
  assert.match(build, /\{ path: "\/graphic", priority: "0\.9" \}/);
  assert.match(build, /\{ path: "\/webdev", priority: "0\.9" \}/);
  assert.match(build, /\{ path: "\/about", priority: "0\.7" \}/);
  assert.match(html, /<script src="\/assets\/vendor\.js"><\/script>/);
  assert.doesNotMatch(html, /<script[^>]+https?:\/\//i);
});
