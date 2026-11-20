import { test, expect } from "@playwright/test";

for (const [width, height, columns] of [[1440,900,4],[768,1024,2],[390,844,2],[320,568,2],[844,390,3]]) {
  test(`collection grid fits ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Collections", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Forma Serif" })).toBeVisible();
    const layout = await page.locator(".dashboard-grid").evaluate(grid => ({
      columns: getComputedStyle(grid).gridTemplateColumns.split(" ").length,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      shell: document.querySelector(".shell")!.getBoundingClientRect().height,
      gridInViewport: grid.getBoundingClientRect().top < innerHeight,
    }));
    expect(layout).toEqual({ columns, width, height, shell: height, gridInViewport: true });
    await page.getByRole("button", { name: "Icon sets" }).click();
    await expect(page.getByRole("heading", { name: "Forma Serif" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Orbit Symbols" })).toBeVisible();
  });
}

test("member can create, rename and delete a collection through the dashboard", async ({ page }) => {
  const id = "14bd6d3e-4bd8-4f27-b8a5-cba5a3c21e24";
  let name: string | null = null;
  const row = () => ({ id, name, kind: "icon_set", thumbnail: null, updatedAt: new Date().toISOString() });
  await page.route("**/api/collections**", async route => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: { collections: name ? [row()] : [] } });
    if (method === "DELETE") {
      name = null;
      return route.fulfill({ status: 204 });
    }
    const input = route.request().postDataJSON();
    if (method === "POST") expect(input.kind).toBe("icon_set");
    name = input.name;
    return route.fulfill({ status: method === "POST" ? 201 : 200, json: { collection: row() } });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByLabel("Name", { exact: true }).fill("North Icons");
  await page.getByLabel("Collection type").selectOption("icon_set");
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByRole("heading", { name: "North Icons" })).toBeVisible();
  await page.getByRole("button", { name: "Rename North Icons" }).click();
  await page.getByLabel("Name", { exact: true }).fill("True North");
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByRole("heading", { name: "True North" })).toBeVisible();
  await page.getByRole("button", { name: "Delete True North" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "True North" })).toHaveCount(0);
  await expect(page.getByText("Create a typeface or an icon set to get started.")).toBeVisible();
});
