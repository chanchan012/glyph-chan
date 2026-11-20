import { Redis } from "@upstash/redis";
import { ExportInputError, type ExportArtifact, type ExportRequest } from "../lib/exports/contracts";

const prefix = "glyph:exports:v1:";
const pending = prefix + "pending";
const ttl = 86_400;
const jobKey = (id: string) => prefix + id;

type Status = { state: "queued" } | { state: "failed"; message: string }
  | { state: "ready"; filename: string; contentType: string };
export type ExportJob = {
  id: string; ownerId: string; createdAt: number; collectionId?: string; format?: ExportRequest["format"];
} & Status;
type StoredArtifact = { filename: string; contentType: string; data: string };
type Finished = Exclude<Status, { state: "queued" }>;

export interface ExportJobStore {
  create(job: ExportJob & { state: "queued" }, snapshot: ExportRequest): Promise<void>;
  get(id: string): Promise<ExportJob | null>;
  snapshot(id: string): Promise<ExportRequest | null>;
  artifact(id: string): Promise<StoredArtifact | null>;
  finish(job: ExportJob, status: Finished, artifact?: StoredArtifact): Promise<boolean>;
  pending(before: number): Promise<string[]>;
}

let redis: Redis | undefined;
function connection() {
  return redis ??= Redis.fromEnv();
}

export const exportJobStore: ExportJobStore = {
  async create(job, snapshot) {
    const key = jobKey(job.id);
    await connection().multi()
      .set(key, job, { ex: ttl }).set(key + ":source", snapshot, { ex: ttl })
      .zadd(pending, { score: job.createdAt, member: job.id }).exec();
  },
  get: id => connection().get<ExportJob>(jobKey(id)),
  snapshot: id => connection().get<ExportRequest>(jobKey(id) + ":source"),
  artifact: id => connection().get<StoredArtifact>(jobKey(id) + ":artifact"),
  async finish(job, status, artifact) {
    const key = jobKey(job.id);
    // Publishing the metadata and file together prevents a ready status without a download.
    const stored = await connection().eval<string[], number>(`
      local current = redis.call('GET', KEYS[1])
      if not current or cjson.decode(current).state ~= 'queued' then return 0 end
      local remaining = redis.call('TTL', KEYS[1])
      if remaining < 1 then return 0 end
      if ARGV[2] ~= '' then redis.call('SET', KEYS[3], ARGV[2], 'EX', remaining) end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', remaining)
      redis.call('DEL', KEYS[2])
      redis.call('ZREM', KEYS[4], ARGV[3])
      return 1
    `, [key, key + ":source", key + ":artifact", pending],
    [JSON.stringify({ ...job, ...status }), artifact ? JSON.stringify(artifact) : "", job.id]);
    return stored === 1;
  },
  async pending(before) {
    const client = connection();
    await client.zremrangebyscore(pending, 0, Date.now() - ttl * 1000);
    return client.zrange<string[]>(pending, 0, before, { byScore: true, offset: 0, count: 32 });
  },
};

export function canQueueExports() {
  const broker = process.env.INNGEST_DEV === "1"
    || (process.env.INNGEST_SIGNING_KEY && process.env.INNGEST_EVENT_KEY);
  return Boolean(broker && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export async function runExportJob(id: string, services: {
  store?: ExportJobStore; compile?: (input: ExportRequest) => Promise<ExportArtifact>;
} = {}) {
  const store = services.store ?? exportJobStore;
  const job = await store.get(id);
  if (!job || job.state !== "queued") return { state: job?.state ?? "expired" };
  const input = await store.snapshot(id);
  if (!input) {
    await store.finish(job, { state: "failed", message: "The draft snapshot expired. Start a new export." });
    return { state: "failed" as const };
  }

  let artifact: ExportArtifact;
  try {
    const compile = services.compile ?? (await import("../lib/exports/compile")).compileExport;
    artifact = await compile(input);
  } catch (error) {
    if (!(error instanceof ExportInputError)) throw error;
    await store.finish(job, { state: "failed", message: error.message });
    return { state: "failed" as const };
  }
  const { filename, contentType } = artifact;
  const stored = await store.finish(job, { state: "ready", filename, contentType }, {
    filename, contentType, data: Buffer.from(artifact.bytes).toString("base64"),
  });
  return { state: stored ? "ready" as const : "expired" as const };
}
