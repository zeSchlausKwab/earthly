import { Search, X } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '../ui/input'

interface EntitySearchInputProps
	extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
	value: string
	onChange: (value: string) => void
	compact?: boolean
	inputClassName?: string
}

export const EntitySearchInput = forwardRef<HTMLInputElement, EntitySearchInputProps>(
	(
		{ value, onChange, compact, className, inputClassName, placeholder = 'Search…', ...props },
		ref,
	) => {
		return (
			<div className={cn('relative flex items-center', className)}>
				<Search
					className={cn(
						'absolute left-2 text-muted-foreground pointer-events-none',
						compact ? 'h-3 w-3' : 'h-3.5 w-3.5',
					)}
				/>
				<Input
					ref={ref}
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					{...props}
				/>
				{value && (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						onClick={() => onChange('')}
						className={cn('absolute right-1.5', compact ? 'size-3.5' : 'size-4')}
					>
						<X className="h-full w-full" />
					</Button>
				)}
			</div>
		)
	},
)
