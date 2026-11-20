import { expect, it, vi } from "vitest";
import { createApi } from "../../src/server/api";
import { decodeStudioDraft, encodeStudioDraft, guestStudio, studioDocument, studioDraftKey } from "../../src/lib/foundry/studio-source";
import { serializePath } from "../../src/lib/vector/svg";

it("round-trips studio metrics and contours in owner-isolated local storage", () => {
  const source = guestStudio("demo")!;
  const document = studioDocument(source);
  const restored = decodeStudioDraft(source, encodeStudioDraft(document));
  expect(restored).toEqual(document);
  expect(restored.glyphs.a.contours).toHaveLength(2);
  expect(serializePath(restored.glyphs.a.contours)).toContain("C");
  expect(studioDraftKey(source)).not.toBe(studioDraftKey({ ...source, ownerId: "member" }));
  expect(() => decodeStudioDraft(source, '{"glyphs": [{"paths": ["M0 L"]}]}')).toThrow();
  expect(guestStudio("missing")).toBeNull();
});

it("authorizes the studio query before loading and passes its verified collection owner", async () => {
  const id = "14bd6d3e-4bd8-4f27-b8a5-cba5a3c21e24";
  const url = "/api/collections/" + id + "/studio";
  const fixture = guestStudio("demo")!;
  const loadStudio = vi.fn(async (ownerId: string, collectionId: string) =>
    ownerId === "owner" ? { ...fixture, ownerId, id: collectionId } : null);
  const app = (userId: string | null) => createApi({
    identify: async (c, next) => { c.set("userId", userId); await next(); },
    limit: async () => null,
    loadStudio,
  });
  expect((await app(null).request(url)).status).toBe(401);
  expect(loadStudio).not.toHaveBeenCalled();
  expect((await app("other").request(url)).status).toBe(404);
  expect((await app("owner").request(url)).status).toBe(200);
  expect(loadStudio).toHaveBeenLastCalledWith("owner", id);
});
