/**
 * BeaconControlPanel — the author-facing Start-beacon control surface for a
 * kind-37521 Live Beacon (Phase 12, BEACON-01/02, D-03/D-05/D-06/D-10). The
 * structural twin of `SightingEditorPanel`, cloned for its shell + the
 * ExpiryPreset/`resolveExpiration` time-box machinery — but a beacon has NO
 * pin-drop (position comes from GPS via `useBeaconPublisher`), so the
 * `placedGeometry`/`onDrawArea` props and the "Drop a pin" guard are DROPPED.
 *
 * Four single-column form blocks (`space-y-6`):
 *   1. TIME BOX (D-03) — a 2×2 RadioGroup preset grid (15 min / 1 hour / 4 hours
 *      / 8 hours, "1 hour" pre-selected) + a Custom… minutes input. The chosen TTL
 *      drives the NIP-40 `expiration`.
 *   2. VISIBILITY (D-10) — Public / Link only, asked EVERY Start (no sticky
 *      default). Selecting Link only reveals the non-dismissible "unlisted, not
 *      private" honesty caveat inline (T-12-05-LINKHONESTY).
 *   3. IDENTITY (D-05) — Anonymous (default throwaway key) / My account opt-in.
 *      Choosing My account swaps the consent to the stronger-weighted copy
 *      (T-12-05-DEANON).
 *   4. CONSENT + START (D-06) — the no-delete consent copy sits directly above an
 *      accent `h-12` "Start beacon" button. Pressing Start IS the consent
 *      (T-12-05-NODELETE). A permission gate disables Start with the permission
 *      copy when geolocation is not granted.
 *
 * The panel is presentational: it calls `onStart({ content:{label}, expiration,
 * visibility, identity })`; the controller wires that to `useBeaconPublisher`.
 * All copy renders as escaped React text nodes — NO `dangerouslySetInnerHTML`
 * (T-12-05-XSS).
 */

import { useEffect, useMemo, useState } from 'react'
import {
	EntityPanelSectionHeader,
	EntityPanelShell,
	EntityPanelSurface,
} from '@/components/info-panel/EntityPanelShell'
import { Button } from '@/components/ui/button'
import {
	MobilePanelHeaderActions,
	useMobilePanelHeaderActionTarget,
} from '@/features/geo-editor/components/MobilePanelHeaderAction'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'
import type { BeaconVisibility } from '@/lib/nostr/live-beacon'

/** Caller's choice of signing identity (D-05). */
export type BeaconIdentityChoice = 'anonymous' | 'my-account'

/** Time-box preset (D-03). The TTL is in seconds; `custom` reads the minutes input. */
type TimeBoxPreset = '15m' | '1h' | '4h' | '8h' | 'custom'

const TIME_BOX_PRESETS: { value: TimeBoxPreset; label: string; ttlSeconds: number | null }[] = [
	{ value: '15m', label: '15 min', ttlSeconds: 15 * 60 },
	{ value: '1h', label: '1 hour', ttlSeconds: 60 * 60 },
	{ value: '4h', label: '4 hours', ttlSeconds: 4 * 60 * 60 },
	{ value: '8h', label: '8 hours', ttlSeconds: 8 * 60 * 60 },
]

/** Default preset is the sensible mid "1 hour" (UI-SPEC § Time box). */
const DEFAULT_TIME_BOX_PRESET: TimeBoxPreset = '1h'

/** The non-dismissible link-only honesty caveat — verbatim from the UI-SPEC. */
const LINK_ONLY_CAVEAT =
	"Link-only means unlisted, not private. Your location is still published unencrypted to public relays and could be found by someone scraping them. It's time-boxed and uses a throwaway identity, so it can't be tied to your account — but don't treat it as secret."

/** The no-delete consent at Start (D-06) — verbatim. */
const CONSENT_DEFAULT =
	"Heads up: each position you share is published to public relays and can't be deleted. It disappears on its own when your time runs out — but until then, it's public."

/** The stronger-weighted consent when My account identity is chosen (D-05/D-06) — verbatim. */
const CONSENT_MY_ACCOUNT =
	"Because you're sharing under your own account, this live trail is tied to your identity until it expires. Consider Anonymous if you'd rather it not be."

/** The permission copy shown when geolocation is not granted (Start disabled). */
const PERMISSION_COPY =
	'Earthly needs location access to share a beacon. Turn it on in your browser settings, then try again.'

export interface BeaconStartOptions {
	content: { label?: string }
	/** NIP-40 expiry timestamp (epoch seconds, UTC). Undefined ⇒ never (not offered here). */
	expiration?: number
	visibility: BeaconVisibility
	identity: BeaconIdentityChoice
}

interface BeaconControlPanelProps {
	/** Adjust mode: pre-fill from an existing live session. Absent ⇒ a fresh Start. */
	initialLabel?: string
	initialVisibility?: BeaconVisibility
	initialIdentity?: BeaconIdentityChoice
	/** True when the panel is editing an existing session (changes the title + submit copy). */
	isAdjusting?: boolean
	/**
	 * Whether geolocation permission is granted. When false, Start is disabled and
	 * the permission copy shows. `undefined` ⇒ unknown/prompt (Start enabled; the
	 * browser prompt fires on Start).
	 */
	permissionGranted?: boolean
	/** True while the publisher is starting (Start → "Starting…"). */
	isStarting?: boolean
	onStart: (options: BeaconStartOptions) => void
	onClose: () => void
}

export function BeaconControlPanel({
	initialLabel,
	initialVisibility,
	initialIdentity,
	isAdjusting = false,
	permissionGranted,
	isStarting = false,
	onStart,
	onClose,
}: BeaconControlPanelProps) {
	const mobileHeaderActionTarget = useMobilePanelHeaderActionTarget()
	const [label, setLabel] = useState(initialLabel ?? '')
	const [timeBoxPreset, setTimeBoxPreset] = useState<TimeBoxPreset>(DEFAULT_TIME_BOX_PRESET)
	const [customMinutes, setCustomMinutes] = useState<string>('')
	// Visibility is asked EVERY Start (no sticky default, D-10). Adjust pre-fills it.
	const [visibility, setVisibility] = useState<BeaconVisibility | ''>(initialVisibility ?? '')
	const [identity, setIdentity] = useState<BeaconIdentityChoice>(initialIdentity ?? 'anonymous')

	// Re-seed when the adjusted session changes.
	useEffect(() => {
		setLabel(initialLabel ?? '')
		setVisibility(initialVisibility ?? '')
		setIdentity(initialIdentity ?? 'anonymous')
		setTimeBoxPreset(DEFAULT_TIME_BOX_PRESET)
		setCustomMinutes('')
	}, [initialLabel, initialVisibility, initialIdentity])

	/** Resolve the NIP-40 expiration epoch (seconds) from the selected preset. */
	const resolveExpiration = (): number | undefined => {
		if (timeBoxPreset === 'custom') {
			const minutes = Number(customMinutes)
			if (!Number.isFinite(minutes) || minutes <= 0) return undefined
			return Math.floor(Date.now() / 1000) + Math.round(minutes * 60)
		}
		const preset = TIME_BOX_PRESETS.find((option) => option.value === timeBoxPreset)
		if (!preset?.ttlSeconds) return undefined
		return Math.floor(Date.now() / 1000) + preset.ttlSeconds
	}

	const customMinutesValid = useMemo(() => {
		if (timeBoxPreset !== 'custom') return true
		const minutes = Number(customMinutes)
		return Number.isFinite(minutes) && minutes > 0
	}, [timeBoxPreset, customMinutes])

	const permissionBlocked = permissionGranted === false
	const visibilityChosen = visibility === 'public' || visibility === 'link-only'
	const canStart = visibilityChosen && customMinutesValid && !permissionBlocked && !isStarting

	const handleStart = () => {
		if (!visibilityChosen || !canStart) return
		onStart({
			content: { label: label.trim() || undefined },
			expiration: resolveExpiration(),
			visibility,
			identity,
		})
	}

	return (
		<EntityPanelShell title={isAdjusting ? 'Adjust your beacon' : 'Share your live location'}>
			<MobilePanelHeaderActions>
				<div className="flex items-center gap-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" size="sm" onClick={handleStart} disabled={!canStart}>
						{isStarting ? 'Starting…' : isAdjusting ? 'Update' : 'Start beacon'}
					</Button>
				</div>
			</MobilePanelHeaderActions>
			<EntityPanelSurface tone="context" className="space-y-6">
				<EntityPanelSectionHeader
					eyebrow="Beacon"
					title="Share your live location"
					description="A live dot on the map that follows you and disappears on its own when your time runs out."
				/>

				<div className="space-y-2">
					<Label htmlFor="beacon-label">Label (optional)</Label>
					<Input
						id="beacon-label"
						value={label}
						onChange={(event) => setLabel(event.target.value)}
						placeholder="e.g. Bike courier — live"
						className="rounded-none"
					/>
				</div>

				{/* ── 1. TIME BOX (D-03) — 2×2 preset grid, "1 hour" pre-selected ── */}
				<div className="space-y-2">
					<Label>How long?</Label>
					<RadioGroup
						value={timeBoxPreset}
						onValueChange={(value) => setTimeBoxPreset(value as TimeBoxPreset)}
						className="grid grid-cols-2 gap-2"
					>
						{TIME_BOX_PRESETS.map((preset) => {
							const selected = timeBoxPreset === preset.value
							return (
								<label
									key={preset.value}
									htmlFor={`timebox-${preset.value}`}
									className={cn(
										'flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm',
										selected ? 'border-primary ring-1 ring-primary' : 'border-border',
									)}
								>
									<RadioGroupItem id={`timebox-${preset.value}`} value={preset.value} />
									<span>{preset.label}</span>
								</label>
							)
						})}
						<label
							htmlFor="timebox-custom"
							className={cn(
								'col-span-2 flex min-h-11 cursor-pointer items-center gap-2 border px-3 text-sm',
								timeBoxPreset === 'custom' ? 'border-primary ring-1 ring-primary' : 'border-border',
							)}
						>
							<RadioGroupItem id="timebox-custom" value="custom" />
							<span>Custom…</span>
						</label>
					</RadioGroup>
					{timeBoxPreset === 'custom' ? (
						<Input
							type="number"
							min={1}
							value={customMinutes}
							onChange={(event) => setCustomMinutes(event.target.value)}
							placeholder="Minutes"
							className="rounded-none"
						/>
					) : null}
					<p className="text-xs text-muted-foreground">
						Your beacon automatically stops and disappears after this.
					</p>
				</div>

				{/* ── 2. VISIBILITY (D-10) — asked every Start, no sticky default ── */}
				<div className="space-y-2">
					<Label>Who can see it?</Label>
					<RadioGroup
						value={visibility}
						onValueChange={(value) => setVisibility(value as BeaconVisibility)}
						className="gap-2"
					>
						<label
							htmlFor="visibility-public"
							className={cn(
								'flex cursor-pointer flex-col gap-1 border px-3 py-2 text-sm',
								visibility === 'public' ? 'border-primary ring-1 ring-primary' : 'border-border',
							)}
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem id="visibility-public" value="public" />
								<span className="font-semibold">Public</span>
							</div>
							<span className="pl-6 text-xs text-muted-foreground">
								Shows up for people browsing nearby beacons.
							</span>
						</label>
						<label
							htmlFor="visibility-link-only"
							className={cn(
								'flex cursor-pointer flex-col gap-1 border px-3 py-2 text-sm',
								visibility === 'link-only' ? 'border-primary ring-1 ring-primary' : 'border-border',
							)}
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem id="visibility-link-only" value="link-only" />
								<span className="font-semibold">Link only</span>
							</div>
							<span className="pl-6 text-xs text-muted-foreground">
								Only people you send the link to can find it.
							</span>
						</label>
					</RadioGroup>
					{/* Non-dismissible honesty caveat — always visible once link-only is chosen
					    (T-12-05-LINKHONESTY; not a tooltip, not an accordion). */}
					{visibility === 'link-only' ? (
						<p className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-foreground">
							{LINK_ONLY_CAVEAT}
						</p>
					) : null}
				</div>

				{/* ── 3. IDENTITY (D-05) — Anonymous default / My account opt-in ── */}
				<div className="space-y-2">
					<Label>Share as</Label>
					<RadioGroup
						value={identity}
						onValueChange={(value) => setIdentity(value as BeaconIdentityChoice)}
						className="gap-2"
					>
						<label
							htmlFor="identity-anonymous"
							className={cn(
								'flex cursor-pointer flex-col gap-1 border px-3 py-2 text-sm',
								identity === 'anonymous' ? 'border-primary ring-1 ring-primary' : 'border-border',
							)}
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem id="identity-anonymous" value="anonymous" />
								<span className="font-semibold">Anonymous</span>
							</div>
							<span className="pl-6 text-xs text-muted-foreground">
								A fresh throwaway identity for this session. Can't be linked to your account or to
								other beacons you share.
							</span>
						</label>
						<label
							htmlFor="identity-my-account"
							className={cn(
								'flex cursor-pointer flex-col gap-1 border px-3 py-2 text-sm',
								identity === 'my-account' ? 'border-primary ring-1 ring-primary' : 'border-border',
							)}
						>
							<div className="flex items-center gap-2">
								<RadioGroupItem id="identity-my-account" value="my-account" />
								<span className="font-semibold">My account</span>
							</div>
							<span className="pl-6 text-xs text-muted-foreground">
								Published under your Nostr identity. People can see this came from you.
							</span>
						</label>
					</RadioGroup>
				</div>

				{/* ── 4. CONSENT + START (D-06) — pressing Start IS the consent ── */}
				<div className="space-y-3">
					<p className="text-sm text-foreground">
						{identity === 'my-account' ? CONSENT_MY_ACCOUNT : CONSENT_DEFAULT}
					</p>
					{permissionBlocked ? <p className="text-xs text-destructive">{PERMISSION_COPY}</p> : null}
					{!mobileHeaderActionTarget ? (
						<>
							<Button
								type="button"
								onClick={handleStart}
								disabled={!canStart}
								className="h-12 w-full rounded-none bg-primary text-primary-foreground"
							>
								{isStarting ? 'Starting…' : 'Start beacon'}
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={onClose}
								className="w-full rounded-none"
							>
								Cancel
							</Button>
						</>
					) : null}
				</div>
			</EntityPanelSurface>
		</EntityPanelShell>
	)
}
