export type NonEmptyArray<T> = readonly [T, ...T[]]

export const evidenceLevels = [
	'hypothetical',
	'stakeholder-informed',
	'user-observed',
	'repeatedly-validated',
] as const
export type EvidenceLevel = (typeof evidenceLevels)[number]

export type Sophistication = 'novice' | 'basic' | 'intermediate' | 'expert'
export type PatienceLevel = 'very-low' | 'low' | 'moderate' | 'high'
export type ExperiencePlatform = 'desktop-web' | 'mobile-web' | 'android'
export type IntentLane = 'explore' | 'capture' | 'coordinate' | 'build' | 'analyze'
export type AutomationLevel = 'exploratory' | 'experience-audit' | 'product-contract'
export type PublishChannel = 'public' | 'private-group' | 'field-session' | 'not-applicable'

export type Capability =
	| 'identity'
	| 'discover'
	| 'capture'
	| 'author-geometry'
	| 'media'
	| 'location'
	| 'inspect'
	| 'organize'
	| 'attach'
	| 'share'
	| 'join'
	| 'publish'
	| 'destination'
	| 'synchronize'
	| 'offline'
	| 'recover'
	| 'resume'
	| 'transition'

export interface ExperiencePersona {
	id: string
	name: string
	evidenceLevel: EvidenceLevel
	jobStory: string
	sophistication: {
		domain: Sophistication
		earthly: Sophistication
	}
	patience: {
		level: PatienceLevel
		abandonmentTriggers: NonEmptyArray<string>
	}
	platforms: {
		primary: ExperiencePlatform
		secondary: readonly ExperiencePlatform[]
	}
	constraints: {
		connectivity: NonEmptyArray<string>
		privacy: NonEmptyArray<string>
		trust: NonEmptyArray<string>
		accessibility: readonly string[]
		environment: NonEmptyArray<string>
	}
	vocabulary: {
		familiar: NonEmptyArray<string>
		confusing: NonEmptyArray<string>
	}
	likelyMistakes: NonEmptyArray<string>
	recoveryBehavior: NonEmptyArray<string>
	journeyIds: NonEmptyArray<string>
}

export interface JourneyActor {
	personaId: string
	role: string
}

export interface RecoveryBranch {
	trigger: string
	success: string
}

export interface JourneyDefinition {
	id: string
	title: string
	evidenceLevel: EvidenceLevel
	jobStory: string
	actors: NonEmptyArray<JourneyActor>
	intentLanes: NonEmptyArray<IntentLane>
	startingState: NonEmptyArray<string>
	conditions: {
		platforms: NonEmptyArray<ExperiencePlatform>
		connectivity: NonEmptyArray<string>
		publishChannel: PublishChannel
		seededData: readonly string[]
	}
	taskPrompt: string
	primaryOutcome: string
	proof: NonEmptyArray<string>
	understandingChecks: NonEmptyArray<string>
	recoveryBranches: NonEmptyArray<RecoveryBranch>
	followUpTask: string
	capabilities: NonEmptyArray<Capability>
	parityExpectation: string
	automationLevel: AutomationLevel
	knownGaps: readonly string[]
	tags: NonEmptyArray<string>
}

export type ReviewLensId =
	| 'accessibility'
	| 'privacy-destination'
	| 'platform-parity'
	| 'product-complexity'

export interface ReviewLens {
	id: ReviewLensId
	name: string
	questions: NonEmptyArray<string>
}

export const rubricDimensions = [
	'entry',
	'completion',
	'decisions',
	'vocabulary',
	'destination',
	'recovery',
	'continuation',
	'return',
	'parity',
	'confidence',
] as const
export type RubricDimension = (typeof rubricDimensions)[number]
export type RubricScore = 0 | 1 | 2 | 3

export interface RubricAssessment {
	dimension: RubricDimension
	score: RubricScore
	explanation: string
}

export interface ScenarioRunDefinition {
	id: string
	personaId: string
	journeyId: string
	platform: ExperiencePlatform
	connectivity: string
	publishChannel: PublishChannel
	startingState: NonEmptyArray<string>
	reviewLensIds: NonEmptyArray<ReviewLensId>
}

export type FindingSeverity = 'blocker' | 'serious-friction' | 'confusion' | 'opportunity'
export type FindingDisposition = 'investigate' | 'experiment' | 'contract' | 'defer' | 'reject'

export interface ExperienceFinding {
	id: string
	title: string
	personaId: string
	journeyId: string
	step: string
	platform: ExperiencePlatform
	startingConditions: NonEmptyArray<string>
	observation: string
	severity: FindingSeverity
	evidenceLevel: EvidenceLevel
	evidence: NonEmptyArray<string>
	capabilities: NonEmptyArray<Capability>
	relatedJourneyIds: readonly string[]
	complexityCost: string
	proposedExperiment?: string
	disposition: FindingDisposition
}

export interface ExperienceCatalog {
	personas: readonly ExperiencePersona[]
	journeys: readonly JourneyDefinition[]
	lenses: readonly ReviewLens[]
}

export function defineExperiencePersona<const T extends ExperiencePersona>(persona: T): T {
	return persona
}

export function defineJourney<const T extends JourneyDefinition>(journey: T): T {
	return journey
}

export function defineReviewLens<const T extends ReviewLens>(lens: T): T {
	return lens
}

export function validateExperienceCatalog(catalog: ExperienceCatalog): string[] {
	const errors: string[] = []
	const personaIds = new Set<string>()
	const journeyIds = new Set<string>()

	for (const persona of catalog.personas) {
		if (personaIds.has(persona.id)) errors.push(`Duplicate experience persona: ${persona.id}`)
		personaIds.add(persona.id)
	}
	for (const journey of catalog.journeys) {
		if (journeyIds.has(journey.id)) errors.push(`Duplicate journey: ${journey.id}`)
		journeyIds.add(journey.id)
	}

	for (const persona of catalog.personas) {
		for (const journeyId of persona.journeyIds) {
			if (!journeyIds.has(journeyId)) {
				errors.push(`Persona ${persona.id} references missing journey ${journeyId}`)
			}
		}
	}
	for (const journey of catalog.journeys) {
		for (const actor of journey.actors) {
			if (!personaIds.has(actor.personaId)) {
				errors.push(`Journey ${journey.id} references missing persona ${actor.personaId}`)
			}
		}

		if (!journey.followUpTask.trim()) errors.push(`Journey ${journey.id} has no follow-up task`)
		if (journey.recoveryBranches.length === 0) {
			errors.push(`Journey ${journey.id} has no recovery branch`)
		}
	}

	return errors
}

export function assertValidExperienceCatalog(catalog: ExperienceCatalog): void {
	const errors = validateExperienceCatalog(catalog)
	if (errors.length > 0)
		throw new Error(`Invalid Earthly experience catalog:\n- ${errors.join('\n- ')}`)
}
