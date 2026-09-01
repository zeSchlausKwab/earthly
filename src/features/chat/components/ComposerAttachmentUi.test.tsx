import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FileChip, type AttachedFileView } from './FileChip'
import { VisionGateControl } from './VisionGateControl'

function visibleText(html: string): string {
	return html.replace(/<[^>]+>/g, '')
}

function renderVisionGate(props: React.ComponentProps<typeof VisionGateControl>): string {
	return renderToStaticMarkup(
		<TooltipProvider>
			<VisionGateControl {...props} />
		</TooltipProvider>,
	)
}

describe('compact composer attachment UI', () => {
	test('an image chip renders its filename only once in visible text', () => {
		const file: AttachedFileView = {
			id: 'image-1',
			fileName: 'signal-map.png',
			status: 'image',
			imageUrl: 'data:image/png;base64,AA==',
			visionTier: 'vision',
		}

		const text = visibleText(renderToStaticMarkup(<FileChip file={file} onRemove={() => {}} />))
		expect(text.match(/signal-map\.png/g)).toHaveLength(1)
	})

	test('unsupported vision state stays visible and has a model-specific accessible label', () => {
		const html = renderVisionGate({
			support: 'no-vision',
			modelLabel: 'Text model',
			hasImage: true,
			sendAnyway: false,
			onSendAnywayChange: () => {},
		})

		expect(html).toContain('<button')
		expect(html).toContain('type="button"')
		expect(html).toContain('aria-label="Text model does not support image input"')
		expect(visibleText(html)).toContain('No vision')
	})

	test('uncertain vision state exposes its opt-in as a pressed toggle', () => {
		const off = renderVisionGate({
			support: 'uncertain',
			modelLabel: 'Unknown model',
			hasImage: true,
			sendAnyway: false,
			onSendAnywayChange: () => {},
		})
		const on = renderVisionGate({
			support: 'uncertain',
			modelLabel: 'Unknown model',
			hasImage: true,
			sendAnyway: true,
			onSendAnywayChange: () => {},
		})

		expect(off).toContain('aria-pressed="false"')
		expect(off).toContain('Allow image')
		expect(on).toContain('aria-pressed="true"')
		expect(on).toContain('Image allowed')
	})
})
