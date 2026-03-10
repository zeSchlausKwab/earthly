import { Search, X } from 'lucide-react'
import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

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
				<input
					ref={ref}
					type="text"
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					className={cn(
						'w-full rounded-md border border-input bg-background ring-offset-background',
						'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
						compact ? 'h-7 pl-7 pr-7 text-xs' : 'h-8 pl-8 pr-8 text-sm',
						inputClassName,
					)}
					{...props}
				/>
				{value && (
					<button
						type="button"
						onClick={() => onChange('')}
						className={cn(
							'absolute right-1.5 text-muted-foreground hover:text-foreground',
							compact ? 'h-3.5 w-3.5' : 'h-4 w-4',
						)}
					>
						<X className="h-full w-full" />
					</button>
				)}
			</div>
		)
	},
)
