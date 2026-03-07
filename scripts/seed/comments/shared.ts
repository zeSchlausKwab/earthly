import type { Feature, FeatureCollection, Position } from "geojson";
import type { BoundingBox, CommentTarget } from "../types";

export interface SeedCommentReplySpec {
	text: string;
	geojson?: FeatureCollection;
}

export interface SeedCommentSpec {
	text: string;
	geojson?: FeatureCollection;
	replies: SeedCommentReplySpec[];
}

const COMMENT_MEDIA_LIBRARY = [
	{
		image:
			"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/640px-Example.jpg",
		video: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
		external: "https://earthly.local/field-notes/community",
	},
	{
		image:
			"https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fronalpstock_big.jpg/640px-Fronalpstock_big.jpg",
		video: "https://www.youtube.com/watch?v=ScMzIvxBSi4",
		external: "https://earthly.local/field-notes/monitoring",
	},
	{
		image:
			"https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Windows_Settings_app_icon.png/512px-Windows_Settings_app_icon.png",
		video: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
		external: "https://earthly.local/field-notes/ops",
	},
	{
		image:
			"https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Alberta_Banff_National_Park_Sunshine_Meadows.jpg/640px-Alberta_Banff_National_Park_Sunshine_Meadows.jpg",
		video: "https://www.youtube.com/watch?v=rUWxSEwctFU",
		external: "https://earthly.local/field-notes/safety",
	},
] as const;

export function bboxCenterPoint(bbox?: BoundingBox): Position {
	if (!bbox) return [13.405, 52.52];
	return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

export function offsetPoint(point: Position, lonOffset: number, latOffset: number): Position {
	const [lon = 13.405, lat = 52.52] = point;
	return [lon + lonOffset, lat + latOffset];
}

export function closeRing(points: Position[]): Position[] {
	const first = points[0];
	const last = points[points.length - 1];
	if (!first || !last) return points;
	if (first[0] === last[0] && first[1] === last[1]) return points;
	return [...points, first];
}

export function featureCollection(features: Feature[]): FeatureCollection {
	return {
		type: "FeatureCollection",
		features,
	};
}

export function createAnnotationFeature(options: {
	id: string;
	label: string;
	text: string;
	position: Position;
	description: string;
	textColor?: string;
}): Feature {
	const { id, label, text, position, description, textColor = "#92400e" } = options;
	return {
		type: "Feature",
		id,
		properties: {
			featureType: "annotation",
			name: label,
			text,
			description,
			textColor,
			textHaloColor: "#fff8db",
			textHaloWidth: 1.5,
		},
		geometry: {
			type: "Point",
			coordinates: position,
		},
	};
}

export function createMarkerFeature(options: {
	id: string;
	label: string;
	position: Position;
	description: string;
	color?: string;
}): Feature {
	const { id, label, position, description, color = "#f59e0b" } = options;
	return {
		type: "Feature",
		id,
		properties: {
			name: label,
			description,
			color,
			stroke: "#ffffff",
			strokeWidth: 2,
		},
		geometry: {
			type: "Point",
			coordinates: position,
		},
	};
}

export function createLineFeature(options: {
	id: string;
	label: string;
	coordinates: Position[];
	description: string;
	stroke?: string;
	lineDasharray?: number[];
}): Feature {
	const {
		id,
		label,
		coordinates,
		description,
		stroke = "#d97706",
		lineDasharray = [2, 2],
	} = options;
	return {
		type: "Feature",
		id,
		properties: {
			name: label,
			description,
			stroke,
			color: stroke,
			strokeWidth: 2,
			lineDasharray,
		},
		geometry: {
			type: "LineString",
			coordinates,
		},
	};
}

export function createPolygonFeature(options: {
	id: string;
	label: string;
	coordinates: Position[];
	description: string;
	fill?: string;
	stroke?: string;
	fillOpacity?: number;
}): Feature {
	const {
		id,
		label,
		coordinates,
		description,
		fill = "#fbbf24",
		stroke = "#d97706",
		fillOpacity = 0.18,
	} = options;
	return {
		type: "Feature",
		id,
		properties: {
			name: label,
			description,
			fill,
			stroke,
			fillOpacity,
			strokeWidth: 2,
		},
		geometry: {
			type: "Polygon",
			coordinates: [closeRing(coordinates)],
		},
	};
}

export function createObservationGeometry(
	target: CommentTarget,
	seedIndex: number,
): FeatureCollection {
	const center = bboxCenterPoint(target.bbox);
	const lead = offsetPoint(center, 0.006 + seedIndex * 0.0007, 0.0035 + seedIndex * 0.0005);
	return featureCollection([
		createAnnotationFeature({
			id: `obs-label-${target.dTag}-${seedIndex}`,
			label: `${target.name} observation`,
			text: `Observation ${seedIndex + 1}`,
			position: center,
			description: `Seeded field observation attached to ${target.name}.`,
		}),
		createLineFeature({
			id: `obs-line-${target.dTag}-${seedIndex}`,
			label: `${target.name} callout`,
			coordinates: [center, lead],
			description: `Callout line for a non-canonical discussion note on ${target.name}.`,
		}),
		createMarkerFeature({
			id: `obs-point-${target.dTag}-${seedIndex}`,
			label: `${target.name} note anchor`,
			position: lead,
			description: `A temporary marker used in the seeded comment thread for ${target.name}.`,
		}),
	]);
}

export function createCoverageGeometry(
	target: CommentTarget,
	seedIndex: number,
): FeatureCollection {
	const center = bboxCenterPoint(target.bbox);
	const west = offsetPoint(center, -0.01 - seedIndex * 0.0004, -0.0045);
	const east = offsetPoint(center, 0.01 + seedIndex * 0.0004, -0.0035);
	const northEast = offsetPoint(center, 0.009 + seedIndex * 0.0003, 0.0065);
	const northWest = offsetPoint(center, -0.009 - seedIndex * 0.0003, 0.006);

	return featureCollection([
		createPolygonFeature({
			id: `coverage-area-${target.dTag}-${seedIndex}`,
			label: `${target.name} review area`,
			coordinates: [west, east, northEast, northWest],
			description: `Approximate seeded review area associated with ${target.name}.`,
			fill: "#fde68a",
			stroke: "#ca8a04",
			fillOpacity: 0.22,
		}),
		createAnnotationFeature({
			id: `coverage-label-${target.dTag}-${seedIndex}`,
			label: `${target.name} review label`,
			text: `Needs review`,
			position: offsetPoint(center, 0, 0.0075),
			description: `Seeded label annotation for the highlighted review area on ${target.name}.`,
			textColor: "#a16207",
		}),
	]);
}

export function createRouteGeometry(
	target: CommentTarget,
	seedIndex: number,
): FeatureCollection {
	const center = bboxCenterPoint(target.bbox);
	const start = offsetPoint(center, -0.009 - seedIndex * 0.0005, -0.003);
	const mid = offsetPoint(center, -0.001, 0.0025 + seedIndex * 0.0004);
	const end = offsetPoint(center, 0.011 + seedIndex * 0.0005, 0.005);
	return featureCollection([
		createLineFeature({
			id: `route-line-${target.dTag}-${seedIndex}`,
			label: `${target.name} route note`,
			coordinates: [start, mid, end],
			description: `Seeded temporary route geometry attached to the comment for ${target.name}.`,
			stroke: "#b45309",
			lineDasharray: [1.5, 1.5],
		}),
		createMarkerFeature({
			id: `route-start-${target.dTag}-${seedIndex}`,
			label: `${target.name} staging`,
			position: start,
			description: `Suggested staging point discussed in seeded comments for ${target.name}.`,
			color: "#f97316",
		}),
		createAnnotationFeature({
			id: `route-end-label-${target.dTag}-${seedIndex}`,
			label: `${target.name} end label`,
			text: `Check this leg`,
			position: end,
			description: `Seeded label marking the end of a temporary route discussion for ${target.name}.`,
			textColor: "#9a3412",
		}),
	]);
}

export function createCheckpointGeometry(
	target: CommentTarget,
	seedIndex: number,
): FeatureCollection {
	const center = bboxCenterPoint(target.bbox);
	const checkpoint = offsetPoint(center, 0.003 + seedIndex * 0.0005, -0.005 - seedIndex * 0.0003);
	return featureCollection([
		createMarkerFeature({
			id: `checkpoint-point-${target.dTag}-${seedIndex}`,
			label: `${target.name} checkpoint`,
			position: checkpoint,
			description: `Temporary checkpoint geometry discussed in reply threads for ${target.name}.`,
			color: "#d97706",
		}),
		createAnnotationFeature({
			id: `checkpoint-label-${target.dTag}-${seedIndex}`,
			label: `${target.name} checkpoint label`,
			text: `Follow-up`,
			position: offsetPoint(checkpoint, 0.002, 0.0022),
			description: `Seeded reply annotation connected to ${target.name}.`,
		}),
	]);
}

export function createMediaRichText(
	target: CommentTarget,
	lead: string,
	seedIndex: number,
	extraParagraphs: string[],
): string {
	const media =
		COMMENT_MEDIA_LIBRARY[seedIndex % COMMENT_MEDIA_LIBRARY.length] ?? COMMENT_MEDIA_LIBRARY[0];

	return [
		`${lead} for ${target.name}.`,
		...extraParagraphs,
		`Image: ${media?.image ?? ""}`,
		`Video: ${media?.video ?? ""}`,
		`Reference: ${media?.external ?? ""}`,
	].join("\n\n");
}
