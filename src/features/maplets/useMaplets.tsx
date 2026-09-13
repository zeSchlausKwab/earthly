import type { FeatureCollection } from 'geojson'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { useEditorStore } from '@/features/geo-editor/store'
import type { MapletCatalogItem, MapletInstanceView } from './MapletsPanel'
import { LIVE_MAPPER_HTML, LIVE_MAPPER_CONFIG_SCHEMA, LIVE_MAPPER_DEFINITION } from './liveMapper'
import { resolveMapletResource } from './sourceResource'
import { useMapletWorkspace } from './useMapletWorkspace'
import {
	supportsThirdPartyMaplets,
	NATIVE_MAPLET_UNSUPPORTED_MESSAGE,
} from '@/lib/maplets/nativePolicy'

export interface RunningMaplet extends MapletInstanceView {
	artifact: VerifiedMaplet
	hostSchema?: MapletConfigSchema
	generation: number
}

const EMPTY_COLLECTION: FeatureCollection = { type: 'FeatureCollection', features: [] }
const builtin: MapletCatalogItem = {
	id: 'live-mapper',
	title: 'Live Mapper',
	description:
		'Import JSON into named layers, publish collections, and follow snapshots from other contributors.',
	source: 'bundled',
	schema: LIVE_MAPPER_CONFIG_SCHEMA,
}

/** Runtime instances are session-owned. Shelf membership is the sole visibility authority. */
export function useMaplets() {
	const [catalog, setCatalog] = useState<MapletCatalogItem[]>([builtin])
	const [instances, setInstances] = useState<RunningMaplet[]>([])
	// The trusted collection workspace is shared by the app's Follow actions and
	// the bundled iframe. It survives opening/closing or replacing that runtime.
	const liveMapperWorkspace = useMapletWorkspace({ instanceId: 'live-mapper' })
	const [discovering, setDiscovering] = useState(false)
	const [discoveryError, setDiscoveryError] = useState<string>()
	const [openWorkspaceId, setOpenWorkspaceId] = useState<string>()
	const [viewRequest, setViewRequest] = useState<{ instanceId: string; nonce: string }>()
	const openWorkspace = useCallback((id: string) => setOpenWorkspaceId(id), [])
	const closeWorkspace = useCallback(() => setOpenWorkspaceId(undefined), [])
	const viewOnMap = useCallback((id: string) => {
		setOpenWorkspaceId(undefined)
		setViewRequest({ instanceId: id, nonce: crypto.randomUUID() })
	}, [])
	const [selectedFeature, setSelectedFeature] = useState<{
		instanceId: string
		featureId: string
	}>()
	const [settingsRequest, setSettingsRequest] = useState<{ instanceId: string; nonce: string }>()
	const openSettings = useCallback(
		(instanceId: string) => setSettingsRequest({ instanceId, nonce: crypto.randomUUID() }),
		[],
	)
	const manifests = useRef(new Map<string, MapletManifest>())
	const pending = useRef(new Set<string>())
	const controller = useRef(new AbortController())
	const stopDiscovery = useRef<(() => void) | undefined>(undefined)
	const discoveryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const stackEntries = useEditorStore((state) => state.mapStackEntries)
	const stackOrder = useEditorStore((state) => state.mapStackOrder)

	useEffect(() => {
		controller.current = new AbortController()
		return () => {
			controller.current.abort()
			stopDiscovery.current?.()
			clearTimeout(discoveryTimer.current)
			const state = useEditorStore.getState()
			for (const entry of Object.values(state.mapStackEntries))
				if (entry.entityType === 'maplet') state.removeMapStackEntry(entry.id)
		}
	}, [])

	// Removing via Shelf/clear also stops the iframe and its pending requests/timers.
	useEffect(() => {
		setInstances((current) =>
			current.some((instance) => !stackEntries[`maplet:${instance.id}`])
				? current.filter((instance) => stackEntries[`maplet:${instance.id}`])
				: current,
		)
	}, [stackEntries])

	const visibleInstances = useMemo(() => {
		const isolated = stackOrder.find((id) => stackEntries[id]?.isolated)
		return instances
			.map((instance) => ({
				...instance,
				visible: isolated
					? isolated === `maplet:${instance.id}`
					: stackEntries[`maplet:${instance.id}`]?.visible === true,
			}))
			.sort((a, b) => stackOrder.indexOf(`maplet:${a.id}`) - stackOrder.indexOf(`maplet:${b.id}`))
	}, [instances, stackEntries, stackOrder])

	const add = useCallback(
		async (definitionId: string) => {
			if (pending.current.has(definitionId)) return
			const existing = instances.find((instance) => instance.definitionId === definitionId)
			if (existing) return existing.id
			if (instances.length + pending.current.size >= 8) {
				toast.error('Remove a Maplet before adding another (limit: 8).')
				return
			}
			pending.current.add(definitionId)
			const signal = controller.current.signal
			try {
				if (definitionId !== 'live-mapper' && !supportsThirdPartyMaplets())
					throw new Error(NATIVE_MAPLET_UNSUPPORTED_MESSAGE)
				const artifact =
					definitionId === 'live-mapper'
						? await prepareBundledMaplet({
								id: definitionId,
								html: LIVE_MAPPER_HTML,
								requires: LIVE_MAPPER_DEFINITION.requires,
								configSchema: LIVE_MAPPER_CONFIG_SCHEMA,
							})
						: await verifyMapletManifest(manifests.current.get(definitionId)?.event, { signal })
				if (signal.aborted) return
				const schema = artifact.configSchema
				const stored = loadMapletConfig(artifact.identity, schema)
				const config = schema
					? normalizeMapletConfig(schema, {
							...getMapletConfigDefaults(schema),
							...stored,
						})
					: stored
				const id = crypto.randomUUID()
				const title = catalog.find((item) => item.id === definitionId)?.title ?? artifact.title
				setCatalog((current) =>
					current.map((item) =>
						item.id === definitionId
							? { ...item, releaseHash: artifact.identity.aggregateHash }
							: item,
					),
				)
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
				setInstances((current) => [
					...current,
					{
						id,
						definitionId,
						title,
						artifact,
						hostSchema: artifact.configSchema,
						config,
						generation: 0,
						status: 'loading',
						warnings: [],
						collection: EMPTY_COLLECTION,
						visible: true,
					},
				])
				if (definitionId === 'live-mapper') setOpenWorkspaceId(id)
				return id
			} catch (error) {
				toast.error(error instanceof Error ? error.message : 'The Maplet could not be started.')
			} finally {
				pending.current.delete(definitionId)
			}
		},
		[catalog, instances],
	)
	const addToMap = useCallback(
		async (definitionId: string) => {
			await add(definitionId)
		},
		[add],
	)
	const followCollection = useCallback(
		async (address: string) => {
			const id = await add('live-mapper')
			if (!id)
				throw new Error('Live Mapper is still starting. Try following this collection again.')
			await liveMapperWorkspace.request('follow', { address })
			const stack = useEditorStore.getState()
			stack.clearMapStackIsolation()
			stack.setMapStackEntryVisible(`maplet:${id}`, true)
			// External Follow opens a different reader view. Recreate the iframe to
			// cancel prior import work and discard its temporary preview, while the
			// host-owned saved collections and subscriptions remain intact.
			setInstances((current) =>
				current.map((instance) =>
					instance.id === id
						? {
								...instance,
								generation: instance.generation + 1,
								status: 'loading',
								error: undefined,
							}
						: instance,
				),
			)
			setOpenWorkspaceId(id)
		},
		[add, liveMapperWorkspace.request],
	)

	const remove = useCallback((id: string) => {
		setInstances((current) => current.filter((instance) => instance.id !== id))
		useEditorStore.getState().removeMapStackEntry(`maplet:${id}`)
		setSelectedFeature((current) => (current?.instanceId === id ? undefined : current))
	}, [])
	const toggleVisibility = useCallback((id: string) => {
		const state = useEditorStore.getState()
		state.clearMapStackIsolation()
		state.toggleMapStackEntryVisible(`maplet:${id}`)
	}, [])
	const refresh = useCallback(
		(id: string) =>
			setInstances((current) =>
				current.map((instance) =>
					instance.id === id
						? {
								...instance,
								generation: instance.generation + 1,
								status: 'loading',
								error: undefined,
							}
						: instance,
				),
			),
		[],
	)
	const configure = useCallback(
		(id: string, values: Record<string, unknown>) => {
			const instance = instances.find((candidate) => candidate.id === id)
			if (!instance) return
			const schema = instance.hostSchema ??
				instance.artifact.configSchema ?? { type: 'object', properties: {} }
			const config = normalizeMapletConfig(schema, values)
			for (const key of Object.keys(schema.properties ?? {})) {
				if (
					Object.hasOwn(values, key) &&
					JSON.stringify(values[key]) !== JSON.stringify(config[key])
				)
					throw new Error(`Check the value for ${schema.properties?.[key]?.title ?? key}.`)
			}
			saveMapletConfig(instance.artifact.identity, config, schema)
			setInstances((current) =>
				current.map((candidate) =>
					candidate.artifact.identity.dTag === instance.artifact.identity.dTag &&
					candidate.artifact.identity.aggregateHash === instance.artifact.identity.aggregateHash
						? {
								...candidate,
								config,
								generation: candidate.generation + 1,
								status: 'loading',
								error: undefined,
							}
						: candidate,
				),
			)
		},
		[instances],
	)
	const collectionReceived = useCallback(
		(id: string, generation: number, collection: FeatureCollection, warnings: string[]) => {
			setInstances((current) =>
				current.map((instance) =>
					instance.id === id && instance.generation === generation
						? {
								...instance,
								collection,
								warnings,
								status: 'ready',
								error: undefined,
								updatedAt: Date.now(),
								outputSource:
									instance.config.source === 'sample'
										? 'sample'
										: instance.config.source === 'live'
											? 'live'
											: undefined,
							}
						: instance,
				),
			)
		},
		[],
	)
	const schemaReceived = useCallback(
		(id: string, schema: MapletConfigSchema, config: Record<string, unknown>) => {
			setInstances((current) =>
				current.map((instance) =>
					instance.id === id ? { ...instance, hostSchema: schema, config } : instance,
				),
			)
		},
		[],
	)
	const runtimeError = useCallback((id: string, generation: number, error: unknown) => {
		setInstances((current) =>
			current.map((instance) =>
				instance.id === id && instance.generation === generation
					? {
							...instance,
							status: instance.collection.features.length ? 'stale' : 'error',
							error: error instanceof Error ? error.message : String(error),
						}
					: instance,
			),
		)
	}, [])
	const discover = useCallback(() => {
		stopDiscovery.current?.()
		clearTimeout(discoveryTimer.current)
		setDiscovering(true)
		setDiscoveryError(undefined)
		stopDiscovery.current = subscribeDiscoverableMaplets({
			onMaplet: (manifest) => {
				manifests.current.set(manifest.id, manifest)
				setCatalog((current) => [
					...current.filter((item) => item.id !== manifest.id),
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
	const selectFeature = useCallback(
		(instanceId: string, featureId: string) => setSelectedFeature({ instanceId, featureId }),
		[],
	)

	return {
		catalog: catalog.map((item) => ({
			...item,
			schema:
				instances.find((instance) => instance.definitionId === item.id)?.hostSchema ?? item.schema,
		})),
		instances: visibleInstances,
		add: addToMap,
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
		followCollection,
		viewRequest,
		runtimes: (
			<div>
				{instances.map((instance) => (
					<RuntimeFrame
						key={`${instance.id}:${instance.generation}`}
						instance={instance}
						onCollection={collectionReceived}
						onError={runtimeError}
						onOpenSettings={openSettings}
						onSchema={schemaReceived}
						open={openWorkspaceId === instance.id}
						onClose={closeWorkspace}
						onViewMap={viewOnMap}
						workspace={
							instance.artifact.provenance === 'bundled' && instance.definitionId === 'live-mapper'
								? liveMapperWorkspace
								: undefined
						}
					/>
				))}
			</div>
		),
	}
}

type FrameProps = {
	instance: RunningMaplet
	onCollection: (
		id: string,
		generation: number,
		collection: FeatureCollection,
		warnings: string[],
	) => void
	onError: (id: string, generation: number, error: unknown) => void
	onOpenSettings: (id: string) => void
	onSchema: (id: string, schema: MapletConfigSchema, config: Record<string, unknown>) => void
	open: boolean
	onClose: () => void
	onViewMap: (id: string) => void
}

function RuntimeFrame({
	instance,
	onCollection,
	onError,
	onOpenSettings,
	onSchema,
	open,
	onClose,
	onViewMap,
	workspace,
}: FrameProps & { workspace?: ReturnType<typeof useMapletWorkspace> }) {
	const iframe = useRef<HTMLIFrameElement>(null)
	const dialog = useRef<HTMLDialogElement>(null)
	const runtimeRef = useRef<ReturnType<typeof startMapletRuntime> | undefined>(undefined)
	const account = useActiveAccount()
	const pubkey = workspace?.pubkey ?? account?.pubkey ?? ''
	const current = useRef({ workspace, pubkey })
	current.current = { workspace, pubkey }
	const [height, setHeight] = useState(600)
	const initial = useRef(instance)
	// Set verified srcdoc before the element enters the document. Mounting an
	// empty iframe first introduces a second about:blank load that is ambiguous
	// with a real navigation from the opaque-origin sandbox.
	const srcdoc = useMemo(
		() =>
			createMapletSrcdoc(
				instance.artifact,
				getMapletRuntimeDomains({ resolveResource: resolveMapletResource }),
			),
		[instance.artifact],
	)
	useLayoutEffect(() => {
		if (!iframe.current) return
		const instance = initial.current
		let runtime: ReturnType<typeof startMapletRuntime>
		try {
			runtime = startMapletRuntime({
				iframe: iframe.current,
				artifact: instance.artifact,
				config: instance.config,
				resolveResource: resolveMapletResource,
				identityPubkey: current.current.pubkey,
				onResize: setHeight,
				...(current.current.workspace
					? {
							onWorkspaceRequest: async (action: string, payload: unknown, signal: AbortSignal) => {
								if (action === 'viewMap') {
									onViewMap(instance.id)
									return current.current.workspace?.state
								}
								return current.current.workspace?.request(action, payload, signal)
							},
						}
					: {}),
				onCollection: (collection, options) =>
					onCollection(instance.id, instance.generation, collection, options.warnings ?? []),
				onError: (error) => onError(instance.id, instance.generation, error),
				onOpenSettings: () => onOpenSettings(instance.id),
				onConfigSchema: (schema, config) => onSchema(instance.id, schema, config),
			})
			runtimeRef.current = runtime
		} catch (error) {
			onError(instance.id, instance.generation, error)
			return
		}
		return () => {
			runtime.dispose()
			runtimeRef.current = undefined
		}
	}, [onCollection, onError, onOpenSettings, onSchema, onViewMap])
	const workspaceState = workspace?.state
	useLayoutEffect(() => {
		runtimeRef.current?.updateIdentity(pubkey)
		if (workspaceState) runtimeRef.current?.notifyWorkspaceChanged(workspaceState)
	}, [pubkey, workspaceState])
	useEffect(() => {
		const element = dialog.current
		if (!element) return
		if (open && !element.open) element.showModal()
		if (!open && element.open) element.close()
	}, [open])
	return (
		<dialog
			ref={dialog}
			aria-label={`${instance.title} workspace`}
			onCancel={onClose}
			onClose={onClose}
			className="fixed m-auto max-h-[94dvh] w-[min(760px,calc(100%-24px))] overflow-auto rounded-lg border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40"
		>
			<div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-4 py-2">
				<span className="text-xs font-medium">{instance.title} workspace</span>
				<button
					type="button"
					onClick={() => onViewMap(instance.id)}
					className="min-h-10 rounded-sm px-3 text-xs hover:bg-muted"
				>
					View map & close
				</button>
			</div>
			<iframe
				ref={iframe}
				srcDoc={srcdoc}
				title={`${instance.title} sandbox`}
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				className="block w-full border-0"
				style={{ height: Math.max(360, height), maxHeight: '78dvh' }}
			/>
		</dialog>
	)
}
