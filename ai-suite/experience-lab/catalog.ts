import { casualWildlifeObserver } from './personas/casual-wildlife-observer'
import { eventOrganizer } from './personas/event-organizer'
import { eventVisitor } from './personas/event-visitor'
import { fieldCrewMember } from './personas/field-crew-member'
import { forestryPlanner } from './personas/forestry-planner'
import { spatialDataAnalyst } from './personas/spatial-data-analyst'
import { curiousMapExplorer } from './personas/curious-map-explorer'
import { deliveryDispatcher } from './personas/delivery-dispatcher'
import { deliveryDriver } from './personas/delivery-driver'
import { eventVenueMapJourney } from './journeys/event-venue-map'
import { forestryFieldSurveyJourney } from './journeys/forestry-field-survey'
import { squirrelCaptureJourney } from './journeys/squirrel-capture'
import { conversationalSpatialResearchJourney } from './journeys/conversational-spatial-research'
import { conversationalNearbyDiscoveryJourney } from './journeys/conversational-nearby-discovery'
import { aiAssistedDeliveryHandoffJourney } from './journeys/ai-assisted-delivery-handoff'
import { accessibilityLens } from './lenses/accessibility'
import { platformParityLens } from './lenses/platform-parity'
import { privacyDestinationLens } from './lenses/privacy-destination'
import { productComplexityLens } from './lenses/product-complexity'
import {
	assertValidExperienceCatalog,
	type ExperienceCatalog,
	type ExperiencePersona,
	type JourneyDefinition,
} from './model'

export const experienceCatalog = {
	personas: [
		casualWildlifeObserver,
		eventOrganizer,
		eventVisitor,
		forestryPlanner,
		fieldCrewMember,
		spatialDataAnalyst,
		curiousMapExplorer,
		deliveryDispatcher,
		deliveryDriver,
	],
	journeys: [
		squirrelCaptureJourney,
		eventVenueMapJourney,
		forestryFieldSurveyJourney,
		conversationalSpatialResearchJourney,
		conversationalNearbyDiscoveryJourney,
		aiAssistedDeliveryHandoffJourney,
	],
	lenses: [accessibilityLens, privacyDestinationLens, platformParityLens, productComplexityLens],
} as const satisfies ExperienceCatalog

assertValidExperienceCatalog(experienceCatalog)

export function getExperiencePersona(id: string): ExperiencePersona {
	const persona = experienceCatalog.personas.find((candidate) => candidate.id === id)
	if (!persona) throw new Error(`Unknown experience persona: ${id}`)
	return persona
}

export function getJourney(id: string): JourneyDefinition {
	const journey = experienceCatalog.journeys.find((candidate) => candidate.id === id)
	if (!journey) throw new Error(`Unknown Earthly journey: ${id}`)
	return journey
}

export function experienceCatalogMarkdown(): string {
	return [
		'# Earthly Journey Lab catalog',
		'',
		'## Experience personas',
		'',
		...experienceCatalog.personas.flatMap((persona) => [
			`- \`${persona.id}\` — ${persona.name} (${persona.evidenceLevel})`,
			`  - Job: ${persona.jobStory}`,
			`  - Primary platform: ${persona.platforms.primary}`,
			`  - Journeys: ${persona.journeyIds.map((id) => `\`${id}\``).join(', ')}`,
		]),
		'',
		'## Journeys',
		'',
		...experienceCatalog.journeys.flatMap((journey) => [
			`- \`${journey.id}\` — ${journey.title} (${journey.automationLevel})`,
			`  - Actors: ${journey.actors.map((actor) => `${actor.personaId} (${actor.role})`).join(', ')}`,
			`  - Platforms: ${journey.conditions.platforms.join(', ')}`,
			`  - Capabilities: ${journey.capabilities.join(', ')}`,
		]),
		'',
		'## Review lenses',
		'',
		...experienceCatalog.lenses.map((lens) => `- \`${lens.id}\` — ${lens.name}`),
	].join('\n')
}

if (import.meta.main) {
	const formatIndex = process.argv.indexOf('--format')
	const format = formatIndex >= 0 ? process.argv[formatIndex + 1] : 'markdown'
	if (format !== 'markdown' && format !== 'json') {
		throw new Error('--format must be markdown or json')
	}
	console.log(
		format === 'json' ? JSON.stringify(experienceCatalog, null, 2) : experienceCatalogMarkdown(),
	)
}
