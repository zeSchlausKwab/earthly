import type { NostrEvent } from 'nostr-tools'

/** Shoutbox tab categories */
export type ShoutboxCategory = 'announcements' | 'features' | 'greetings' | 'bugs'

/** Category configuration */
export interface CategoryConfig {
	id: ShoutboxCategory
	label: string
	description: string
	icon: string
	/** Required hashtags for auto-adding to posts */
	tags: string[]
	/** Category-specific tag used for filtering (must be unique per category) */
	filterTag: string
	/** If true, only the developer npub can post */
	developerOnly?: boolean
	/** Optional pubkey filter */
	authorPubkey?: string
	/** Pinned event IDs */
	pinnedEventIds?: string[]
}

/** NIP-22 Comment node for threading */
export interface CommentNode {
	event: NostrEvent
	children: CommentNode[]
	depth: number
}

/** The developer npub for announcements */
export const EARTHLY_CITY_NPUB = 'npub182jczunncwe0jn6frpqwq3e0qjws7yqqnc3auccqv9nte2dnd63scjm4rf'

/** Pinned announcement note IDs */
export const PINNED_ANNOUNCEMENT_IDS = [
	'note13yj64h4ph3glgtfnxdfc694wq63m7zy5xyppev39sv9dhsl25acqyxfcp4',
	'note1twc8vewtx2w3a9tssacczv46cgpcw84ycjjv0snsqe8gjxfj0mvqvdrry5',
	'note1k8alwuwqqeh0ngyvqsptmv0h5ujkf542mcsphw82366ghva5548qnjc4jf',
]

/** Category configurations */
export const SHOUTBOX_CATEGORIES: CategoryConfig[] = [
	{
		id: 'announcements',
		label: 'Announcements',
		description: 'Official updates from the Earthly team',
		icon: '📢',
		tags: ['earthlycity', 'blog'],
		filterTag: 'blog',
		developerOnly: true,
		pinnedEventIds: PINNED_ANNOUNCEMENT_IDS,
	},
	{
		id: 'features',
		label: 'Feature Requests',
		description: 'Suggest new features and improvements',
		icon: '✨',
		tags: ['earthlycity', 'feature'],
		filterTag: 'feature',
	},
	{
		id: 'greetings',
		label: 'Greetings',
		description: 'Say hello to the community',
		icon: '👋',
		tags: ['earthlycity', 'greetings'],
		filterTag: 'greetings',
	},
	{
		id: 'bugs',
		label: 'Bug Reports',
		description: 'Report issues and bugs',
		icon: '🐛',
		tags: ['earthlycity', 'bug'],
		filterTag: 'bug',
	},
]
