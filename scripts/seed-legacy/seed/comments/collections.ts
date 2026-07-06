import type { CommentTarget } from "../types";
import type { SeedCommentSpec } from "./shared";
import {
	createCheckpointGeometry,
	createCoverageGeometry,
	createMediaRichText,
	createObservationGeometry,
	createRouteGeometry,
} from "./shared";

export function buildCollectionCommentThreads(
	target: CommentTarget,
	seedIndex: number,
): SeedCommentSpec[] {
	return [
		{
			text: createMediaRichText(target, "Curation note", seedIndex, [
				"This seeded comment explains why a temporary annotation can sit on a collection without becoming part of the collection definition itself.",
				"It also gives the social toolbar, share route, and popup renderer something non-trivial to show.",
			]),
			geojson: createObservationGeometry(target, seedIndex + 3),
			replies: [
				{
					text: `Reply on ${target.name}: curators confirmed the attached label is a thread-local note and should disappear if the comment is hidden.`,
				},
				{
					text: `Reply on ${target.name}: an extra checkpoint was attached here to seed nested comment geometry on collections.`,
					geojson: createCheckpointGeometry(target, seedIndex + 3),
				},
			],
		},
		{
			text: createMediaRichText(target, "Cross-collection coverage note", seedIndex + 2, [
				"This seeded polygon highlights a fuzzy area where linked datasets may overlap or leave gaps.",
				"Users can inspect it as a weaker annotation rather than mistaking it for curated collection geometry.",
			]),
			geojson: createCoverageGeometry(target, seedIndex + 4),
			replies: [
				{
					text: `Reply on ${target.name}: one contributor sketched a temporary route through the highlighted area so others know what to inspect next.`,
					geojson: createRouteGeometry(target, seedIndex + 4),
				},
				{
					text: createMediaRichText(target, "Reference drop", seedIndex + 3, [
						"This reply adds another image and video URL to strengthen seeded media coverage on collection discussions.",
					]),
				},
			],
		},
	];
}
