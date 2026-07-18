import { invoke } from '@tauri-apps/api/core'
import {
	nativeSchemas,
	type OutboxEnqueueRequest,
	type OutboxItem,
	type OutboxItemSummary,
	type OutboxRelayResult,
	type PublishOutboxService,
} from '../contracts'

function commandError(error: unknown): Error {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		return new Error(String(error.message))
	}
	return new Error(String(error))
}

async function invokeValidated<T>(
	command: string,
	schema: { parse(value: unknown): T },
	args?: Record<string, unknown>,
): Promise<T> {
	try {
		return schema.parse(await invoke(command, args))
	} catch (error) {
		throw commandError(error)
	}
}

export const tauriPublishOutboxService: PublishOutboxService = {
	enqueue: (input: OutboxEnqueueRequest): Promise<OutboxItem> =>
		invokeValidated('outbox_enqueue_v1', nativeSchemas.outboxItem, { input }),
	list: (): Promise<OutboxItem[]> => invokeValidated('outbox_list_v1', nativeSchemas.outboxItems),
	listSummaries: (): Promise<OutboxItemSummary[]> =>
		invokeValidated('outbox_list_summaries_v1', nativeSchemas.outboxItemSummaries),
	flush: (): Promise<OutboxItem[]> => invokeValidated('outbox_flush_v1', nativeSchemas.outboxItems),
	recordResults: (id: string, results: OutboxRelayResult[]): Promise<OutboxItem> =>
		invokeValidated('outbox_record_results_v1', nativeSchemas.outboxItem, { id, results }),
	retry: (id: string): Promise<OutboxItem> =>
		invokeValidated('outbox_retry_v1', nativeSchemas.outboxItem, { id }),
	discard: (id: string): Promise<OutboxItem> =>
		invokeValidated('outbox_discard_v1', nativeSchemas.outboxItem, { id }),
}
