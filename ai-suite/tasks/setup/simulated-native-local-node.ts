import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const installSimulatedNativeLocalNodeTask: AiTaskMetadata = {
	id: 'setup.simulated-native-local-node',
	summary:
		'Expose a deterministic Android-shaped local-node command boundary to the browser journey suite.',
	preconditions: ['Fresh browser page', 'Loopback Earthly server'],
	sideEffects: ['Installs an in-page Tauri command adapter before Earthly loads'],
	viewports: 'both',
}

/**
 * This adapter exercises the real frontend platform boundary and Field-session
 * model without claiming to simulate Wi-Fi, Rust, or a second Android process.
 * Native transport guarantees stay in the Android and physical-device suites.
 */
export async function installSimulatedNativeLocalNode(earthly: EarthlySession): Promise<void> {
	await earthly.page.addInitScript(() => {
		type NativeEvent = Record<string, unknown> & {
			id?: string
			tags?: unknown[]
		}

		const nodeId = 'a'.repeat(64)
		let descriptor = {
			version: 1,
			nodeId,
			relayUrl: 'ws://127.0.0.1:17447/',
			blossomUrl: 'http://127.0.0.1:17448/',
			scope: 'loopback',
			availability: 'process',
		}
		let lanExpiresAt: number | undefined
		let events: NativeEvent[] = []

		const status = () => ({
			state: 'running',
			descriptor,
			...(lanExpiresAt ? { lanExpiresAt } : {}),
		})
		const eventFromArgs = (args?: Record<string, unknown>) =>
			(args?.event ?? null) as NativeEvent | null
		const invoke = async (command: string, args?: Record<string, unknown>) => {
			switch (command) {
				case 'outbox_flush_v1':
				case 'outbox_list_v1':
				case 'outbox_list_summaries_v1':
					return []
				case 'local_node_status_v1':
					return status()
				case 'local_node_network_addresses_v1':
					return [{ address: '192.168.50.4', interfaceName: 'wlan0' }]
				case 'local_node_enable_lan_v1':
					descriptor = {
						...descriptor,
						relayUrl: 'ws://192.168.50.4:17447/',
						blossomUrl: 'http://192.168.50.4:17448/',
						scope: 'local-network',
						availability: 'foreground-service',
					}
					lanExpiresAt = Math.floor(Date.now() / 1000) + 3_600
					return status()
				case 'local_node_disable_lan_v1':
					descriptor = {
						...descriptor,
						relayUrl: 'ws://127.0.0.1:17447/',
						blossomUrl: 'http://127.0.0.1:17448/',
						scope: 'loopback',
						availability: 'process',
					}
					lanExpiresAt = undefined
					return status()
				case 'local_node_pending_claims_v1':
				case 'local_node_peer_grants_v1':
				case 'local_node_remote_nodes_v1':
					return []
				case 'local_node_create_invitation_v1':
					return {
						version: 1,
						encoded: `earthly-pair-v1:z${'x'.repeat(680)}`,
						expiresAt: Math.floor(Date.now() / 1000) + 600,
						capabilities: ['relay-read', 'relay-write', 'blob-read', 'blob-write'],
						descriptor,
					}
				case 'local_node_ingest_event_v1': {
					const event = eventFromArgs(args)
					if (!event) throw new Error('Simulated local node received no event')
					events = [event, ...events.filter((candidate) => candidate.id !== event.id)]
					return event
				}
				case 'local_node_field_session_events_v1': {
					const sessionId = String(args?.sessionId ?? '')
					return events.filter((event) =>
						Array.isArray(event.tags)
							? event.tags.some(
									(tag) => Array.isArray(tag) && tag[0] === 'h' && tag[1] === sessionId,
								)
							: false,
					)
				}
				default:
					throw new Error(`Unexpected simulated native command: ${command}`)
			}
		}

		Object.defineProperty(window, '__TAURI_INTERNALS__', {
			configurable: true,
			value: { invoke },
		})
		Object.defineProperty(window, '__TAURI_OS_PLUGIN_INTERNALS__', {
			configurable: true,
			value: { platform: 'android' },
		})
	})
}
