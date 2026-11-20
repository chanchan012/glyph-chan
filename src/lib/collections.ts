import { z } from "zod";

export const collectionKinds = ["typeface", "icon_set"] as const;
export const collectionInput = z.object({
  name: z.string().trim().min(1).max(80).regex(/^[^\p{Cc}]+$/u),
  kind: z.enum(collectionKinds),
}).strict();
export const collectionUpdate = collectionInput.pick({ name: true });
export const collectionId = z.uuid();
export type CollectionInput = z.infer<typeof collectionInput>;
export type CollectionKind = CollectionInput["kind"];

export type Collection = CollectionInput & {
  id: string;
  thumbnail: string | null;
  updatedAt: string;
};

export const collectionLabels: Record<CollectionKind, string> = {
  typeface: "Typeface",
  icon_set: "Icon set",
};
