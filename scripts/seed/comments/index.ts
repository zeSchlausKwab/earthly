import {
	GEO_COLLECTION_KIND,
	GEO_EVENT_KIND,
	MAP_CONTEXT_KIND,
} from "@/lib/ndk/kinds";
import type { CommentTarget } from "../types";
import { buildCollectionCommentThreads } from "./collections";
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
		case GEO_COLLECTION_KIND:
			return buildCollectionCommentThreads(target, seedIndex);
		case GEO_EVENT_KIND:
		default:
			return buildDatasetCommentThreads(target, seedIndex);
	}
}
