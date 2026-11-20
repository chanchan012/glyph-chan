import { sql, type SQL } from "drizzle-orm";
import { connectDatabase } from "../db/client";
import { snapshotDocument, type StudioSource } from "../lib/foundry/studio-source";
import { studioSnapshot, type StudioActor, type StudioHead, type StudioReceipt, type StudioSave } from "../lib/foundry/sync-contract";

type SavedStudio = StudioSource & StudioHead;
type SaveOutcome = {
  state: "saved"; studio: SavedStudio; receipt: StudioReceipt; replay: boolean;
} | {
  state: "conflict"; studio: SavedStudio;
};

export interface StudioRepository {
  load(ownerId: string, id: string): Promise<SavedStudio | null>;
  head(ownerId: string, id: string): Promise<StudioHead | null>;
  save(ownerId: string, id: string, actor: StudioActor, input: StudioSave): Promise<SaveOutcome | null>;
}

type Query = <Row extends Record<string, unknown>>(query: SQL) => Promise<Row[]>;
export class InvalidStudioDraft extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStudioDraft";
  }
}

export function createStudioRepository(query: Query): StudioRepository {
  async function load(ownerId: string, id: string): Promise<SavedStudio | null> {
    const rows = await query<SavedStudio & Record<string, unknown>>(sql`
      SELECT c.id, c.owner_id AS "ownerId", c.name, c.kind,
        c.studio_revision AS "syncRevision", c.studio_receipts AS receipts,
        jsonb_build_object('unitsPerEm', c.units_per_em, 'ascender', c.ascender, 'descender', c.descender,
          'capHeight', c.cap_height, 'xHeight', c.x_height) AS metrics,
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object('key', g.key, 'paths', g.paths, 'metrics', jsonb_build_object(
            'advanceWidth', g.advance_width, 'leftBearing', g.left_bearing, 'rightBearing', g.right_bearing
          )) ORDER BY g.key COLLATE "C")
          FROM glyphs g WHERE g.collection_id = c.id
        ), '[]'::jsonb) AS glyphs,
        CASE WHEN c.kind = 'typeface' THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('left', k.left_key, 'right', k.right_key, 'adjustment', k.adjustment)
            ORDER BY k.left_key COLLATE "C", k.right_key COLLATE "C")
          FROM kerning_pairs k WHERE k.collection_id = c.id
        ), '[]'::jsonb) ELSE '[]'::jsonb END AS kerning
      FROM collections c WHERE c.id = ${id} AND c.owner_id = ${ownerId}
    `);
    return rows[0] ?? null;
  }

  async function head(ownerId: string, id: string): Promise<StudioHead | null> {
    const rows = await query<StudioHead & Record<string, unknown>>(sql`
      SELECT studio_revision AS "syncRevision", studio_receipts AS receipts
      FROM collections WHERE id = ${id} AND owner_id = ${ownerId}
    `);
    return rows[0] ?? null;
  }

  async function save(ownerId: string, id: string, actor: StudioActor, input: StudioSave): Promise<SaveOutcome | null> {
    const current = await load(ownerId, id);
    if (!current) return null;
    const existing = current.receipts.find(receipt => receipt.requestId === input.requestId);
    if (existing) return { state: "saved", studio: current, receipt: existing, replay: true };
    if (input.expectedRevision !== current.syncRevision) return { state: "conflict", studio: current };

    let canonical: ReturnType<typeof studioSnapshot>;
    try {
      canonical = studioSnapshot(snapshotDocument(current, input.snapshot));
    } catch (error) {
      throw new InvalidStudioDraft(error instanceof Error ? error.message : "The draft is invalid.");
    }
    const { metrics, glyphs, kerning } = canonical;
    const receipt = { requestId: input.requestId, revision: input.expectedRevision + 1, actor, at: new Date().toISOString() };
    const receipts = JSON.stringify([...current.receipts.slice(-31), receipt]);
    const glyphInput = JSON.stringify(glyphs.map(glyph => ({
      key: glyph.key, paths: glyph.paths, advance_width: glyph.metrics.advanceWidth,
      left_bearing: glyph.metrics.leftBearing, right_bearing: glyph.metrics.rightBearing,
    })));
    const kerningInput = JSON.stringify(kerning.map(pair => ({
      left_key: pair.left, right_key: pair.right, adjustment: pair.adjustment,
    })));
    const written = await query<{ revision: number }>(sql`
      WITH accepted AS (
        UPDATE collections SET studio_revision = studio_revision + 1, studio_receipts = ${receipts}::jsonb,
          units_per_em = ${metrics.unitsPerEm}, ascender = ${metrics.ascender}, descender = ${metrics.descender},
          cap_height = ${metrics.capHeight}, x_height = ${metrics.xHeight}, updated_at = now()
        WHERE id = ${id} AND owner_id = ${ownerId} AND studio_revision = ${input.expectedRevision}
        RETURNING id, studio_revision
      ), glyph_input AS (
        SELECT * FROM jsonb_to_recordset(${glyphInput}::jsonb)
          AS incoming(key text, paths jsonb, advance_width int, left_bearing int, right_bearing int)
      ), remove_glyphs AS (
        DELETE FROM glyphs g USING accepted WHERE g.collection_id = accepted.id
          AND NOT EXISTS (SELECT 1 FROM glyph_input incoming WHERE incoming.key = g.key)
      ), upsert_glyphs AS (
        INSERT INTO glyphs (collection_id, key, paths, advance_width, left_bearing, right_bearing)
        SELECT accepted.id, incoming.key, incoming.paths, incoming.advance_width, incoming.left_bearing, incoming.right_bearing
        FROM accepted CROSS JOIN glyph_input incoming
        ON CONFLICT (collection_id, key) DO UPDATE
          SET paths = EXCLUDED.paths, advance_width = EXCLUDED.advance_width,
            left_bearing = EXCLUDED.left_bearing, right_bearing = EXCLUDED.right_bearing,
            revision = glyphs.revision + 1
        WHERE (glyphs.paths, glyphs.advance_width, glyphs.left_bearing, glyphs.right_bearing)
          IS DISTINCT FROM (EXCLUDED.paths, EXCLUDED.advance_width, EXCLUDED.left_bearing, EXCLUDED.right_bearing)
      ), kerning_input AS (
        SELECT * FROM jsonb_to_recordset(${kerningInput}::jsonb) AS incoming(left_key text, right_key text, adjustment int)
      ), remove_pairs AS (
        DELETE FROM kerning_pairs k USING accepted WHERE k.collection_id = accepted.id
          AND NOT EXISTS (SELECT 1 FROM kerning_input incoming WHERE incoming.left_key = k.left_key AND incoming.right_key = k.right_key)
      ), upsert_pairs AS (
        INSERT INTO kerning_pairs (collection_id, left_key, right_key, adjustment)
        SELECT accepted.id, incoming.left_key, incoming.right_key, incoming.adjustment
        FROM accepted CROSS JOIN kerning_input incoming
        ON CONFLICT (collection_id, left_key, right_key) DO UPDATE SET adjustment = EXCLUDED.adjustment
        WHERE kerning_pairs.adjustment IS DISTINCT FROM EXCLUDED.adjustment
      ) SELECT studio_revision AS revision FROM accepted
    `);
    if (written.length) {
      return { state: "saved", receipt, replay: false,
        studio: { ...current, ...canonical, syncRevision: receipt.revision, receipts: [...current.receipts.slice(-31), receipt] } };
    }
    const latest = await load(ownerId, id);
    if (!latest) return null;
    const duplicate = latest.receipts.find(item => item.requestId === input.requestId);
    return duplicate ? { state: "saved", studio: latest, receipt: duplicate, replay: true }
      : { state: "conflict", studio: latest };
  }

  return { load, head, save };
}

export const studioRepository = createStudioRepository(async <Row extends Record<string, unknown>>(query: SQL) =>
  (await connectDatabase().execute<Row>(query)).rows);
