import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const inspectSurfaceTask: AiTaskMetadata = {
	id: 'diagnostics.inspect-surface',
	summary:
		'Inventory the visible UI for layout, naming, hierarchy, target-size, and text-size risks.',
	preconditions: ['Earthly is open', 'The surface under review is visible and stable'],
	sideEffects: ['None; reads the rendered DOM only'],
	viewports: 'both',
}

export interface SurfaceElementFinding {
	name: string
	tag: string
	role: string | null
	width: number
	height: number
	x: number
	y: number
}

export interface SurfaceAudit {
	url: string
	viewport: { width: number; height: number }
	documentOverflowX: number
	headings: Array<{ level: number; text: string }>
	unnamedControls: SurfaceElementFinding[]
	undersizedControls: SurfaceElementFinding[]
	clippedControls: SurfaceElementFinding[]
	tinyText: SurfaceElementFinding[]
	visibleControlCount: number
}

export async function inspectSurface(earthly: EarthlySession): Promise<SurfaceAudit> {
	return earthly.page.evaluate(() => {
		const viewport = { width: window.innerWidth, height: window.innerHeight }
		const visible = (element: Element) => {
			const node = element as HTMLElement
			const style = getComputedStyle(node)
			const rect = node.getBoundingClientRect()
			return (
				style.display !== 'none' &&
				style.visibility !== 'hidden' &&
				Number(style.opacity) > 0 &&
				rect.width > 0 &&
				rect.height > 0 &&
				rect.right > 0 &&
				rect.left < viewport.width &&
				rect.bottom > 0 &&
				rect.top < viewport.height
			)
		}
		const textName = (element: Element) => {
			const node = element as HTMLElement
			const labelledBy = node.getAttribute('aria-labelledby')
			const labelledText = labelledBy
				?.split(/\s+/)
				.map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
				.filter(Boolean)
				.join(' ')
			const inputLabel =
				node instanceof HTMLInputElement ||
				node instanceof HTMLTextAreaElement ||
				node instanceof HTMLSelectElement
					? node.labels?.[0]?.textContent?.trim()
					: ''
			return (
				node.getAttribute('aria-label')?.trim() ||
				labelledText ||
				inputLabel ||
				node.getAttribute('title')?.trim() ||
				node.textContent?.replace(/\s+/g, ' ').trim() ||
				node.getAttribute('placeholder')?.trim() ||
				''
			)
		}
		const describe = (element: Element): SurfaceElementFinding => {
			const node = element as HTMLElement
			const rect = node.getBoundingClientRect()
			return {
				name: textName(element).slice(0, 120),
				tag: node.tagName.toLowerCase(),
				role: node.getAttribute('role'),
				width: Math.round(rect.width),
				height: Math.round(rect.height),
				x: Math.round(rect.x),
				y: Math.round(rect.y),
			}
		}
		const controls = Array.from(
			document.querySelectorAll(
				'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="menuitem"], [tabindex]:not([tabindex="-1"])',
			),
		).filter(visible)
		const minimumTarget = viewport.width < 768 ? 44 : 32
		const documentOverflowX = Math.max(
			0,
			Math.round(document.documentElement.scrollWidth - viewport.width),
		)

		return {
			url: window.location.href,
			viewport,
			documentOverflowX,
			headings: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
				.filter(visible)
				.map((heading) => ({
					level: Number(heading.tagName.slice(1)),
					text: heading.textContent?.replace(/\s+/g, ' ').trim() ?? '',
				})),
			unnamedControls: controls.filter((element) => !textName(element)).map(describe),
			undersizedControls: controls
				.filter((element) => {
					const rect = element.getBoundingClientRect()
					return rect.width < minimumTarget || rect.height < minimumTarget
				})
				.map(describe),
			clippedControls: controls
				.filter((element) => {
					const rect = element.getBoundingClientRect()
					return (
						rect.left < -1 ||
						rect.right > viewport.width + 1 ||
						rect.top < -1 ||
						rect.bottom > viewport.height + 1
					)
				})
				.map(describe),
			tinyText: Array.from(document.querySelectorAll('body *'))
				.filter(visible)
				.filter((element) => {
					const node = element as HTMLElement
					return (
						(element.children.length === 0 || node.matches('button, a, label, p, span')) &&
						Boolean(node.textContent?.trim()) &&
						Number.parseFloat(getComputedStyle(node).fontSize) < 11
					)
				})
				.map(describe),
			visibleControlCount: controls.length,
		}
	})
}
