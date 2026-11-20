import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("guest downloads a real webfont and the browser loads it", async ({ page }) => {
  await page.goto("/studio/demo");
  await expect(page.locator(".studio-shell")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Export typeface" })).toBeVisible();
  const downloaded = page.waitForEvent("download", { timeout: 15000 });
  const response = page.waitForResponse(response => response.url().endsWith("/api/exports") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Build export" }).click();
  expect((await response).status()).toBe(200);
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe("forma-serif.woff2");
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 4).toString("ascii")).toBe("wOF2");
  const loaded = await page.evaluate(async values => {
    const face = new FontFace("ExportTest", Uint8Array.from(values));
    await face.load();
    document.fonts.add(face);
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = "100px ExportTest";
    context.fontKerning = "none";
    const unkerned = context.measureText("AV").width;
    context.fontKerning = "normal";
    return { loaded: document.fonts.check("24px ExportTest", "AV area"), difference: unkerned - context.measureText("AV").width };
  }, Array.from(bytes));
  expect(loaded.loaded).toBe(true);
  expect(loaded.difference).toBeCloseTo(5.2, 1);
});

test("mobile icon studio downloads a React package", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/studio/orbit");
  await expect(page.locator(".studio-shell")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByLabel("Format").selectOption("react");
  const download = page.waitForEvent("download", { timeout: 15000 });
  await page.getByRole("button", { name: "Build export" }).click();
  expect((await download).suggestedFilename()).toBe("orbit-symbols-react.zip");
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
});

test("member export tracks its queued job and exposes the finished download", async ({ page }) => {
  const id = "14bd6d3e-4bd8-4f27-b8a5-cba5a3c21e24";
  const job = "14bd6d3e-4bd8-4f27-b8a5-cba5a3c21e25";
  await page.route("**/api/collections/" + id + "/studio", route => route.fulfill({ json: { studio: {
    id, name: "Queued test", ownerId: "test", kind: "typeface",
    metrics: { unitsPerEm: 1000, ascender: 800, descender: -200, capHeight: 700, xHeight: 500 },
    glyphs: [],
  } } }));
  await page.route("**/api/exports", async route => {
    expect(route.request().postDataJSON()).toMatchObject({ collectionId: id, format: "woff2", name: "Queued test" });
    await route.fulfill({ status: 202, json: { id: job, state: "queued" } });
  });
  await page.route("**/api/exports/" + job, route => route.fulfill({ json: { state: "ready", filename: "queued-test.woff2" } }));
  await page.goto("/studio/" + id);
  await expect(page.locator(".studio-shell")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Build export" }).click();
  const file = page.getByRole("link", { name: "Download file" });
  await expect(file).toHaveAttribute("href", "/api/exports/" + job + "/download");
  await page.reload();
  await expect(page.locator(".studio-shell")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page.getByRole("button", { name: "Check last export" }).click();
  await expect(file).toBeVisible();
});

test("Inngest dev endpoint registers the export and repair workers", async ({ request }) => {
  const response = await request.get("/api/inngest");
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ function_count: 4 });
});
