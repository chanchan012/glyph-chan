import { createThumbnail } from "../lib/thumbnail";
import { findMissingPreviews, loadPreviewTarget, saveThumbnail } from "../server/collections";
import { inngest, thumbnailRequested } from "./client";

export async function generateThumbnail(
  { ownerId, id }: { ownerId: string; id: string },
  services = { loadPreviewTarget, saveThumbnail },
) {
  const target = await services.loadPreviewTarget(ownerId, id);
  if (!target) return { saved: false };
  return { saved: await services.saveThumbnail(target, createThumbnail(target)) };
}

export const renderThumbnail = inngest.createFunction(
  { id: "render-collection-thumbnail", triggers: [thumbnailRequested] },
  async ({ event, step }) => step.run("render-and-store", () => generateThumbnail(event.data)),
);

export const repairThumbnails = inngest.createFunction(
  { id: "repair-collection-thumbnails", triggers: [{ cron: "17 * * * *" }] },
  async ({ step }) => {
    const targets = await step.run("find-missing", () => findMissingPreviews(new Date(Date.now() - 60000)));
    if (targets.length) await step.sendEvent("enqueue-repairs", targets.map(target => thumbnailRequested.create(target)));
    return { requested: targets.length };
  },
);
