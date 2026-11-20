import { expect, test, type Page } from "@playwright/test";
import { guestStudio, studioDocument, type StudioSource } from "../../src/lib/foundry/studio-source";
import { studioSnapshot, type PresenceInput, type StudioPresence, type StudioSave } from "../../src/lib/foundry/sync-contract";

const id = "14bd6d3e-4bd8-4f27-b8a5-cba5a3c21e24";
const api = "**/api/collections/" + id;
const route = "/studio/" + id;
const ownerId = "studio-test";
type Shared = StudioSource & { syncRevision: number };

test("two studio sessions show active anchors, merge separate glyphs, and resolve overlapping edits", async ({ browser, baseURL }) => {
  const sample = guestStudio("demo")!;
  let shared: Shared = { ...sample, ...studioSnapshot(studioDocument(sample)), id, ownerId, syncRevision: 0 };
  const roster = new Map<string, StudioPresence>();
  const writes: StudioSave[] = [];
  let secondRevisionCap = 0;

  async function connect(page: Page, second = false) {
    await page.route(api + "/studio", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { studio: shared } });
      const save: StudioSave = route.request().postDataJSON();
      writes.push(save);
      if (save.expectedRevision !== shared.syncRevision) {
        return route.fulfill({ status: 409, json: { state: "conflict", studio: shared } });
      }
      shared = { ...shared, ...save.snapshot, syncRevision: shared.syncRevision + 1 };
      return route.fulfill({ json: { state: "saved", studio: shared } });
    });
    await page.route(api + "/presence", async route => {
      const entry: PresenceInput = route.request().postDataJSON();
      roster.set(entry.clientId, { ...entry, actor: { kind: "human", id: ownerId, label: "Designer" }, expiresAt: Date.now() + 45_000 });
      await route.fulfill({ status: 204 });
    });
    await page.route(api + "/events", async route => {
      const revision = second ? Math.min(shared.syncRevision, secondRevisionCap) : shared.syncRevision;
      await route.fulfill({
        contentType: "text/event-stream",
        body: [
          "retry: 220\n",
          "event: revision\nid: " + revision + "\ndata: " + JSON.stringify({ revision }) + "\n",
          "event: roster\ndata: " + JSON.stringify([...roster.values()]) + "\n",
          "",
        ].join("\n"),
      });
    });
    await page.goto(route);
    await expect(page.getByText("Saved to collection")).toBeVisible();
  }

  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  try {
    const a = await context.newPage();
    const b = await context.newPage();
    await connect(a);
    await connect(b, true);
    await a.bringToFront();
    await a.getByTestId("anchor-0-0").click();
    await expect.poll(() => [...roster.values()].some(entry => entry.anchor?.index === 0)).toBe(true);
    await b.bringToFront();
    await expect(b.getByTestId("peer-anchor")).toBeVisible();
    await expect(b.getByLabel("Live collaborators")).toContainText("Designer · A");

    const width = (page: Page) => page.getByLabel("Advance width");
    const select = (page: Page, glyph: string) => page.getByRole("button", { name: "Select glyph " + glyph, exact: true }).click();
    async function edit(page: Page, value: string) {
      await width(page).fill(value);
      await page.getByRole("button", { name: "Apply glyph metrics" }).click();
    }

    await a.bringToFront();
    await edit(a, "720");
    await expect.poll(() => shared.syncRevision).toBe(1);
    await b.bringToFront();
    await select(b, "V");
    await edit(b, "740");
    await expect.poll(() => shared.syncRevision).toBe(2);
    expect(writes.map(write => write.expectedRevision)).toEqual([0, 0, 1]);
    expect(shared.glyphs.find(glyph => glyph.key === "A")?.metrics.advanceWidth).toBe(720);
    expect(shared.glyphs.find(glyph => glyph.key === "V")?.metrics.advanceWidth).toBe(740);
    await a.bringToFront();
    await select(a, "V");
    await expect(width(a)).toHaveValue("740");
    await edit(a, "780");
    await expect.poll(() => shared.syncRevision).toBe(3);
    await b.bringToFront();
    await edit(b, "810");
    const conflict = b.getByRole("group", { name: "Resolve concurrent edits" });
    await expect(conflict).toContainText("Glyph V");
    await expect(width(b)).toHaveValue("810");
    await a.bringToFront();
    await select(a, "A");
    await edit(a, "750");
    await expect.poll(() => shared.syncRevision).toBe(4);
    await b.bringToFront();
    secondRevisionCap = 4;
    await b.reload();
    await expect(conflict).toContainText("Glyph V");
    await select(b, "V");
    await expect(width(b)).toHaveValue("810");
    await conflict.getByRole("button", { name: "Use shared changes" }).click();
    await expect(width(b)).toHaveValue("780");
    await expect(b.getByText("Saved to collection")).toBeVisible();
    expect(shared.syncRevision).toBe(4);
    expect(await b.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.endsWith(":recovery") && value.includes('"advanceWidth":810'))))
      .toBe(true);
  } finally {
    await context.close();
  }
});
