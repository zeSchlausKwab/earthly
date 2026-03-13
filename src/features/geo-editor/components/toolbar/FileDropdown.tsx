import { ChevronDown, Download, FileUp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface FileDropdownProps {
	onImportClick: () => void
	onExportGeoJSON: () => void
	onExportSHP: () => void
	canExport?: boolean
	disabled?: boolean
	small?: boolean
}

export function FileDropdown({
	onImportClick,
	onExportGeoJSON,
	onExportSHP,
	canExport,
	disabled,
	small,
}: FileDropdownProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8' : 'h-9'

	return (
		<TooltipProvider delayDuration={500}>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								className={`${buttonSize} gap-1 px-2`}
								disabled={disabled}
							>
								<FileUp className={iconSize} />
								<ChevronDown className="h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Import / Export GeoJSON / SHP</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="start">
					<DropdownMenuItem onClick={onImportClick}>
						<Upload className="h-4 w-4" />
						Import GeoJSON / SHP
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onExportGeoJSON} disabled={!canExport}>
						<Download className="h-4 w-4" />
						Export GeoJSON
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onExportSHP} disabled={!canExport}>
						<Download className="h-4 w-4" />
						Export SHP
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}
