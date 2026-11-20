import { z } from "zod";

export const agentInput = z.object({
  label: z.string().trim().min(1).max(40).regex(/^[^\p{Cc}\p{Cf}\p{Cs}]+$/u),
}).strict();

export interface AgentInfo {
  label: string;
  expiresAt: number;
}
