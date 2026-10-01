import { useEffect, useRef, useState } from 'react'
import type { AiOutputNotice } from '../outputAttention'
import './aiOutputAttention.css'

/** Shared, quiet cue on the controls that reveal newly changed work. */
export const AI_OUTPUT_ATTENTION_CLASS = 'ai-output-attention'

export function AiOutputAttentionDot() {
	return (
		<span
			aria-hidden="true"
			className="pointer-events-none absolute right-1 top-1 size-1.5 rounded-full bg-foreground"
		/>
	)
}

/** Announce writes while this conversation is mounted, rather than old notices on arrival. */
export function AiOutputAnnouncement({
	chatId,
	notices,
}: {
	chatId: string | null
	notices: readonly AiOutputNotice[]
}) {
	const latest = notices.reduce<AiOutputNotice | undefined>(
		(result, notice) => (!result || notice.version > result.version ? notice : result),
		undefined,
	)
	const observed = useRef({ chatId, version: latest?.version ?? 0 })
	const [announcement, setAnnouncement] = useState<{ version: number; text: string } | null>(null)
	useEffect(() => {
		if (observed.current.chatId !== chatId) {
			observed.current = { chatId, version: latest?.version ?? 0 }
			setAnnouncement(null)
			return
		}
		if (!latest || latest.version <= observed.current.version) return
		observed.current.version = latest.version
		setAnnouncement({
			version: latest.version,
			text: `AI updated “${latest.target.title}”. Open AI can edit to review.`,
		})
	}, [chatId, latest])
	return (
		<span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
			{announcement && <span key={announcement.version}>{announcement.text}</span>}
		</span>
	)
}
