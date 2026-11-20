import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { renderThumbnail, repairThumbnails } from "@/inngest/thumbnails";

export const runtime = "nodejs";
export const { GET, POST, PUT } = serve({ client: inngest, functions: [renderThumbnail, repairThumbnails] });
