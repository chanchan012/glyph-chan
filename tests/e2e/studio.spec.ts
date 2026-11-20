import { expect, test, type Locator, type Page } from "@playwright/test";

const demo = "/studio/demo";

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw Error("Target is outside the canvas.");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function screenPoint(canvas: Locator, x: number, y: number) {
  return canvas.evaluate((svg, point) => {
    const position = new DOMPoint(point.x, point.y).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
    return { x: position.x, y: position.y };
  }, { x, y });
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

async function waitForStudio(page: Page) {
  await expect(page.locator(".studio-shell")).toHaveAttribute("data-ready", "true");
}

for (const [width, height] of [[1440, 900], [1024, 768], [768, 1024], [390, 844], [320, 568], [844, 390]]) {
  test(`studio fits ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(demo);
    await waitForStudio(page);
    const canvas = page.locator(".studio-canvas");
    await expect(canvas).toBeVisible();
    const measurements = await canvas.evaluate(svg => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      shellHeight: document.querySelector(".studio-shell")!.getBoundingClientRect().height,
      canvasHeight: svg.getBoundingClientRect().height,
    }));
    expect(measurements).toMatchObject({ width, height, shellHeight: height });
    expect(measurements.canvasHeight).toBeGreaterThan(120);
    if (width <= 930) {
      const panels = page.getByRole("group", { name: "Studio panel" });
      await panels.getByRole("button", { name: "Glyphs" }).click();
      await expect(page.getByRole("button", { name: "Select glyph A", exact: true })).toBeVisible();
      await panels.getByRole("button", { name: "Inspector" }).click();
      await expect(page.getByLabel("Advance width")).toBeVisible();
      await panels.getByRole("button", { name: "Canvas" }).click();
    }
    await page.getByRole("button", { name: "Guides", exact: true }).click();
    await expect(page.getByTestId("optical-guides")).toHaveCount(0);
  });
}

test("drags an anchor and a cubic handle with undo, redo, and local draft reload", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("link", { name: "Open in Studio" }).click();
  await waitForStudio(page);
  const outline = page.getByTestId("glyph-path");
  const original = await outline.getAttribute("d");
  const first = await center(page.getByTestId("anchor-0-0"));
  await drag(page, first, { x: first.x + 28, y: first.y - 22 });
  await expect(outline).not.toHaveAttribute("d", original!);
  const anchorEdit = await outline.getAttribute("d");
  const control = await center(page.getByTestId("handle-0-0-control1"));
  await drag(page, control, { x: control.x + 25, y: control.y + 20 });
  await expect(outline).not.toHaveAttribute("d", anchorEdit!);
  const handleEdit = await outline.getAttribute("d");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(outline).toHaveAttribute("d", anchorEdit!);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(outline).toHaveAttribute("d", original!);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(outline).toHaveAttribute("d", handleEdit!);
  await page.reload();
  await expect(page.getByTestId("glyph-path")).toHaveAttribute("d", handleEdit!);
});

test("draws a quadratic contour, adds a primitive, combines shapes, and edits metrics", async ({ page }) => {
  await page.goto(demo);
  await waitForStudio(page);
  await page.getByRole("button", { name: "Select glyph B", exact: true }).click();
  await page.getByRole("button", { name: "Pen", exact: true }).click();
  await page.getByLabel("Curve type").selectOption("quadratic");
  const canvas = page.locator(".studio-canvas");
  const first = await screenPoint(canvas, 160, -325);
  const second = await screenPoint(canvas, 420, -325);
  const third = await screenPoint(canvas, 290, -90);
  await drag(page, first, { x: first.x + 29, y: first.y - 55 });
  await page.mouse.click(second.x, second.y);
  await page.mouse.click(third.x, third.y);
  await page.getByRole("button", { name: "Close path", exact: true }).click();
  await expect(page.getByTestId("glyph-path")).toHaveAttribute("d", /\bQ\b.*Z$/);
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await drag(page, await screenPoint(canvas, 200, -510), await screenPoint(canvas, 355, -190));
  const path = page.getByTestId("glyph-path");
  await expect(path).toHaveAttribute("d", /Z M /);
  const separate = await path.getAttribute("d");
  await page.getByRole("checkbox", { name: /Contour 1/ }).check();
  await page.getByRole("button", { name: "Union", exact: true }).click();
  await expect(path).not.toHaveAttribute("d", separate!);
  await expect(path).toHaveAttribute("d", /^(?!.*Z M).*Z$/);
  await page.getByLabel("Advance width").fill("720");
  await page.getByRole("button", { name: "Apply glyph metrics" }).click();
  await expect(page.getByLabel("Advance width")).toHaveValue("720");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
});

test("member studio opens its collection from the dashboard", async ({ page }) => {
  const id = "14bd6d3e-4bd8-4f27-b8a5-cba5a3c21e24";
  await page.route("**/api/collections", route => route.fulfill({ json: { collections: [{ id, name: "Studio fixture", kind: "icon_set", thumbnail: null, updatedAt: "" }] } }));
  await page.route("**/api/collections/" + id + "/studio", route => route.fulfill({ json: {
    studio: { id, name: "Studio fixture", ownerId: "test-owner", kind: "icon_set",
      metrics: { unitsPerEm: 1000, ascender: 800, descender: -200, capHeight: 700, xHeight: 500 }, glyphs: [] },
  } }));
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Studio fixture" }).click();
  await expect(page.getByRole("heading", { name: "Studio fixture" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Select glyph icon", exact: true })).toBeVisible();
});
