import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFile(path.join(root, relativePath), "utf8");

function extractFunction(source, name) {
  const signature = `function ${name}`;
  const signatureIndex = source.indexOf(signature);
  assert.notEqual(signatureIndex, -1, `Expected to find ${signature}()`);

  const parametersStart = source.indexOf("(", signatureIndex + signature.length);
  assert.notEqual(parametersStart, -1, `Expected ${name}() to have parameters`);

  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parameterDepth += 1;
    if (source[index] === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parametersEnd = index;
        break;
      }
    }
  }
  assert.notEqual(parametersEnd, -1, `Expected ${name}() parameters to close`);

  const bodyStart = source.indexOf("{", parametersEnd);
  assert.notEqual(bodyStart, -1, `Expected ${name}() to have a body`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(signatureIndex, index + 1);
    }
  }

  assert.fail(`Could not find the end of ${name}()`);
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected to find ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Expected to find ${endMarker} after ${startMarker}`);
  return source.slice(start, end);
}

function headerRulesFromBuild(buildSource) {
  const match = buildSource.match(
    /writeFile\(path\.join\(dist,\s*["_']_headers["_']\),\s*`([\s\S]*?)`,\s*["']utf8["']\)/
  );
  assert.ok(match, "Expected the build to generate a Netlify _headers file");

  const rules = [];
  let currentRule = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("/")) {
      currentRule = { route: line, cacheControl: [] };
      rules.push(currentRule);
    } else if (currentRule && /^Cache-Control:/i.test(line)) {
      currentRule.cacheControl.push(line.replace(/^Cache-Control:\s*/i, ""));
    }
  }
  return rules;
}

function routeMatches(pattern, pathname) {
  if (pattern === pathname) return true;
  if (pattern.endsWith("*")) return pathname.startsWith(pattern.slice(0, -1));
  return false;
}

test("direct case resolution rejects unpublished work by id and slug", async () => {
  const source = await read("case-sheet.jsx");
  const findCaseWorkSource = extractFunction(source, "findCaseWork");
  const context = {};

  vm.createContext(context);
  vm.runInContext(
    `${findCaseWorkSource}\nglobalThis.findCaseWorkForTest = findCaseWork;`,
    context
  );

  const content = {
    works: {
      graphic: [
        {
          id: "private-case",
          slug: "private-slug",
          side: "graphic",
          title: "Unpublished project",
          is_published: false,
        },
        {
          id: "public-case",
          slug: "public-slug",
          side: "graphic",
          title: "Published project",
          is_published: true,
        },
      ],
      webdev: [],
    },
  };

  assert.equal(
    context.findCaseWorkForTest("private-case", content, "graphic"),
    null,
    "An unpublished work id must not resolve through a public case route"
  );
  assert.equal(
    context.findCaseWorkForTest("private-slug", content, "graphic"),
    null,
    "An unpublished work slug must not resolve through a public case route"
  );
  assert.equal(
    context.findCaseWorkForTest("public-case", content, "graphic").title,
    "Published project"
  );
  assert.equal(
    context.findCaseWorkForTest("private-case", content, "graphic", undefined, true).title,
    "Unpublished project",
    "Authenticated draft preview must be able to opt into unpublished work explicitly"
  );

  const caseSheetSource = extractFunction(source, "CaseSheet");
  assert.match(
    caseSheetSource,
    /if\s*\([\s\S]{0,240}!allowUnpublished[\s\S]{0,120}!linkedWork[\s\S]{0,120}\)\s*return\s+null/,
    "Standalone/default case data must not bypass the published-work gate outside draft preview"
  );
});

test("auth loss and logout revoke parent draft preview state", async () => {
  const [app, admin] = await Promise.all([
    read("app.jsx"),
    read("admin-panel.jsx"),
  ]);

  const callbackProp = app.match(
    /onAccessRevoked\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/
  );
  assert.ok(callbackProp, "App must pass an onAccessRevoked callback to AdminPanel");

  const callbackName = callbackProp[1];
  const callbackStart = app.search(
    new RegExp(`(?:const\\s+${callbackName}\\s*=|function\\s+${callbackName}\\s*\\()`)
  );
  assert.notEqual(callbackStart, -1, `Expected App to define ${callbackName}`);
  const callbackRegion = app.slice(callbackStart, callbackStart + 1600);
  assert.match(callbackRegion, /setPreviewMode\s*\(\s*false\s*\)/);
  assert.match(callbackRegion, /PortfolioContent\.loadAsync\s*\(/);
  assert.match(callbackRegion, /setContent\s*\(/);

  const clearAccessSource = sliceBetween(
    admin,
    "const clearAccess",
    "const loadAuthorizedState"
  );
  assert.match(
    clearAccessSource,
    /\bonAccessRevoked\s*(?:\?\.)?\s*\(\s*\)/,
    "Clearing authorization must also revoke draft preview held by App"
  );

  const authChangeSource = sliceBetween(
    admin,
    "sb.auth.onAuthStateChange",
    "return () =>"
  );
  assert.match(authChangeSource, /SIGNED_OUT/);
  assert.match(authChangeSource, /\bclearAccess\s*\(\s*\)/);

  const logoutSource = sliceBetween(admin, "const logout", "if (!open || !enabled)");
  assert.match(logoutSource, /\bclearAccess\s*\(\s*\)/);
});

test("logout handles Supabase signOut errors returned in resolved results", async () => {
  const admin = await read("admin-panel.jsx");
  const logoutSource = sliceBetween(admin, "const logout", "if (!open || !enabled)");

  assert.doesNotMatch(
    logoutSource,
    /auth\.signOut\s*\(\s*\)\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/,
    "A resolved { error } from Supabase is not handled by Promise.catch()"
  );

  const destructuredError =
    /(?:const|let)\s*\{\s*error(?:\s*:\s*[A-Za-z_$][\w$]*)?\s*\}\s*=\s*await\s+sb\.auth\.signOut\s*\(\s*\)/;
  const assignedResult = logoutSource.match(
    /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+sb\.auth\.signOut\s*\(\s*\)/
  );
  assert.ok(
    destructuredError.test(logoutSource) || assignedResult,
    "Logout must retain the resolved result from sb.auth.signOut()"
  );
  if (assignedResult) {
    assert.match(
      logoutSource,
      new RegExp(`${assignedResult[1]}\\s*\\?*\\.\\s*error\\b`),
      "Logout must inspect the error property on the resolved signOut result"
    );
  }
  assert.match(
    logoutSource,
    /\bif\s*\(\s*[A-Za-z_$][\w$]*(?:Error|error)\s*\)/,
    "Logout must branch on the returned signOut error"
  );
});

test("unhashed app and runtime config assets are never cached as immutable", async () => {
  const buildSource = await read("scripts/build.mjs");
  const rules = headerRulesFromBuild(buildSource);

  for (const asset of ["/assets/app.js", "/assets/config.js"]) {
    const matchingDirectives = rules
      .filter((rule) => routeMatches(rule.route, asset))
      .flatMap((rule) => rule.cacheControl);

    assert.ok(matchingDirectives.length > 0, `Expected a cache rule for ${asset}`);
    for (const directive of matchingDirectives) {
      assert.doesNotMatch(
        directive,
        /\bimmutable\b/i,
        `${asset} is unhashed/environment-sensitive and must not be immutable`
      );
    }
    assert.ok(
      matchingDirectives.some((directive) =>
        /\bno-cache\b|\bno-store\b|\bmust-revalidate\b|\bmax-age\s*=\s*0\b/i.test(directive)
      ),
      `${asset} must be revalidated instead of receiving a long-lived cache policy`
    );
  }
});

test("active production sources contain no known mojibake markers", async () => {
  const buildSource = await read("scripts/build.mjs");
  const jsxList = buildSource.match(/const\s+jsxFiles\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(jsxList, "Expected the production JSX entry list in scripts/build.mjs");

  const activeFiles = [
    ...Array.from(jsxList[1].matchAll(/["']([^"']+\.jsx)["']/g), (match) => match[1]),
    "styles.css",
    "scripts/build.mjs",
  ];
  const mojibake = /[\u00c2\u00c3\u00e2\u00f0\ufffd]/u;

  for (const file of activeFiles) {
    const source = await read(file);
    assert.doesNotMatch(source, mojibake, `Known mojibake marker found in ${file}`);
  }
});
