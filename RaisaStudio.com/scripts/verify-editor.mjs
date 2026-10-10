// Behavioral browser regression checks. All writes stay in the loopback fixture.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createVisualFixtureServer } from "./visual-editor-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts/editor-verification");
await mkdir(output, { recursive: true });
const { server, backend } = await createVisualFixtureServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const report = { simulatedBackend: true, scenarios: [], errors: [] };
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined,
    headless: true, args: process.env.CHROME_NO_SANDBOX === "true" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (error) => report.errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  const waitFor = async (condition) => {
    const deadline = Date.now() + 10000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error("Fixture state did not reach its expected value");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };
  const scenario = async (name, callback) => {
    try { await callback(); report.scenarios.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { report.scenarios.push({ name, passed: false, error: error.message }); await page.screenshot({ path: path.join(output, "failure.png") }); throw error; }
  };
  const drawer = page.locator(".visual-admin-drawer");
  const toolbar = page.locator(".visual-admin-toolbar");
  const openSettings = async () => {
    if (!await drawer.isVisible()) await toolbar.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Manage content", { exact: true }).selectOption("site");
  };
  const closeDrawer = () => drawer.getByRole("button", { name: "Close editor panel", exact: true }).click();
  await scenario("authorized editor loads with usable contextual controls", async () => {
    await page.goto(`${origin}/admin?fixture=owner`);
    await toolbar.waitFor();
    await page.getByLabel("Edit on this page", { exact: true }).waitFor();
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).cursor), "none");
  });
  await scenario("unsaved edits preview privately and save without publishing", async () => {
    await openSettings();
    await page.getByLabel("Brand name", { exact: true }).fill("Private audit brand");
    await closeDrawer();
    await toolbar.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByText("Private draft preview", { exact: true }).waitFor();
    assert.equal(backend.state.published.site.brandName, "RAISA Studio");
    await page.getByRole("button", { name: "Exit preview", exact: true }).click();
    await toolbar.getByRole("button", { name: "Save draft", exact: true }).click();
    await waitFor(() => backend.state.draft.site.brandName === "Private audit brand");
    assert.equal(backend.state.published.site.brandName, "RAISA Studio");
  });
  await scenario("edits made during a pending save remain dirty and survive", async () => {
    const originalRpc = backend.rpc;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let started = false;
    backend.rpc = async (name, args, role) => {
      if (name === "save_portfolio_draft") { started = true; await gate; }
      return originalRpc(name, args, role);
    };
    try {
      await openSettings();
      await page.getByLabel("Brand name", { exact: true }).fill("Saved first value");
      await page.keyboard.press("Control+s");
      await waitFor(() => started);
      await page.getByLabel("Brand name", { exact: true }).fill("Newer unsaved value");
      release();
      await waitFor(() => backend.state.draft.site.brandName === "Saved first value");
      await closeDrawer();
      await page.waitForFunction(() => !document.querySelector(".visual-admin-toolbar button")?.textContent?.includes("Saving"));
      await toolbar.getByRole("button", { name: "Save draft", exact: true }).click();
      await waitFor(() => backend.state.draft.site.brandName === "Newer unsaved value");
    } finally { release(); backend.rpc = originalRpc; }
  });
  await scenario("failed saves retain work and retry succeeds", async () => {
    backend.state.failures.set("save_portfolio_draft", "Injected save failure");
    await openSettings();
    await page.getByLabel("Brand name", { exact: true }).fill("Retry audit brand");
    await closeDrawer();
    await toolbar.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.locator(".admin-toast.error").waitFor();
    assert.equal(backend.state.draft.site.brandName, "Newer unsaved value");
    await toolbar.getByRole("button", { name: "Save draft", exact: true }).click();
    await waitFor(() => backend.state.draft.site.brandName === "Retry audit brand");
  });
  await scenario("contextual selection edits the exact work record", async () => {
    await page.locator(".nav-links").getByRole("button", { name: "Graphic Design", exact: true }).click();
    const target = page.locator('.page-graphic.visible .work-card[data-edit-id="g6"]');
    await target.scrollIntoViewIfNeeded();
    await page.getByLabel("Edit on this page", { exact: true }).selectOption({ label: "Ember Films" });
    await page.locator(".visual-editor-picker").getByRole("button", { name: "Edit Ember Films", exact: true }).click();
    const record = drawer.locator('[data-admin-record-id="g6"]');
    await record.waitFor();
    assert.equal(await record.getByLabel("Title", { exact: true }).inputValue(), "Ember Films");
    await record.getByLabel("Title", { exact: true }).fill("Ember audited");
    await page.keyboard.press("Control+s");
    await waitFor(() => backend.state.draft.works.graphic[5].title === "Ember audited");
    assert.equal(backend.state.draft.works.graphic[0].title, "Sorrel & Stone");
    await page.screenshot({ path: path.join(output, "selected-work.png") });
    await closeDrawer();
  });
  await scenario("gallery upload preserves both the media reference and its alt text", async () => {
    await openSettings();
    await page.getByLabel("Manage content", { exact: true }).selectOption("graphic");
    const projectId = backend.state.draft.projects.graphic[0].id;
    const project = drawer.locator(`[data-admin-record-id="${projectId}"]`);
    await project.getByRole("button", { name: "Add image", exact: true }).click();
    const gallery = project.locator(".admin-gallery-card").first();
    await gallery.locator('input[type="file"]').setInputFiles({ name: "audit.png", mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64") });
    const crop = page.locator(".admin-crop-dialog");
    await crop.waitFor();
    await crop.locator("textarea").fill("Gallery detail audit");
    await crop.getByRole("button", { name: "Upload original", exact: true }).click();
    await crop.waitFor({ state: "hidden" });
    await page.keyboard.press("Control+s");
    await waitFor(() => backend.state.draft.projects.graphic[0].gallery_images[0]?.alt_text === "Gallery detail audit");
    assert.match(backend.state.draft.projects.graphic[0].gallery_images[0].image_url, /^media:\/\//);
    await closeDrawer();
  });
  await scenario("stat editing retains focus and renders decimal and formatted values", async () => {
    await openSettings();
    await page.getByLabel("Manage content", { exact: true }).selectOption("webdev");
    const stats = drawer.locator(".admin-subsection").filter({ has: page.getByRole("heading", { name: "Page stats", exact: true }) });
    const label = stats.getByLabel("Label", { exact: true }).first();
    await label.fill("");
    await label.pressSequentially("Audited metric");
    assert.equal(await label.inputValue(), "Audited metric");
    assert.equal(await label.evaluate((element) => element === document.activeElement), true);
    await stats.getByLabel("Value", { exact: true }).nth(0).fill("4.9");
    await stats.getByLabel("Value", { exact: true }).nth(1).fill("06");
    await stats.getByLabel("Value", { exact: true }).nth(2).fill("1,200");
    await page.keyboard.press("Control+s");
    await waitFor(() => backend.state.draft.studios.webdev.pageStats[0].value === "4.9");
    await closeDrawer();
    await page.locator(".nav-links").getByRole("button", { name: "Software Dev", exact: true }).click();
    await page.waitForFunction(() => {
      const text = document.querySelector(".page-webdev.visible .page-stats")?.textContent || "";
      return ["4.9", "06", "1,200"].every((value) => text.includes(value));
    });
    await page.screenshot({ path: path.join(output, "draft-stats.png") });
  });
  await scenario("publish, restore, and unpublish preserve their distinct operations", async () => {
    await toolbar.getByRole("button", { name: "Publish", exact: true }).click();
    await waitFor(() => backend.state.published.site.brandName === "Retry audit brand");
    await openSettings();
    await page.getByLabel("Manage content", { exact: true }).selectOption("history");
    const before = backend.state.draftRevision;
    await drawer.getByRole("button", { name: "Restore to draft", exact: true }).first().click();
    await waitFor(() => backend.state.draftRevision === before + 1);
    assert.equal(backend.state.published.site.brandName, "Retry audit brand");
    await page.getByLabel("Manage content", { exact: true }).selectOption("dashboard");
    await drawer.getByRole("button", { name: "Unpublish site", exact: true }).click();
    await waitFor(() => !backend.state.publicEnabled);
    await closeDrawer();
    await toolbar.getByRole("button", { name: "Publish", exact: true }).click();
    await waitFor(() => backend.state.publicEnabled);
  });
  await scenario("sign-out clears the private workspace and viewer controls are read-only", async () => {
    await toolbar.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Sign in securely", exact: true }).waitFor();
    assert.equal(await page.locator(".visual-editor-picker").count(), 0);
    await page.goto(`${origin}/admin?fixture=viewer`);
    await toolbar.waitFor();
    assert.equal(await toolbar.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
    assert.equal(await toolbar.getByRole("button", { name: "Publish", exact: true }).isDisabled(), true);
    assert.equal(await page.locator(".visual-editor-picker").count(), 0);
    await openSettings();
    assert.equal(await page.getByLabel("Brand name", { exact: true }).isDisabled(), true);
    await page.screenshot({ path: path.join(output, "viewer-read-only.png") });
  });
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.errors.push(error.message);
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
}
