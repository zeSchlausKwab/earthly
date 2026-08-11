import {
	BetweenHorizontalStart,
	Combine,
	GitFork,
	Link2,
	Merge,
	Minus,
	MousePointer2,
	MoveHorizontal,
	Route,
	Scissors,
	Split as SplitIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { GeometryInteractionKind } from '../../core/types'
import {
	canUseGeometryOperationTarget,
	derivedGeometryOperationChoices,
	splitGeometryOperationChoices,
	type GeometryOperationIcon,
	type NumericGeometryOperation,
} from '../../geometryOperationCatalog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface GeometryOpsDropdownProps {
	disabled?: boolean
	onMerge: () => void
	onSplit: () => void
	onConnect: () => void
	onDissolve: () => void
	onSimplify: () => void
	onUnion: () => void
	onDifference: () => void
	canMerge?: boolean
	canSplit?: boolean
	canConnect?: boolean
	canDissolve?: boolean
	canSimplify?: boolean
	canBooleanOps?: boolean
	booleanOpActive?: { type: 'union' | 'difference' }
	onStartGeometryOperation: (kind: GeometryInteractionKind) => void
	onOpenNumericGeometryOperation: (operation: NumericGeometryOperation) => void
	canOperateOnLine?: boolean
	canOperateOnPolygon?: boolean
	small?: boolean
}

export function GeometryOpsDropdown({
	disabled,
	onMerge,
	onSplit,
	onConnect,
	onDissolve,
	onSimplify,
	onUnion,
	onDifference,
	canMerge,
	canSplit,
	canConnect,
	canDissolve,
	canSimplify,
	canBooleanOps,
	booleanOpActive,
	onStartGeometryOperation,
	onOpenNumericGeometryOperation,
	canOperateOnLine,
	canOperateOnPolygon,
	small,
}: GeometryOpsDropdownProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'
	const operationIcons: Record<GeometryOperationIcon, typeof Scissors> = {
		split: Scissors,
		branch: GitFork,
		'polygon-offset': BetweenHorizontalStart,
		parallel: MoveHorizontal,
		corridor: Route,
	}

	return (
		<TooltipProvider delayDuration={500}>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant={booleanOpActive ? 'default' : 'outline'}
								size="icon"
								className={buttonSize}
								disabled={disabled}
								aria-label="Geometry operations"
							>
								<Combine className={iconSize} />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Geometry operations</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="start">
					<DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
						Multi / Structure
					</DropdownMenuLabel>
					<DropdownMenuItem onClick={onMerge} disabled={!canMerge}>
						<Merge className="h-4 w-4" />
						Merge to Multi
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onSplit} disabled={!canSplit}>
						<SplitIcon className="h-4 w-4" />
						Explode Multipart
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onSimplify} disabled={!canSimplify}>
						<Route className="h-4 w-4" />
						Simplify Selection
					</DropdownMenuItem>
					{(canConnect || canDissolve) && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
								Lines
							</DropdownMenuLabel>
							<DropdownMenuItem onClick={onConnect} disabled={!canConnect}>
								<Link2 className="h-4 w-4" />
								Connect Lines
							</DropdownMenuItem>
							<DropdownMenuItem onClick={onDissolve} disabled={!canDissolve}>
								<Combine className="h-4 w-4" />
								Dissolve Lines
							</DropdownMenuItem>
						</>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<Scissors className="h-4 w-4" />
							Cut / Split
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-64">
							{splitGeometryOperationChoices.map((choice) => {
								const OperationIcon = operationIcons[choice.icon]
								return (
									<DropdownMenuItem
										key={choice.kind}
										disabled={
											!canUseGeometryOperationTarget(
												choice.target,
												canOperateOnLine,
												canOperateOnPolygon,
											)
										}
										onSelect={() => onStartGeometryOperation(choice.kind)}
									>
										<OperationIcon className="h-4 w-4" />
										<span className="flex flex-col">
											<span>{choice.label}</span>
											<span className="text-[10px] text-muted-foreground">{choice.typeFlow}</span>
										</span>
									</DropdownMenuItem>
								)
							})}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger>
							<MoveHorizontal className="h-4 w-4" />
							Offset / Corridor
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-64">
							{derivedGeometryOperationChoices.map((choice) => {
								const OperationIcon = operationIcons[choice.icon]
								return (
									<DropdownMenuSub key={choice.numericKind}>
										<DropdownMenuSubTrigger
											disabled={
												!canUseGeometryOperationTarget(
													choice.target,
													canOperateOnLine,
													canOperateOnPolygon,
												)
											}
										>
											<OperationIcon className="h-4 w-4" />
											{choice.typeFlow}
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent>
											<DropdownMenuItem
												onSelect={() => onOpenNumericGeometryOperation(choice.numericKind)}
											>
												{choice.numericMenuLabel}
											</DropdownMenuItem>
											<DropdownMenuItem onSelect={() => onStartGeometryOperation(choice.dragKind)}>
												<MousePointer2 className="h-4 w-4" /> Drag on map
											</DropdownMenuItem>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								)
							})}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					<DropdownMenuSeparator />
					<DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
						Boolean
					</DropdownMenuLabel>
					<DropdownMenuItem onClick={onUnion} disabled={!canBooleanOps}>
						<Combine className="h-4 w-4" />
						Boolean Union
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onDifference} disabled={!canBooleanOps}>
						<Minus className="h-4 w-4" />
						Boolean Difference
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}
