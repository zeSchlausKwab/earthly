import { Combine, Link2, Merge, Minus, Route, Split as SplitIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
	small,
}: GeometryOpsDropdownProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'

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
						Split Multi
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
