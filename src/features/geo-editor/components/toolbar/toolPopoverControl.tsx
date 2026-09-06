import { useMemo, useRef, useState, type RefObject } from 'react'
import { PopoverAnchor } from '@/components/ui/popover'

/** Launch an existing tool from overflow without remounting its work in progress. */
export interface ToolPopoverControl {
	open: boolean
	onOpenChange: (open: boolean) => void
	anchorRef: RefObject<HTMLButtonElement | null>
}

export function ToolPopoverAnchor({ anchorRef }: Pick<ToolPopoverControl, 'anchorRef'>) {
	const virtualRef = useMemo(
		() => ({
			current: {
				getBoundingClientRect: () => anchorRef.current?.getBoundingClientRect() ?? new DOMRect(),
			},
		}),
		[anchorRef],
	)
	return <PopoverAnchor virtualRef={virtualRef} />
}

export function useToolPopoverControl(control?: ToolPopoverControl) {
	const [open, setOpen] = useState(false)
	return [control?.open ?? open, control?.onOpenChange ?? setOpen] as const
}

export function useToolPopoverFocusProps(control?: ToolPopoverControl) {
	const interactedOutside = useRef(false)
	return control
		? {
				onOpenAutoFocus: () => {
					interactedOutside.current = false
				},
				onInteractOutside: () => {
					interactedOutside.current = true
				},
				onCloseAutoFocus: (event: Event) => {
					event.preventDefault()
					// Escape returns to More; a pointer click should keep its new focus.
					if (!interactedOutside.current) control.anchorRef.current?.focus()
				},
			}
		: {}
}
