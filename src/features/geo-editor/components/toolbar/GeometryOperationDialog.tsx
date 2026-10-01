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
	const [endWidth, setEndWidth] = useState('20')
	const [side, setSide] = useState<'center' | 'left' | 'right'>('center')
	const [arrowHeadLength, setArrowHeadLength] = useState('')
	const [arrowHeadWidth, setArrowHeadWidth] = useState('')
	const [units, setUnits] = useState<'meters' | 'kilometers' | 'miles'>('meters')
	const [direction, setDirection] = useState<'outward' | 'inward' | 'left' | 'right'>('outward')
	const [resultMode, setResultMode] = useState<'copy' | 'replace'>('copy')
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!open || !operation) return
		setDistance(
			operation === 'corridor' || operation === 'fat-line' || operation === 'fat-arrow'
				? '20'
				: '10',
		)
		setEndWidth('20')
		setSide('center')
		setArrowHeadLength('')
		setArrowHeadWidth('')
		setUnits('meters')
		setDirection(operation === 'offset-line' ? 'left' : 'outward')
		setResultMode('copy')
		setError(null)
	}, [open, operation])

	if (!operation) return null
	const copy = getDerivedGeometryOperationChoice(operation)
	const isBand = operation === 'fat-line' || operation === 'fat-arrow'
	const handleApply = () => {
		const parsed = Number(distance)
		if (!distance.trim() || !Number.isFinite(parsed) || (isBand ? parsed < 0 : parsed <= 0)) {
			setError(isBand ? 'Enter a non-negative start width.' : 'Enter a positive distance.')
			return
		}
		if (
			isBand &&
			(!endWidth.trim() || !Number.isFinite(Number(endWidth)) || Number(endWidth) < 0)
		) {
			setError('Enter a non-negative end width.')
			return
		}
		const result = executeEditorCommand('apply_geometry_operation', {
			kind: operation,
			distance: parsed,
			units,
			direction,
			resultMode,
			...(isBand ? { endWidth: Number(endWidth), side } : {}),
			...(operation === 'fat-arrow' && arrowHeadLength.trim()
				? { arrowHeadLength: Number(arrowHeadLength) }
				: {}),
			...(operation === 'fat-arrow' && arrowHeadWidth.trim()
				? { arrowHeadWidth: Number(arrowHeadWidth) }
				: {}),
		})
		if (!result.ok) {
			setError(result.message)
			return
		}
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md max-h-[85dvh] overflow-y-auto">
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
							<Label htmlFor="geometry-operation-units">Units</Label>
							<Select value={units} onValueChange={(value) => setUnits(value as typeof units)}>
								<SelectTrigger id="geometry-operation-units">
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
					{isBand ? (
						<>
							<div className="grid gap-1.5">
								<Label htmlFor="geometry-operation-end-width">End width</Label>
								<Input
									id="geometry-operation-end-width"
									type="number"
									min="0"
									step="any"
									value={endWidth}
									onChange={(event) => setEndWidth(event.target.value)}
								/>
								<p className="text-xs text-muted-foreground">
									Widths use the units above. Equal widths make a uniform band.
									{operation === 'fat-line'
										? ' Set either width to zero for a pointed taper.'
										: ' The arrowhead reaches the end of the line.'}
								</p>
							</div>
							<div className="grid gap-1.5">
								<Label htmlFor="geometry-operation-side">Extrusion side</Label>
								<Select value={side} onValueChange={(value) => setSide(value as typeof side)}>
									<SelectTrigger id="geometry-operation-side">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="center">Centered on line</SelectItem>
										<SelectItem value="left">Left of line direction</SelectItem>
										<SelectItem value="right">Right of line direction</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{operation === 'fat-arrow' ? (
								<div className="grid grid-cols-2 gap-2">
									<div className="grid gap-1.5">
										<Label htmlFor="geometry-operation-head-length">Arrowhead length</Label>
										<Input
											id="geometry-operation-head-length"
											type="number"
											min="0"
											step="any"
											placeholder="Automatic"
											value={arrowHeadLength}
											onChange={(event) => setArrowHeadLength(event.target.value)}
										/>
									</div>
									<div className="grid gap-1.5">
										<Label htmlFor="geometry-operation-head-width">Arrowhead width</Label>
										<Input
											id="geometry-operation-head-width"
											type="number"
											min="0"
											step="any"
											placeholder="Automatic"
											value={arrowHeadWidth}
											onChange={(event) => setArrowHeadWidth(event.target.value)}
										/>
									</div>
								</div>
							) : null}
						</>
					) : null}
					{operation !== 'corridor' && !isBand ? (
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
						<Label htmlFor="geometry-operation-result">Result</Label>
						<Select
							value={resultMode}
							onValueChange={(value) => setResultMode(value as typeof resultMode)}
						>
							<SelectTrigger id="geometry-operation-result">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="copy">Create derived copy</SelectItem>
								<SelectItem value="replace">Replace selected feature</SelectItem>
							</SelectContent>
						</Select>
					</div>
					{error ? (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : null}
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
