import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useEditorStore, type MapStackEntry } from '@/features/geo-editor/store'
import { MapStackPanel } from './MapStackPanel'
import { TooltipProvider } from './ui/tooltip'

const originalGlobals = new Map(
	['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT'].map(
		(key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
	),
)
const originalState = useEditorStore.getState()
let container: HTMLDivElement
let root: Root

function configuration(instanceId: string, title: string): MapStackEntry {
	return {
		id: `maplet:${instanceId}`,
		entityKey: instanceId,
		entityType: 'maplet',
		title,
		source: 'manual',
		visible: true,
		pinned: false,
		isolated: false,
		exclusions: [],
		addedAt: 0,
	}
}

const territory = configuration('gmaps-territory', 'Territory only')
const events = configuration('gmaps-events', 'Events only')

beforeAll(() => {
	const { window } = parseHTML('<html><body></body></html>')
	Object.assign(globalThis, {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Node: window.Node,
		IS_REACT_ACT_ENVIRONMENT: true,
	})
})
beforeEach(() => {
	useEditorStore.setState({
		mapStackEntries: { [territory.id]: territory, [events.id]: events },
		mapStackOrder: [territory.id, events.id],
	})
	container = document.createElement('div')
	document.body.append(container)
	root = createRoot(container)
})
afterEach(async () => {
	await act(() => root.unmount())
	container.remove()
	useEditorStore.setState(originalState, true)
})
afterAll(() => {
	for (const [key, descriptor] of originalGlobals) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor)
		else Reflect.deleteProperty(globalThis, key)
	}
})

function buttons(label: string) {
	return Array.from(container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`))
}

async function renderPanel(
	callbacks: {
		onInspectMaplet?: (instanceId: string) => void
		onZoomToMaplet?: (instanceId: string) => void
		onSetEntryVisible?: (entry: MapStackEntry, visible: boolean) => void
		onSetEntryIsolated?: (entry: MapStackEntry, isolated: boolean) => void
		onRemoveEntry?: (entry: MapStackEntry) => void
	} = {},
) {
	await act(() =>
		root.render(
			<TooltipProvider>
				<MapStackPanel
					geoEvents={[]}
					mapContextEvents={[]}
					getDatasetKey={(event) => event.id}
					getDatasetName={() => 'Map'}
					onInspectDataset={() => {}}
					onZoomToDataset={() => {}}
					onLoadDataset={() => {}}
					onInspectContext={() => {}}
					onRemoveEntry={() => {}}
					onClear={() => {}}
					{...callbacks}
				/>
			</TooltipProvider>,
		),
	)
}

describe('Maplet configurations in the Shelf', () => {
	test('inspects and fits each configuration using its instance identity', async () => {
		const inspected: string[] = []
		const fitted: string[] = []
		await renderPanel({
			onInspectMaplet: (instanceId) => inspected.push(instanceId),
			onZoomToMaplet: (instanceId) => fitted.push(instanceId),
		})

		expect(container.textContent).toContain('Territory only')
		expect(container.textContent).toContain('Events only')
		await act(() => buttons('View configuration')[1]?.click())
		await act(() => buttons('Fit configuration')[0]?.click())
		expect(inspected).toEqual([events.entityKey])
		expect(fitted).toEqual([territory.entityKey])
	})

	test('retains independent visibility, isolation and removal actions', async () => {
		const changed: unknown[] = []
		await renderPanel({
			onSetEntryVisible: (entry, visible) => changed.push(['visible', entry.id, visible]),
			onSetEntryIsolated: (entry, isolated) => changed.push(['isolated', entry.id, isolated]),
			onRemoveEntry: (entry) => changed.push(['remove', entry.id]),
		})
		await act(() => buttons('Hide Territory only')[0]?.click())
		await act(() => buttons('Isolate on the map')[1]?.click())
		await act(() => buttons('Remove from map')[1]?.click())
		expect(changed).toEqual([
			['visible', territory.id, false],
			['isolated', events.id, true],
			['remove', events.id],
		])
	})

	test('omits configuration actions when the host does not provide them', async () => {
		await renderPanel()
		expect(buttons('View configuration')).toHaveLength(0)
		expect(buttons('Fit configuration')).toHaveLength(0)
		expect(buttons('Remove from map')).toHaveLength(2)
	})
})
