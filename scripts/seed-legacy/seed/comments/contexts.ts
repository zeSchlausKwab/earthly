import type { CommentTarget } from "../types";
import type { SeedCommentSpec } from "./shared";
import {
	createCheckpointGeometry,
	createCoverageGeometry,
	createMediaRichText,
	createObservationGeometry,
	createRouteGeometry,
} from "./shared";

export function buildContextCommentThreads(
	target: CommentTarget,
	seedIndex: number,
): SeedCommentSpec[] {
	return [
		{
			text: createMediaRichText(target, "Context note", seedIndex, [
				"This seeded comment documents a temporary taxonomy or validation observation tied to the context, not a permanent context rule.",
				"The attached annotation gives context pages the same richer comment geometry behavior as datasets and collections.",
			]),
			geojson: createObservationGeometry(target, seedIndex + 6),
			replies: [
				{
					text: `Reply on ${target.name}: moderators flagged this as a non-canonical field note that should stay in discussion space only.`,
				},
				{
					text: `Reply on ${target.name}: a checkpoint label was added to show reply-level annotations on contexts as well.`,
					geojson: createCheckpointGeometry(target, seedIndex + 6),
				},
			],
		},
		{
			text: createMediaRichText(target, "Validation envelope note", seedIndex + 1, [
				"This seeded polygon marks an approximate area where contributors discussed context fit or taxonomy drift.",
				"It is intentionally soft and conversational, which makes it a good example for comment annotations.",
			]),
			geojson: createCoverageGeometry(target, seedIndex + 7),
			replies: [
				{
					text: `Reply on ${target.name}: a temporary route was attached to indicate how someone inspected the boundary in the field.`,
					geojson: createRouteGeometry(target, seedIndex + 7),
				},
				{
					text: createMediaRichText(target, "Context evidence note", seedIndex + 2, [
						"This nested note exists to seed extra links, an image URL, and a video URL on context discussions.",
					]),
				},
			],
		},
	];
}
