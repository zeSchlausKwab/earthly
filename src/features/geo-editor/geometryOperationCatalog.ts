import type { GeometryInteractionKind } from './core/types'

export type NumericGeometryOperation = 'offset-polygon' | 'offset-line' | 'corridor'
export type GeometryOperationTarget = 'line' | 'polygon'
export type GeometryOperationIcon = 'split' | 'branch' | 'polygon-offset' | 'parallel' | 'corridor'

export interface SplitGeometryOperationChoice {
	kind: GeometryInteractionKind
	label: string
	typeFlow: string
	target: GeometryOperationTarget
	icon: GeometryOperationIcon
}

export interface DerivedGeometryOperationChoice {
	numericKind: NumericGeometryOperation
	dragKind: GeometryInteractionKind
	typeFlow: string
	target: GeometryOperationTarget
	icon: GeometryOperationIcon
	numericMenuLabel: string
	title: string
	description: string
	distanceLabel: string
}

/** One semantic catalog shared by compact, expanded, and mobile menu adapters. */
export const splitGeometryOperationChoices: readonly SplitGeometryOperationChoice[] = [
	{
		kind: 'split-polygon-line',
		label: 'Polygon by drawn line',
		typeFlow: 'Polygon → Polygons',
		target: 'polygon',
		icon: 'split',
	},
	{
		kind: 'split-line-point',
		label: 'Line at placed point',
		typeFlow: 'Line → Lines',
		target: 'line',
		icon: 'branch',
	},
	{
		kind: 'split-line-line',
		label: 'Line by drawn line',
		typeFlow: 'Line → Lines',
		target: 'line',
		icon: 'split',
	},
]

export const derivedGeometryOperationChoices: readonly DerivedGeometryOperationChoice[] = [
	{
		numericKind: 'offset-polygon',
		dragKind: 'offset-polygon-drag',
		typeFlow: 'Polygon → Polygon',
		target: 'polygon',
		icon: 'polygon-offset',
		numericMenuLabel: 'Enter distance…',
		title: 'Offset polygon by distance',
		description: 'Create an expanded or inset polygon from the selected polygon.',
		distanceLabel: 'Offset distance',
	},
	{
		numericKind: 'offset-line',
		dragKind: 'offset-line-drag',
		typeFlow: 'Line → Parallel line',
		target: 'line',
		icon: 'parallel',
		numericMenuLabel: 'Enter distance…',
		title: 'Create parallel line',
		description: 'Create a left or right parallel copy from the selected line.',
		distanceLabel: 'Perpendicular distance',
	},
	{
		numericKind: 'corridor',
		dragKind: 'corridor-drag',
		typeFlow: 'Line → Corridor polygon',
		target: 'line',
		icon: 'corridor',
		numericMenuLabel: 'Enter total width…',
		title: 'Create line corridor',
		description: 'Create a symmetric polygon around the selected centerline.',
		distanceLabel: 'Total corridor width',
	},
]

export function getDerivedGeometryOperationChoice(
	operation: NumericGeometryOperation,
): DerivedGeometryOperationChoice {
	const choice = derivedGeometryOperationChoices.find(
		(candidate) => candidate.numericKind === operation,
	)
	if (!choice) throw new Error(`Unknown geometry operation '${operation}'.`)
	return choice
}

export function canUseGeometryOperationTarget(
	target: GeometryOperationTarget,
	canOperateOnLine: boolean | undefined,
	canOperateOnPolygon: boolean | undefined,
): boolean {
	return target === 'line' ? Boolean(canOperateOnLine) : Boolean(canOperateOnPolygon)
}
