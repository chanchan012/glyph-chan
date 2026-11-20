import { and, asc, desc, eq, isNull, lt, or } from "drizzle-orm";
import { connectDatabase } from "../db/client";
import { collections } from "../db/schema";
import type { Collection, CollectionInput } from "../lib/collections";

type Row = typeof collections.$inferSelect;
export type PreviewTarget = Pick<Row, "id" | "ownerId" | "name" | "kind">;

export interface CollectionStore {
  list(ownerId: string): Promise<Collection[]>;
  create(ownerId: string, input: CollectionInput): Promise<Collection>;
  rename(ownerId: string, id: string, name: string): Promise<Collection | null>;
  remove(ownerId: string, id: string): Promise<boolean>;
}

function publicCollection({ id, name, kind, thumbnail, updatedAt }: Row): Collection {
  return { id, name, kind, thumbnail, updatedAt: updatedAt.toISOString() };
}

function owned(ownerId: string, id: string) {
  return and(eq(collections.ownerId, ownerId), eq(collections.id, id));
}

export const collectionStore: CollectionStore = {
  async list(ownerId) {
    const rows = await connectDatabase().select().from(collections)
      .where(eq(collections.ownerId, ownerId)).orderBy(desc(collections.updatedAt), asc(collections.id));
    return rows.map(publicCollection);
  },
  async create(ownerId, input) {
    const [row] = await connectDatabase().insert(collections).values({ ...input, ownerId }).returning();
    return publicCollection(row);
  },
  async rename(ownerId, id, name) {
    const [row] = await connectDatabase().update(collections)
      .set({ name, thumbnail: null, updatedAt: new Date() })
      .where(owned(ownerId, id)).returning();
    return row ? publicCollection(row) : null;
  },
  async remove(ownerId, id) {
    const [row] = await connectDatabase().delete(collections).where(owned(ownerId, id))
      .returning({ id: collections.id });
    return Boolean(row);
  },
};

const previewSelection = {
  id: collections.id, ownerId: collections.ownerId, name: collections.name, kind: collections.kind,
};

export async function loadPreviewTarget(ownerId: string, id: string): Promise<PreviewTarget | null> {
  const [row] = await connectDatabase().select(previewSelection).from(collections)
    .where(and(owned(ownerId, id), isNull(collections.thumbnail)));
  return row ?? null;
}

export function findMissingPreviews(cutoff: Date) {
  return connectDatabase().select({ id: collections.id, ownerId: collections.ownerId }).from(collections)
    .where(and(isNull(collections.thumbnail), lt(collections.updatedAt, cutoff)))
    .orderBy(asc(collections.updatedAt)).limit(100);
}

export async function saveThumbnail(target: PreviewTarget, thumbnail: string) {
  const [row] = await connectDatabase().update(collections).set({ thumbnail })
    .where(and(
      owned(target.ownerId, target.id), eq(collections.name, target.name), eq(collections.kind, target.kind),
      or(isNull(collections.thumbnail), eq(collections.thumbnail, thumbnail)),
    )).returning({ id: collections.id });
  return Boolean(row);
}
