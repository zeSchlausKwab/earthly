import { GEO_EVENT_KIND, MAP_CONTEXT_KIND } from "@/lib/nostr/kinds";
import type { CommentTarget } from "../types";
import { buildContextCommentThreads } from "./contexts";
import { buildDatasetCommentThreads } from "./datasets";
import type { SeedCommentSpec } from "./shared";

export type { SeedCommentSpec } from "./shared";

export function buildSeedCommentThreads(
  target: CommentTarget,
  seedIndex: number,
): SeedCommentSpec[] {
  switch (target.kind) {
    case MAP_CONTEXT_KIND:
      return buildContextCommentThreads(target, seedIndex);
    case GEO_EVENT_KIND:
    default:
      return buildDatasetCommentThreads(target, seedIndex);
  }
}
