import type { FeatureCollection } from 'geojson'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { useActiveAccount } from 'applesauce-react/hooks'
import {
	getMapletConfigDefaults,
	createMapletSrcdoc,
	getMapletRuntimeDomains,
	loadMapletConfig,
	normalizeMapletConfig,
	prepareBundledMaplet,
	saveMapletConfig,
	startMapletRuntime,
	subscribeDiscoverableMaplets,
	verifyMapletManifest,
	type MapletConfigSchema,
	type MapletManifest,
	type VerifiedMaplet,
} from '@/lib/maplets'
import type { MapletOutput } from '@/lib/maplets/outputs'
import { useEditorStore } from '@/features/geo-editor/store'
import type { MapletCatalogItem, MapletInstanceView } from './MapletsPanel'
import { resolveMapletResource } from './sourceResource'
import { MY_MAPS_VIEWER_DEFINITION, MY_MAPS_VIEWER_HTML } from './myMapsViewer'
import { createMyMapsServices } from './myMapsServices'
import {
	supportsThirdPartyMaplets,
	NATIVE_MAPLET_UNSUPPORTED_MESSAGE,
} from '@/lib/maplets/nativePolicy'

interface HostCommand {
	nonce: string
	action: string
	entryId?: string
	visible?: boolean
	featureId?: string
}
export interface RunningMaplet extends MapletInstanceView {
	artifact: VerifiedMaplet
	hostSchema?: MapletConfigSchema
	generation: number
	refreshRequest?: number
	outputs?: MapletOutput[]
	suppressed: string[]
	commands: HostCommand[]
}
export interface MapletConfigurationView extends RunningMaplet {
	runtimeId: string
	entryId?: string
	preview?: boolean
}
interface SurfaceBox {
	left: number
	top: number
	width: number
	height: number
}
interface HostActions {
	copy(id: string, featureIds?: string[]): void
	fit(id: string): void
	select(id: string, featureId: string): void
}
const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }
const outputId = (runtimeId: string, entryId: string) =>
	`${runtimeId}/${encodeURIComponent(entryId)}`
const bundled: MapletCatalogItem = {
	...MY_MAPS_VIEWER_DEFINITION,
	author: 'Earthly',
	source: 'bundled',
}

/** Tool runtimes persist; their configuration outputs own independent Shelf membership. */
export function useMaplets() {
	const [catalog, setCatalog] = useState<MapletCatalogItem[]>([bundled])
	const [runtimes, setRuntimes] = useState<RunningMaplet[]>([])
	const current = useRef(runtimes)
	const update = useCallback((change: (items: RunningMaplet[]) => RunningMaplet[]) => {
		current.current = change(current.current)
		setRuntimes(current.current)
	}, [])
	const hostActions = useRef<HostActions | undefined>(undefined)
	const setHostActions = useCallback((actions: HostActions) => {
		hostActions.current = actions
	}, [])
	const [discovering, setDiscovering] = useState(false)
	const [discoveryError, setDiscoveryError] = useState<string>()
	const [openId, setOpenId] = useState<string>()
	const [settingsRequest, setSettingsRequest] = useState<{ instanceId: string; nonce: string }>()
	const [selectedFeature, setSelectedFeature] = useState<{
		instanceId: string
		featureId: string
	}>()
	const manifests = useRef(new Map<string, MapletManifest>())
	const pending = useRef(new Map<string, Promise<string | undefined>>())
	const controller = useRef(new AbortController())
	const stopDiscovery = useRef<(() => void) | undefined>(undefined)
	const discoveryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const stackEntries = useEditorStore((state) => state.mapStackEntries)
	const stackOrder = useEditorStore((state) => state.mapStackOrder)
	const surfaces = useRef(new Map<string, HTMLElement>())
	const observers = useRef(new Map<string, ResizeObserver>())
	const [box, setBox] = useState<SurfaceBox>()
	const measure = useCallback(() => {
		let next: SurfaceBox | undefined
		for (const element of surfaces.current.values()) {
			if (element.closest('[inert], [aria-hidden="true"], [hidden]')) continue
			const rect = element.getBoundingClientRect()
			if (
				element.isConnected &&
				rect.width > 1 &&
				rect.height > 1 &&
				rect.right > 0 &&
				rect.left < innerWidth &&
				rect.bottom > 0 &&
				rect.top < innerHeight
			) {
				next = {
					left: rect.left,
					top: Math.max(0, rect.top),
					width: rect.width,
					height: Math.min(rect.bottom, innerHeight) - Math.max(0, rect.top),
				}
			}
		}
		setBox((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
	}, [])
	const surfaceMounted = useCallback(
		(id: string, element: HTMLElement | null) => {
			observers.current.get(id)?.disconnect()
			observers.current.delete(id)
			if (element) {
				surfaces.current.set(id, element)
				const observer = new ResizeObserver(measure)
				observer.observe(element)
				observers.current.set(id, observer)
			} else surfaces.current.delete(id)
			measure()
		},
		[measure],
	)
	useEffect(() => {
		const visibility = new MutationObserver(measure)
		visibility.observe(document.body, {
			attributes: true,
			subtree: true,
			attributeFilter: ['inert', 'aria-hidden', 'hidden'],
		})
		window.addEventListener('resize', measure)
		window.addEventListener('scroll', measure, true)
		return () => {
			visibility.disconnect()
			window.removeEventListener('resize', measure)
			window.removeEventListener('scroll', measure, true)
		}
	}, [measure])
	useEffect(() => {
		controller.current = new AbortController()
		return () => {
			controller.current.abort()
			stopDiscovery.current?.()
			clearTimeout(discoveryTimer.current)
			for (const observer of observers.current.values()) observer.disconnect()
			const state = useEditorStore.getState()
			for (const entry of Object.values(state.mapStackEntries))
				if (entry.entityType === 'maplet') state.removeMapStackEntry(entry.id)
		}
	}, [])
	const command = useCallback(
		(runtimeId: string, message: Omit<HostCommand, 'nonce'>) => {
			update((items) =>
				items.map((item) =>
					item.id === runtimeId
						? {
								...item,
								commands: [...item.commands, { ...message, nonce: crypto.randomUUID() }].slice(-32),
							}
						: item,
				),
			)
		},
		[update],
	)
	const find = useCallback((id: string) => {
		for (const runtime of current.current) {
			if (runtime.id === id) return { runtime, entry: undefined }
			const entry = runtime.outputs?.find((entry) => outputId(runtime.id, entry.id) === id)
			if (entry) return { runtime, entry }
		}
	}, [])
	// Shelf actions can originate outside this feature, including clear-all.
	useEffect(() => {
		for (const runtime of current.current) {
			if (runtime.outputs) {
				for (const entry of runtime.outputs) {
					if (entry.preview || runtime.suppressed.includes(entry.id)) continue
					const shelf = stackEntries[`maplet:${outputId(runtime.id, entry.id)}`]
					if (!shelf) {
						update((items) =>
							items.map((item) =>
								item.id === runtime.id
									? { ...item, suppressed: [...item.suppressed, entry.id] }
									: item,
							),
						)
						command(runtime.id, { action: 'remove', entryId: entry.id })
					} else if (shelf.visible !== entry.visible)
						command(runtime.id, { action: 'visibility', entryId: entry.id, visible: shelf.visible })
				}
			} else if (runtime.definitionId !== bundled.id && !stackEntries[`maplet:${runtime.id}`]) {
				update((items) => items.filter((item) => item.id !== runtime.id))
				setOpenId((id) => (id === runtime.id ? undefined : id))
			}
		}
	}, [stackEntries, command, update])
	const instances = useMemo<MapletConfigurationView[]>(() => {
		const isolated = stackOrder.find((id) => stackEntries[id]?.isolated)
		const result: MapletConfigurationView[] = runtimes.flatMap((runtime) =>
			runtime.outputs
				? runtime.outputs
						.filter((entry) => !runtime.suppressed.includes(entry.id))
						.map((entry) => {
							const id = outputId(runtime.id, entry.id)
							return {
								...runtime,
								id,
								runtimeId: runtime.id,
								entryId: entry.id,
								title: entry.title,
								collection: entry.collection,
								warnings: entry.warnings,
								preview: entry.preview,
								visible: entry.preview
									? openId === runtime.id && !!box
									: openId === runtime.id &&
											box &&
											runtime.outputs?.some(
												(preview) => preview.preview && preview.previewOf === entry.id,
											)
										? false
										: isolated
											? isolated === `maplet:${id}`
											: stackEntries[`maplet:${id}`]?.visible === true,
							}
						})
				: runtime.definitionId === bundled.id
					? []
					: [
							{
								...runtime,
								runtimeId: runtime.id,
								visible: isolated
									? isolated === `maplet:${runtime.id}`
									: stackEntries[`maplet:${runtime.id}`]?.visible === true,
							},
						],
		)
		return result.sort(
			(a, b) =>
				Number(!!a.preview) - Number(!!b.preview) ||
				stackOrder.indexOf(`maplet:${a.id}`) - stackOrder.indexOf(`maplet:${b.id}`),
		)
	}, [runtimes, stackEntries, stackOrder, openId, box])
	const start = useCallback(
		async (definitionId: string) => {
			const existing = current.current.find((item) => item.definitionId === definitionId)
			if (existing) return existing.id
			if (pending.current.has(definitionId)) return pending.current.get(definitionId)
			const operation = (async () => {
				try {
					if (current.current.length + pending.current.size >= 8)
						throw new Error('Remove a Maplet before adding another (limit: 8).')
					const signal = controller.current.signal
					const isBundled = definitionId === bundled.id
					if (!isBundled && !supportsThirdPartyMaplets())
						throw new Error(NATIVE_MAPLET_UNSUPPORTED_MESSAGE)
					const artifact = isBundled
						? await prepareBundledMaplet({
								id: bundled.id,
								html: MY_MAPS_VIEWER_HTML,
								requires: MY_MAPS_VIEWER_DEFINITION.requires,
							})
						: await verifyMapletManifest(manifests.current.get(definitionId)?.event, { signal })
					if (signal.aborted) return
					const schema = artifact.configSchema
					const stored = loadMapletConfig(artifact.identity, schema)
					const config = schema
						? normalizeMapletConfig(schema, { ...getMapletConfigDefaults(schema), ...stored })
						: stored
					const id = crypto.randomUUID()
					const title = catalog.find((item) => item.id === definitionId)?.title ?? artifact.title
					setCatalog((items) =>
						items.map((item) =>
							item.id === definitionId
								? { ...item, releaseHash: artifact.identity.aggregateHash }
								: item,
						),
					)
					if (!isBundled)
						useEditorStore.getState().addMapStackEntry({
							id: `maplet:${id}`,
							entityType: 'maplet',
							entityKey: id,
							title,
							source: 'manual',
							visible: true,
							pinned: false,
							isolated: false,
						})
					update((items) => [
						...items,
						{
							id,
							definitionId,
							title,
							artifact,
							hostSchema: schema,
							config,
							generation: 0,
							status: 'loading',
							warnings: [],
							collection: EMPTY_COLLECTION,
							visible: true,
							suppressed: [],
							commands: [],
						},
					])
					return id
				} catch (error) {
					toast.error(error instanceof Error ? error.message : 'The Maplet could not be started.')
				}
			})()
			pending.current.set(definitionId, operation)
			void operation.finally(() => pending.current.delete(definitionId))
			return operation
		},
		[catalog, update],
	)
	const add = useCallback(
		async (definitionId: string) => {
			const id = await start(definitionId)
			if (id) {
				setOpenId(id)
				command(id, { action: 'openHome' })
			}
		},
		[start, command],
	)
	const openWorkspace = useCallback(
		(id: string) => {
			const found = find(id)
			if (!found) return
			setOpenId(found.runtime.id)
			command(found.runtime.id, {
				action: found.entry ? 'openConfiguration' : 'openHome',
				entryId: found.entry?.id,
			})
		},
		[find, command],
	)
	const remove = useCallback(
		(id: string) => {
			const found = find(id)
			if (!found) return
			if (found.entry) {
				const entryId = found.entry.id
				update((items) =>
					items.map((item) =>
						item.id === found.runtime.id
							? { ...item, suppressed: [...item.suppressed, entryId] }
							: item,
					),
				)
				command(found.runtime.id, { action: 'remove', entryId: found.entry.id })
			} else {
				for (const entry of found.runtime.outputs ?? [])
					useEditorStore.getState().removeMapStackEntry(`maplet:${outputId(id, entry.id)}`)
				update((items) => items.filter((item) => item.id !== id))
				setOpenId((current) => (current === id ? undefined : current))
			}
			useEditorStore.getState().removeMapStackEntry(`maplet:${id}`)
			setSelectedFeature((current) => (current?.instanceId === id ? undefined : current))
		},
		[find, update, command],
	)
	const toggleVisibility = useCallback((id: string) => {
		const state = useEditorStore.getState()
		state.clearMapStackIsolation()
		state.toggleMapStackEntryVisible(`maplet:${id}`)
	}, [])
	const refresh = useCallback(
		(id: string) => {
			const found = find(id)
			if (!found) return
			if (found.entry) command(found.runtime.id, { action: 'refresh', entryId: found.entry.id })
			else
				update((items) =>
					items.map((item) =>
						item.id === id ? { ...item, refreshRequest: (item.refreshRequest ?? 0) + 1 } : item,
					),
				)
		},
		[find, command, update],
	)
	const configure = useCallback(
		(id: string, values: Record<string, unknown>) => {
			const instance = find(id)?.runtime
			if (!instance) return
			const schema = instance.hostSchema ??
				instance.artifact.configSchema ?? { type: 'object', properties: {} }
			const config = normalizeMapletConfig(schema, values)
			for (const key of Object.keys(schema.properties ?? {}))
				if (
					Object.hasOwn(values, key) &&
					JSON.stringify(values[key]) !== JSON.stringify(config[key])
				)
					throw new Error(`Check the value for ${schema.properties?.[key]?.title ?? key}.`)
			saveMapletConfig(instance.artifact.identity, config, schema)
			update((items) =>
				items.map((item) =>
					item.id === instance.id
						? {
								...item,
								config,
								generation: item.generation + 1,
								status: 'loading',
								error: undefined,
							}
						: item,
				),
			)
		},
		[find, update],
	)
	const collectionReceived = useCallback(
		(
			id: string,
			generation: number,
			collection: FeatureCollection,
			warnings: string[],
			entries?: MapletOutput[],
		) => {
			const instance = current.current.find(
				(item) => item.id === id && item.generation === generation,
			)
			if (!instance) return
			let suppressed = instance.suppressed
			const state = useEditorStore.getState()
			const desired = new Set(
				(entries ?? [])
					.filter((entry) => !entry.preview && !suppressed.includes(entry.id))
					.map((entry) => `maplet:${outputId(id, entry.id)}`),
			)
			for (const old of instance.outputs ?? []) {
				const key = `maplet:${outputId(id, old.id)}`
				if (!desired.has(key)) state.removeMapStackEntry(key)
			}
			if (entries) {
				suppressed = suppressed.filter((key) => entries.some((entry) => entry.id === key))
				state.removeMapStackEntry(`maplet:${id}`)
				for (const entry of entries) {
					if (entry.preview || suppressed.includes(entry.id)) continue
					const key = `maplet:${outputId(id, entry.id)}`,
						old = state.mapStackEntries[key]
					if (!old || old.title !== entry.title || old.visible !== entry.visible)
						state.addMapStackEntry({
							id: key,
							entityType: 'maplet',
							entityKey: outputId(id, entry.id),
							title: entry.title,
							source: 'manual',
							visible: entry.visible,
							pinned: old?.pinned ?? false,
							isolated: old?.isolated ?? false,
						})
				}
			} else if (instance.definitionId !== bundled.id && !state.mapStackEntries[`maplet:${id}`]) {
				state.addMapStackEntry({
					id: `maplet:${id}`,
					entityType: 'maplet',
					entityKey: id,
					title: instance.title,
					source: 'manual',
					visible: true,
					pinned: false,
					isolated: false,
				})
			}
			update((items) =>
				items.map((item) =>
					item.id === id && item.generation === generation
						? {
								...item,
								collection,
								warnings,
								outputs: entries,
								suppressed,
								status: 'ready',
								error: undefined,
								updatedAt: Date.now(),
							}
						: item,
				),
			)
		},
		[update],
	)
	const schemaReceived = useCallback(
		(id: string, schema: MapletConfigSchema, config: Record<string, unknown>) =>
			update((items) =>
				items.map((item) => (item.id === id ? { ...item, hostSchema: schema, config } : item)),
			),
		[update],
	)
	const runtimeError = useCallback(
		(id: string, generation: number, error: unknown) =>
			update((items) =>
				items.map((item) =>
					item.id === id && item.generation === generation
						? {
								...item,
								status: item.collection.features.length ? 'stale' : 'error',
								error: error instanceof Error ? error.message : String(error),
							}
						: item,
				),
			),
		[update],
	)
	const openSettings = useCallback((instanceId: string) => {
		setOpenId(undefined)
		setSettingsRequest({ instanceId, nonce: crypto.randomUUID() })
	}, [])
	const selectFeature = useCallback(
		(id: string, featureId: string) => {
			setSelectedFeature({ instanceId: id, featureId })
			const found = find(id)
			if (found?.entry) {
				setOpenId(found.runtime.id)
				command(found.runtime.id, { action: 'selectFeature', entryId: found.entry.id, featureId })
			}
		},
		[find, command],
	)
	const workspaceRequest = useCallback(
		async (runtimeId: string, action: string, payload: unknown, signal: AbortSignal) => {
			signal.throwIfAborted()
			if (action === 'back') {
				setOpenId((id) => (id === runtimeId ? undefined : id))
				return { ok: true }
			}
			if (!payload || typeof payload !== 'object' || Array.isArray(payload))
				throw new Error('Invalid Maplet action')
			const value = payload as Record<string, unknown>
			if (typeof value.entryId !== 'string') throw new Error('Choose a configuration')
			const id = outputId(runtimeId, value.entryId),
				found = find(id)
			if (!found?.entry) throw new Error('This configuration is not on your map')
			if (action === 'fit') hostActions.current?.fit(id)
			else if (action === 'copy') {
				if (
					!Array.isArray(value.featureIds) ||
					value.featureIds.length > 5000 ||
					value.featureIds.some((id) => typeof id !== 'string' || id.length > 256)
				)
					throw new Error('Select geometry to copy')
				hostActions.current?.copy(id, value.featureIds as string[])
				setOpenId(undefined)
			} else if (action === 'select' && typeof value.featureId === 'string')
				hostActions.current?.select(id, value.featureId)
			else throw new Error('Unsupported Maplet action')
			return { ok: true }
		},
		[find],
	)
	const discover = useCallback(() => {
		stopDiscovery.current?.()
		clearTimeout(discoveryTimer.current)
		setDiscovering(true)
		setDiscoveryError(undefined)
		stopDiscovery.current = subscribeDiscoverableMaplets({
			onMaplet: (manifest) => {
				manifests.current.set(manifest.id, manifest)
				setCatalog((items) => [
					...items.filter((item) => item.id !== manifest.id),
					{
						id: manifest.id,
						title: manifest.title,
						description: manifest.description,
						author: manifest.event.pubkey,
						source: 'nostr',
						schema: manifest.configSchema,
					},
				])
			},
			onError: (error) => setDiscoveryError(error instanceof Error ? error.message : String(error)),
		})
		discoveryTimer.current = setTimeout(() => {
			stopDiscovery.current?.()
			setDiscovering(false)
		}, 12_000)
	}, [])
	return {
		catalog: catalog.map((item) => ({
			...item,
			schema:
				runtimes.find((instance) => instance.definitionId === item.id)?.hostSchema ?? item.schema,
		})),
		instances,
		add,
		remove,
		toggleVisibility,
		refresh,
		configure,
		discover,
		discovering,
		discoveryError,
		selectFeature,
		selectedFeature,
		settingsRequest,
		openWorkspace,
		setHostActions,
		surfaceMounted,
		appOpen: !!openId,
		runtimes: (
			<>
				{runtimes.map((instance) => (
					<RuntimeFrame
						key={`${instance.id}:${instance.generation}`}
						instance={instance}
						onCollection={collectionReceived}
						onError={runtimeError}
						onOpenSettings={openSettings}
						onSchema={schemaReceived}
						open={openId === instance.id}
						box={box}
						onWorkspace={workspaceRequest}
						onBack={() => setOpenId(undefined)}
					/>
				))}
			</>
		),
	}
}

interface FrameProps {
	instance: RunningMaplet
	onCollection(
		id: string,
		generation: number,
		collection: FeatureCollection,
		warnings: string[],
		entries?: MapletOutput[],
	): void
	onError(id: string, generation: number, error: unknown): void
	onOpenSettings(id: string): void
	onSchema(id: string, schema: MapletConfigSchema, config: Record<string, unknown>): void
	onWorkspace(id: string, action: string, payload: unknown, signal: AbortSignal): Promise<unknown>
	onBack(): void
	open: boolean
	box?: SurfaceBox
}

/** Never move/remount the verified iframe when its sidebar surface changes. */
function RuntimeFrame({
	instance,
	onCollection,
	onError,
	onOpenSettings,
	onSchema,
	onWorkspace,
	onBack,
	open,
	box,
}: FrameProps) {
	const iframe = useRef<HTMLIFrameElement>(null)
	const runtimeRef = useRef<ReturnType<typeof startMapletRuntime> | undefined>(undefined)
	const initial = useRef(instance)
	const account = useActiveAccount()
	const pubkey = account?.pubkey ?? ''
	const identity = useRef(pubkey)
	identity.current = pubkey
	const [loaded, setLoaded] = useState(false)
	const sent = useRef(new Set<string>())
	const dataServices = useMemo(
		() =>
			instance.artifact.provenance === 'bundled' && instance.definitionId === bundled.id
				? createMyMapsServices(instance.artifact.identity)
				: undefined,
		[instance.artifact, instance.definitionId],
	)
	const srcdoc = useMemo(
		() =>
			createMapletSrcdoc(
				instance.artifact,
				getMapletRuntimeDomains({
					resolveResource: resolveMapletResource,
					onDataRequest: dataServices,
				}),
			),
		[instance.artifact, dataServices],
	)
	useLayoutEffect(() => {
		if (!iframe.current) return
		const first = initial.current
		try {
			const runtime = startMapletRuntime({
				iframe: iframe.current,
				artifact: first.artifact,
				config: first.config,
				resolveResource: resolveMapletResource,
				onDataRequest: dataServices,
				identityPubkey: identity.current,
				onWorkspaceRequest: (action, payload, signal) =>
					onWorkspace(first.id, action, payload, signal),
				onCollection: (collection, options) =>
					onCollection(first.id, first.generation, collection, options.warnings, options.entries),
				onError: (error) => onError(first.id, first.generation, error),
				onOpenSettings: () => onOpenSettings(first.id),
				onConfigSchema: (schema, config) => onSchema(first.id, schema, config),
			})
			runtimeRef.current = runtime
			return () => {
				runtime.dispose()
				runtimeRef.current = undefined
			}
		} catch (error) {
			onError(first.id, first.generation, error)
		}
	}, [onCollection, onError, onOpenSettings, onSchema, onWorkspace, dataServices])
	useLayoutEffect(() => {
		runtimeRef.current?.updateIdentity(pubkey)
	}, [pubkey])
	useEffect(() => {
		if (instance.refreshRequest) runtimeRef.current?.refresh()
	}, [instance.refreshRequest])
	useEffect(() => {
		if (!loaded) return
		for (const command of instance.commands)
			if (!sent.current.has(command.nonce)) {
				runtimeRef.current?.notifyWorkspaceChanged(command)
				sent.current.add(command.nonce)
			}
		for (const nonce of sent.current)
			if (!instance.commands.some((command) => command.nonce === nonce)) sent.current.delete(nonce)
	}, [loaded, instance.commands])
	const foreign = instance.artifact.provenance !== 'bundled'
	// The canvas and Margin have separate stacking contexts. A constant portal target
	// keeps this browsing context alive while its measured sidebar position changes.
	return createPortal(
		<section
			hidden={!open || !box}
			aria-label={`${instance.title} sidebar`}
			style={{ position: 'fixed', ...box, zIndex: 50, display: open && box ? 'flex' : 'none' }}
			className="flex min-h-0 flex-col overflow-hidden border border-border bg-background"
		>
			{foreign ? (
				<div className="flex shrink-0 items-center justify-between border-b border-border px-2 text-xs">
					<button type="button" className="min-h-9 px-2" onClick={onBack}>
						← Maplets
					</button>
					<span>{instance.title}</span>
					<button
						type="button"
						className="min-h-9 px-2"
						onClick={() => onOpenSettings(instance.id)}
					>
						Settings
					</button>
				</div>
			) : null}
			{instance.error ? (
				<p role="alert" className="shrink-0 border-b border-border p-2 text-xs text-destructive">
					{instance.error}
				</p>
			) : null}
			<iframe
				ref={iframe}
				onLoad={() => setLoaded(true)}
				srcDoc={srcdoc}
				title={`${instance.title} sandbox`}
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				className="block min-h-0 w-full flex-1 border-0"
			/>
		</section>,
		document.body,
	)
}
