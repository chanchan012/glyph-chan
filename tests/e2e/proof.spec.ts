import { expect, test } from "@playwright/test";

async function openProof(page: import("@playwright/test").Page) {
  await page.goto("/studio/demo");
  await expect(page.locator(".studio-shell")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Specimen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Waterfall" })).toBeVisible();
}

test("updates the real outlines at every size as text and kerning change", async ({ page }) => {
  await openProof(page);
  const specimen = page.locator(".waterfall-rows");
  await expect(specimen.locator("svg")).toHaveCount(5);
  await page.getByLabel("Specimen text").fill("AV");
  await expect(specimen.locator('[data-proof-glyph="V"][data-adjustment="-52"]')).toHaveCount(5);
  await page.getByLabel("Show kerning").uncheck();
  await expect(specimen.locator('[data-proof-glyph="V"][data-adjustment="0"]')).toHaveCount(5);
  await page.getByLabel("Show kerning").check();
  await page.getByLabel("Adjustment in units").fill("-95");
  await expect(specimen.locator('[data-proof-glyph="V"][data-adjustment="-95"]')).toHaveCount(5);
  await page.getByRole("button", { name: "Save pair" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByLabel("Adjustment in units")).toHaveValue("-52");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByLabel("Adjustment in units")).toHaveValue("-95");
  await page.reload();
  await expect(page.locator(".studio-shell")).toHaveAttribute("data-ready", "true");
  await page.getByRole("button", { name: "Specimen", exact: true }).click();
  await expect(page.getByLabel("Adjustment in units")).toHaveValue("-95");
  await page.getByRole("button", { name: "Optical audit" }).click();
  await expect(page.getByRole("table", { name: /Stem widths/ })).toBeVisible();
  await page.getByLabel("Stem target", { exact: true }).fill("1");
  await expect(page.getByRole("table").getByText("Review stem").first()).toBeVisible();
});

test("waterfall and optical inspector fit the locked mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openProof(page);
  await page.getByLabel("Specimen text").fill("AV area\nAV area AV area AV area AV area");
  await expect(page.locator('[data-size="80"] [data-proof-glyph="A"]')).toHaveCount(5);
  await page.getByRole("button", { name: "Proof inspector", exact: true }).click();
  await page.getByRole("button", { name: "Optical audit", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  expect(await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }))).toEqual({ width: 390, height: 844 });
});
