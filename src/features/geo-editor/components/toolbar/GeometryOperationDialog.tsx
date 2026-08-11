import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { executeEditorCommand } from '../../commands'
import {
	getDerivedGeometryOperationChoice,
	type NumericGeometryOperation,
} from '../../geometryOperationCatalog'

export type { NumericGeometryOperation } from '../../geometryOperationCatalog'

export interface GeometryOperationDialogProps {
	operation: NumericGeometryOperation | null
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function GeometryOperationDialog({
	operation,
	open,
	onOpenChange,
}: GeometryOperationDialogProps) {
	const [distance, setDistance] = useState('10')
	const [units, setUnits] = useState<'meters' | 'kilometers' | 'miles'>('meters')
	const [direction, setDirection] = useState<'outward' | 'inward' | 'left' | 'right'>('outward')
	const [resultMode, setResultMode] = useState<'copy' | 'replace'>('copy')
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!open || !operation) return
		setDistance(operation === 'corridor' ? '20' : '10')
		setDirection(operation === 'offset-line' ? 'left' : 'outward')
		setResultMode('copy')
		setError(null)
	}, [open, operation])

	if (!operation) return null
	const copy = getDerivedGeometryOperationChoice(operation)
	const handleApply = () => {
		const parsed = Number(distance)
		if (!Number.isFinite(parsed) || parsed <= 0) {
			setError('Enter a positive distance.')
			return
		}
		const result = executeEditorCommand('apply_geometry_operation', {
			kind: operation,
			distance: parsed,
			units,
			direction,
			resultMode,
		})
		if (!result.ok) {
			setError(result.message)
			return
		}
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{copy.title}</DialogTitle>
					<DialogDescription>{copy.description}</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 py-2">
					<div className="grid grid-cols-[1fr_9rem] gap-2">
						<div className="grid gap-1.5">
							<Label htmlFor="geometry-operation-distance">{copy.distanceLabel}</Label>
							<Input
								id="geometry-operation-distance"
								type="number"
								min="0"
								step="any"
								value={distance}
								onChange={(event) => setDistance(event.target.value)}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label>Units</Label>
							<Select value={units} onValueChange={(value) => setUnits(value as typeof units)}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="meters">Meters</SelectItem>
									<SelectItem value="kilometers">Kilometers</SelectItem>
									<SelectItem value="miles">Miles</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
					{operation !== 'corridor' ? (
						<div className="grid gap-1.5">
							<Label>{operation === 'offset-polygon' ? 'Direction' : 'Side'}</Label>
							<Select
								value={direction}
								onValueChange={(value) => setDirection(value as typeof direction)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{operation === 'offset-polygon' ? (
										<>
											<SelectItem value="outward">Expand outward</SelectItem>
											<SelectItem value="inward">Inset inward</SelectItem>
										</>
									) : (
										<>
											<SelectItem value="left">Left of line direction</SelectItem>
											<SelectItem value="right">Right of line direction</SelectItem>
										</>
									)}
								</SelectContent>
							</Select>
						</div>
					) : null}
					<div className="grid gap-1.5">
						<Label>Result</Label>
						<Select
							value={resultMode}
							onValueChange={(value) => setResultMode(value as typeof resultMode)}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="copy">Create derived copy</SelectItem>
								<SelectItem value="replace">Replace selected feature</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{error ? <p className="text-sm text-destructive">{error}</p> : null}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleApply}>Apply</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
