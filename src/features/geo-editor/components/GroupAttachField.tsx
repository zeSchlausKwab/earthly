/**
 * Contributor attach + inline warnings (D-05/D-06) — the `c`-attach lane's UI.
 *
 * Renders an "Attach to a Group" picker over `useGroups()`; selecting a Group appends its
 * coordinate to the dataset's `c` refs (the `setActiveDatasetContextRefs` store action that
 * `usePublishing` exposes), writing the `c` tag on the 37515 dataset (GROUP-02).
 *
 * For a `schema` Group it runs the OFF-THREAD advisory validation (`filterForeignAttachment` /
 * `validateSchema` through `@/lib/group`, never the in-thread legacy validator) and renders the
 * per-rule verdict as an AMBER `Alert variant="default"` (NOT destructive — a warning is not an
 * error) with dismissible lines, a "Checking against {Group}'s rules…" spinner while validating,
 * and a "couldn't check… shown unfiltered" line on worker failure.
 *
 * GROUP-04 HARD INVARIANT: the warnings NEVER disable the publish control. A prominent accent
 * "Publish anyway" affordance is ALWAYS enabled (its `disabled` is a pure function of the publish
 * action's own readiness — never of the validation verdict). There is no modal — the inline,
 * dismissible warnings are the confirmation (UI-SPEC: the button is the confirmation).
 */

import { Check, ChevronsUpDown, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { filterForeignAttachment } from '@/lib/group'
import { useGroups } from '@/lib/hooks/useGroups'
import type { Group } from '@/lib/nostr/group'
import { cn } from '@/lib/utils'
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from '@/components/ui/command'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'

/** One advisory, dismissible per-rule warning line. NEVER blocks publishing (GROUP-04). */
export interface GroupAttachWarning {
	id: string
	message: string
}

export interface GroupAttachFieldProps {
	/** The dataset's current `c` refs (Group coordinates) from the editor store. */
	contextRefs: string[]
	/** Store action that rewrites the dataset's `c` refs (the c-tag write, GROUP-02). */
	onContextRefsChange: (refs: string[]) => void
	/**
	 * The dataset's feature `properties` to validate against an attached `schema` Group.
	 * Passing fresh values on feature edits re-runs the off-thread advisory check.
	 */
	featureProperties: Array<Record<string, unknown> | undefined>
	/** The publish action this field's "Publish anyway" triggers. */
	onPublish: () => void | Promise<void>
	/**
	 * Whether publishing is currently possible (features present, signer ready, etc.).
	 * This is the ONLY input to the publish control's `disabled` — the validation verdict
	 * is intentionally absent (GROUP-04).
	 */
	canPublish: boolean
	/** True while a publish is in flight. */
	isPublishing?: boolean
	/** Publish button copy when no Group is attached (defaults to "Publish"). */
	publishLabel?: string
}

export function GroupAttachField({
	contextRefs,
	onContextRefsChange,
	featureProperties,
	onPublish,
	canPublish,
	isPublishing = false,
	publishLabel = 'Publish',
}: GroupAttachFieldProps) {
	const { events: groups } = useGroups()
	const [open, setOpen] = useState(false)
	const [checking, setChecking] = useState(false)
	const [workerFailed, setWorkerFailed] = useState(false)
	const [warnings, setWarnings] = useState<GroupAttachWarning[]>([])
	// Per-line dismissals (the warnings themselves stay advisory; dismissal is purely cosmetic).
	const [dismissed, setDismissed] = useState<Set<string>>(new Set())

	const groupByCoordinate = useMemo(() => {
		const map = new Map<string, Group>()
		for (const group of groups) {
			const coordinate = group.groupCoordinate
			if (coordinate) map.set(coordinate, group)
		}
		return map
	}, [groups])

	/** The Groups this dataset is currently `c`-attached to. */
	const attachedGroups = useMemo(
		() =>
			contextRefs
				.map((ref) => groupByCoordinate.get(ref))
				.filter((group): group is Group => Boolean(group)),
		[contextRefs, groupByCoordinate],
	)

	/** The first attached `schema` Group with a schema — the advisory validation target. */
	const attachedSchemaGroup = useMemo(
		() =>
			attachedGroups.find(
				(group) => group.group.governance === 'schema' && Boolean(group.group.schema),
			) ?? null,
		[attachedGroups],
	)

	// Run the OFF-THREAD advisory validation whenever the attached schema Group or the dataset's
	// feature properties change. Gating runs EXCLUSIVELY through `filterForeignAttachment`
	// (the Phase-8 `validateSchema` worker) — never the in-thread legacy validator. The
	// result is ADVISORY: it flows to local warning state and NEVER disables publish (GROUP-04).
	useEffect(() => {
		const group = attachedSchemaGroup
		const schema = group?.group.schema
		if (!group || !schema) {
			setChecking(false)
			setWorkerFailed(false)
			setWarnings([])
			return
		}

		let cancelled = false
		setChecking(true)
		setWorkerFailed(false)
		const publishedHash = group.schemaHash ?? undefined
		const schemaHash = group.schemaHash ?? 'sha256:unhashed'

		;(async () => {
			try {
				const collected: GroupAttachWarning[] = []
				const seen = new Set<string>()
				let failed = false
				for (let i = 0; i < featureProperties.length; i++) {
					// `warn` mode SHOWS the attachment with a legible reason — exactly the advisory
					// posture the contributor needs (never a strict hide on the publish path).
					const verdict = await filterForeignAttachment(
						'warn',
						schema,
						featureProperties[i] ?? {},
						{ schemaHash, publishedHash },
					)
					if (verdict.reason) {
						if (verdict.reason === 'Attachment could not be checked against the schema') {
							failed = true
							continue
						}
						const id = `${i}-${verdict.reason}`
						if (!seen.has(verdict.reason)) {
							seen.add(verdict.reason)
							collected.push({ id, message: `${verdict.reason}.` })
						}
					}
				}
				if (cancelled) return
				setWorkerFailed(failed && collected.length === 0)
				setWarnings(collected)
			} catch {
				// Fail OPEN for legibility only — the worker's timeout-kill is the real DoS guard;
				// publish stays enabled (the dataset is a valid standalone 37515 regardless).
				if (cancelled) return
				setWorkerFailed(true)
				setWarnings([])
			} finally {
				if (!cancelled) setChecking(false)
			}
		})()

		return () => {
			cancelled = true
		}
	}, [attachedSchemaGroup, featureProperties])

	const handleSelect = (group: Group) => {
		const coordinate = group.groupCoordinate
		if (!coordinate) return
		setOpen(false)
		if (contextRefs.includes(coordinate)) return
		onContextRefsChange([...contextRefs, coordinate])
		setDismissed(new Set())
	}

	const handleDetach = (coordinate: string) => {
		const next = contextRefs.filter((ref) => ref !== coordinate)
		onContextRefsChange(next)
		setDismissed(new Set())
	}

	const handleDismissWarning = (warning: GroupAttachWarning) => {
		setDismissed((prev) => {
			const next = new Set(prev)
			next.add(warning.id)
			return next
		})
	}

	const visibleWarnings = warnings.filter((warning) => !dismissed.has(warning.id))
	const hasAttachedGroups = attachedGroups.length > 0
	const schemaGroupName = attachedSchemaGroup?.group.name || 'the Group'
	// "Publish anyway" copy applies whenever a Group is attached (the contributor is
	// overriding the advisory warnings); otherwise the normal publish label.
	const resolvedPublishLabel = hasAttachedGroups ? 'Publish anyway' : publishLabel

	return (
		<div className="space-y-2">
			{/* ── Attach-to-a-Group picker ─────────────────────────────────────── */}
			<div className="space-y-2">
				<Popover open={open} onOpenChange={setOpen}>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="outline"
							aria-haspopup="listbox"
							aria-expanded={open}
							className="h-8 w-full justify-between rounded-none text-[13px] font-normal"
						>
							<span className="truncate text-muted-foreground">Attach to a Group</span>
							<ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
						</Button>
					</PopoverTrigger>
					<PopoverContent
						className="w-[var(--radix-popover-trigger-width)] rounded-none p-0"
						align="start"
					>
						<Command>
							<CommandInput placeholder="Search Groups…" className="text-[13px]" />
							<CommandList>
								<CommandEmpty className="py-4 text-center text-[13px] text-muted-foreground">
									No Groups found.
								</CommandEmpty>
								<CommandGroup>
									{groups.map((group) => {
										const coordinate = group.groupCoordinate
										const isAttached = coordinate ? contextRefs.includes(coordinate) : false
										return (
											<CommandItem
												key={coordinate ?? group.id}
												value={`${group.group.name} ${coordinate ?? ''}`}
												onSelect={() => handleSelect(group)}
												className="gap-2 rounded-none text-[13px]"
											>
												<Check
													className={cn(
														'size-3.5 shrink-0',
														isAttached ? 'opacity-100' : 'opacity-0',
													)}
												/>
												<span className="truncate">{group.group.name || 'Untitled Group'}</span>
												<span className="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground">
													{group.group.governance}
												</span>
											</CommandItem>
										)
									})}
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>

				{/* Attached-Group chips with detach */}
				{hasAttachedGroups && (
					<div className="flex flex-wrap gap-1">
						{attachedGroups.map((group) => {
							const coordinate = group.groupCoordinate
							if (!coordinate) return null
							return (
								<span
									key={coordinate}
									className="inline-flex items-center gap-1 border border-border px-2 py-0.5 text-[11px] text-foreground"
								>
									{group.group.name || 'Untitled Group'}
									<button
										type="button"
										onClick={() => handleDetach(coordinate)}
										aria-label={`Detach from ${group.group.name || 'Group'}`}
										className="text-muted-foreground hover:text-foreground"
									>
										<X className="size-3" />
									</button>
								</span>
							)
						})}
					</div>
				)}
			</div>

			{/* ── Off-thread advisory validation feedback ──────────────────────── */}
			{checking && (
				<div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
					<Spinner className="size-3.5" />
					Checking against {schemaGroupName}'s rules…
				</div>
			)}

			{!checking && workerFailed && (
				<Alert
					variant="default"
					className="border-l-2 border-l-amber-500 text-amber-700 dark:text-amber-400"
				>
					<AlertDescription className="text-amber-700 dark:text-amber-400">
						Couldn't check this contribution right now. It's shown unfiltered.
					</AlertDescription>
				</Alert>
			)}

			{!checking && visibleWarnings.length > 0 && (
				<Alert
					variant="default"
					className="border-l-2 border-l-amber-500 text-amber-700 dark:text-amber-400"
				>
					<AlertTitle className="text-amber-700 dark:text-amber-400">
						This dataset doesn't match {schemaGroupName}'s rules
					</AlertTitle>
					<AlertDescription className="text-amber-700 dark:text-amber-400">
						<ul className="mt-1 space-y-1">
							{visibleWarnings.map((warning) => (
								<li key={warning.id} className="flex items-start justify-between gap-2">
									<span>{warning.message}</span>
									<button
										type="button"
										onClick={() => handleDismissWarning(warning)}
										aria-label="Dismiss warning"
										className="shrink-0 text-amber-700/70 hover:text-amber-700 dark:text-amber-400/70 dark:hover:text-amber-400"
									>
										<X className="size-3" />
									</button>
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			)}

			{/* ── Publish control — NEVER disabled by the validation verdict (GROUP-04) ── */}
			<Button
				type="button"
				onClick={() => void onPublish()}
				disabled={!canPublish || isPublishing}
				className="h-8 w-full rounded-none bg-primary text-[13px] text-primary-foreground hover:bg-primary/90"
			>
				{isPublishing ? 'Publishing…' : resolvedPublishLabel}
			</Button>
		</div>
	)
}
