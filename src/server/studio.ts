import { studioRepository } from "./studio-repository";
import type { StudioSource } from "../lib/foundry/studio-source";

export function loadStudio(ownerId: string, id: string): Promise<StudioSource | null> {
  return studioRepository.load(ownerId, id);
}
