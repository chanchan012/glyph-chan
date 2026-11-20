import { eventType, Inngest } from "inngest";
import { z } from "zod";

export const inngest = new Inngest({ id: "glyph-foundry" });

export const thumbnailRequested = eventType("glyph/thumbnail.requested", {
  schema: z.object({ id: z.uuid(), ownerId: z.string().min(1) }),
});

export async function requestThumbnail(ownerId: string, id: string) {
  // Missing thumbnails stay eligible for the scheduled repair job.
  if (!process.env.INNGEST_EVENT_KEY && process.env.INNGEST_DEV !== "1") return;
  try {
    await inngest.send(thumbnailRequested.create({ ownerId, id }));
  } catch (error) {
    console.error("Could not enqueue Glyph thumbnail", { id, cause: (error as Error).name });
  }
}
