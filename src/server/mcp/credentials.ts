import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Redis } from "@upstash/redis";
import { collectionId } from "../../lib/collections";
import type { AgentInfo } from "../../lib/foundry/mcp-contract";

export interface AgentCredential extends AgentInfo {
  ownerId: string;
  collectionId: string;
  agentId: string;
  digest: string;
}

export interface AgentStore {
  get(collection: string): Promise<AgentCredential | null>;
  set(credential: AgentCredential): Promise<void>;
  delete(collection: string): Promise<void>;
}

const lifetime = 7 * 86_400;
const key = (id: string) => "glyph:mcp:v1:" + id;
let redis: Redis | undefined;
const connection = () => redis ??= Redis.fromEnv();

export const agentStore: AgentStore = {
  get: id => connection().get<AgentCredential>(key(id)),
  async set(credential) {
    await connection().set(key(credential.collectionId), credential, { ex: lifetime });
  },
  async delete(id) {
    await connection().del(key(id));
  },
};

const hash = (secret: string) => createHash("sha256").update(secret, "ascii").digest();

export async function issueAgentToken(store: AgentStore, ownerId: string, collectionId: string, label: string) {
  const secret = randomBytes(32).toString("base64url");
  const credential = { ownerId, collectionId, label, agentId: crypto.randomUUID(),
    expiresAt: Date.now() + lifetime * 1000, digest: hash(secret).toString("hex") };
  await store.set(credential);
  return { token: "glyph_mcp_" + collectionId + "." + secret, agent: publicAgent(credential) };
}

export function activeAgent(credential: AgentCredential | null): credential is AgentCredential {
  return Boolean(credential && credential.expiresAt > Date.now());
}

export function publicAgent({ label, expiresAt }: AgentCredential): AgentInfo {
  return { label, expiresAt };
}

export function parseAgentToken(header: string | null | undefined) {
  const match = /^Bearer glyph_mcp_([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/i.exec(header ?? "");
  if (!match || !collectionId.safeParse(match[1]).success) return null;
  return { collectionId: match[1].toLowerCase(), secret: match[2] };
}

export async function verifyAgentToken(store: AgentStore, token: NonNullable<ReturnType<typeof parseAgentToken>>) {
  const credential = await store.get(token.collectionId);
  if (!activeAgent(credential) || credential.collectionId !== token.collectionId || !/^[0-9a-f]{64}$/.test(credential.digest)) return null;
  return timingSafeEqual(hash(token.secret), Buffer.from(credential.digest, "hex")) ? credential : null;
}
