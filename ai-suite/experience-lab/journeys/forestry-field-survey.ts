import { defineJourney } from '../model'

export const forestryFieldSurveyJourney = defineJourney({
	id: 'forestry-field-survey',
	title: 'Plan and execute a forestry field survey',
	evidenceLevel: 'hypothetical',
	jobStory:
		'When a planner sends authoritative geometry into the field, the crew should work nearby and return observations without publication ambiguity.',
	actors: [
		{ personaId: 'forestry-planner', role: 'planner and field-session host' },
		{ personaId: 'field-crew-member', role: 'participant and observation author' },
	],
	intentLanes: ['build', 'coordinate', 'capture'],
	startingState: [
		'Planner has survey geometry on desktop.',
		'Crew has Earthly installed on Android but no active Field session.',
	],
	conditions: {
		platforms: ['desktop-web', 'android'],
		connectivity: ['Nearby Wi-Fi remains available while internet connectivity is intermittent.'],
		publishChannel: 'field-session',
		seededData: ['Survey boundary, work areas, and one known observation.'],
	},
	taskPrompt:
		'Prepare the survey, share it through a Field session, add a crew observation while internet is unavailable, verify peer delivery, leave the session, and begin unrelated public work.',
	primaryOutcome:
		'Planner and crew share the same field result without silently publishing it globally.',
	proof: [
		'Crew sees assigned geometry.',
		'Allowed peer writes reach the session.',
		'Destination remains Nearby.',
	],
	understandingChecks: [
		'Both actors can distinguish nearby delivery from later global publication.',
		'Host and participant roles are visible.',
	],
	recoveryBranches: [
		{
			trigger: 'Join or pairing is interrupted.',
			success: 'The crew can retry without duplicate sessions.',
		},
		{
			trigger: 'Crew cancels a drawing and leaves the session.',
			success: 'Panning recovers and saved work is not retargeted to Public.',
		},
	],
	followUpTask: 'Crew begins a public capture while the planner returns to desktop analysis.',
	capabilities: [
		'author-geometry',
		'share',
		'join',
		'destination',
		'offline',
		'synchronize',
		'capture',
		'recover',
		'resume',
		'transition',
	],
	parityExpectation:
		'Browser owns planning and multi-persona orchestration; Android owns native links, transport, permissions, resume, and process lifecycle.',
	automationLevel: 'experience-audit',
	knownGaps: [
		'The experience audit covers the browser/native handoff and an Android-shaped host surface, not real Wi-Fi transport.',
		'Pairing, participant writes, fan-out, reconnect, and process lifecycle still require Android and physical-device evidence.',
	],
	tags: ['desktop', 'android', 'field-session', 'offline', 'first-cohort'],
})
