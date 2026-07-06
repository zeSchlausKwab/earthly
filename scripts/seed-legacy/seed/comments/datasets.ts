import type { CommentTarget } from "../types";
import type { SeedCommentSpec } from "./shared";
import {
	createCheckpointGeometry,
	createCoverageGeometry,
	createMediaRichText,
	createObservationGeometry,
	createRouteGeometry,
} from "./shared";

export function buildDatasetCommentThreads(
	target: CommentTarget,
	seedIndex: number,
): SeedCommentSpec[] {
	return [
		{
			text: createMediaRichText(target, "Field note", seedIndex, [
				"This seeded comment treats the attached geometry as discussion-only, not canonical dataset content.",
				"A label, a callout, and a marker are attached so popups and hover states have richer examples.",
			]),
			geojson: createObservationGeometry(target, seedIndex),
			replies: [
				{
					text: `Reply on ${target.name}: reviewers agreed this observation should stay visible by default until the underlying condition is verified on site.`,
					geojson: createCheckpointGeometry(target, seedIndex),
				},
				{
					text: createMediaRichText(target, "Follow-up media note", seedIndex + 1, [
						"The linked media in this reply is there to exercise the rich comment renderer inside nested threads.",
					]),
				},
			],
		},
		{
			text: createMediaRichText(target, "Coverage gap note", seedIndex + 1, [
				"This seeded comment marks an approximate review area around the dataset where contributors thought the geometry could use another pass.",
				"The attached label should render as an annotation, while the polygon stays visually weaker than canonical geometry.",
			]),
			geojson: createCoverageGeometry(target, seedIndex + 1),
			replies: [
				{
					text: `Reply on ${target.name}: this area is intentionally rough and should be treated as a conversational envelope rather than a proposed edit.`,
				},
				{
					text: `Route suggestion for ${target.name}: a temporary path was added to show that lines and labels can live inside comment geometry too.`,
					geojson: createRouteGeometry(target, seedIndex + 2),
				},
			],
		},
	];
}
