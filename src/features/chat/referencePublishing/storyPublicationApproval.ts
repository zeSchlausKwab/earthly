export interface StoryPublicationApproval {
	id: number
	title: string
	maps: readonly string[]
}
let counter = 0
let request: StoryPublicationApproval | null = null
let settle: ((confirmed: boolean) => void) | null = null
const subscribers = new Set<() => void>()
export const getStoryPublicationApproval = () => request
export function subscribeStoryPublicationApproval(listener: () => void) {
	subscribers.add(listener)
	return () => {
		subscribers.delete(listener)
	}
}
export function requestStoryPublicationApproval(
	title: string,
	maps: readonly string[],
): Promise<boolean> {
	if (request)
		return Promise.reject(new Error('Another Story publication is awaiting confirmation.'))
	return new Promise((resolve) => {
		settle = resolve
		request = { id: ++counter, title, maps: [...maps] }
		for (const listener of subscribers) listener()
	})
}
export function answerStoryPublicationApproval(id: number, confirmed: boolean) {
	if (request?.id !== id) return
	const resolve = settle
	request = null
	settle = null
	for (const listener of subscribers) listener()
	resolve?.(confirmed)
}
