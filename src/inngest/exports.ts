import { eventType } from "inngest";
import { z } from "zod";
import { exportJobStore, runExportJob } from "../server/export-jobs";
import { inngest } from "./client";

const exportEventData = z.object({ jobId: z.uuid() });
const exportRequested = eventType("glyph/export.requested", { schema: exportEventData });

export async function requestExport(jobId: string) {
  await inngest.send(exportRequested.create({ jobId }, { id: jobId }));
}

export const compileCollectionExport = inngest.createFunction(
  {
    id: "compile-collection-export",
    triggers: [exportRequested],
    concurrency: { key: "event.data.jobId", limit: 1 },
    onFailure: async ({ event, step }) => {
      const input = exportEventData.safeParse(event.data.event.data);
      if (!input.success) return { markedFailed: false };
      return step.run("mark-export-failed", async () => {
        const job = await exportJobStore.get(input.data.jobId);
        if (!job || job.state !== "queued") return { markedFailed: false };
        const markedFailed = await exportJobStore.finish(job, {
          state: "failed",
          message: "Compilation failed after retrying. Start a new export to try again.",
        });
        return { markedFailed };
      });
    },
  },
  async ({ event, step }) => step.run("compile-and-store", () => runExportJob(event.data.jobId)),
);

export const repairCollectionExports = inngest.createFunction(
  { id: "repair-collection-exports", triggers: [{ cron: "*/5 * * * *" }], concurrency: { limit: 1 } },
  async ({ step }) => {
    const jobIds = await step.run("find-queued", () => exportJobStore.pending(Date.now() - 120_000));
    if (jobIds.length) await step.sendEvent("enqueue-exports", jobIds.map(jobId => exportRequested.create({ jobId })));
    return { requested: jobIds.length };
  },
);
