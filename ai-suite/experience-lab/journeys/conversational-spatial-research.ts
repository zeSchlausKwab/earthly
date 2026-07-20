import { defineJourney } from '../model'

export const conversationalSpatialResearchJourney = defineJourney({
	id: 'conversational-spatial-research',
	title: 'Turn a spatial question into inspectable map data',
	evidenceLevel: 'hypothetical',
	jobStory:
		'Use conversation to prepare a spatial analysis while preserving the same review, correction, publication, and exit controls as manual authoring.',
	actors: [{ personaId: 'spatial-data-analyst', role: 'analyst and dataset author' }],
	intentLanes: ['analyze', 'build'],
	startingState: [
		'Analyst is signed in on desktop with no active Dataset draft.',
		'AI tools are enabled and every proposed edit requires confirmation.',
	],
	conditions: {
		platforms: ['desktop-web'],
		connectivity: ['Local deterministic model contract; live-model audit is separately opt-in.'],
		publishChannel: 'public',
		seededData: ['Synthetic trailheads and drinking-water results supplied by the model fixture.'],
	},
	taskPrompt:
		'Find public drinking-water points around the trailheads, create 15-minute walking catchments, review the proposed geometry, save it as a Dataset, close chat, start a new conversation, then begin an unrelated Story draft.',
	primaryOutcome:
		'The assistant produces ordinary Earthly geometry that the analyst explicitly approves, publishes, and leaves behind while moving through a new conversation into an unrelated authoring task.',
	proof: [
		'Tool use and the proposed diff are visible before mutation.',
		'Approved geometry exists in the canonical editor and publishes as a Dataset.',
		'Closing chat preserves the published map result.',
		'New conversation changes the transcript without retargeting the Dataset saved work.',
		'An unrelated Story parks Dataset editing while retaining the published Dataset map layer.',
	],
	understandingChecks: [
		'The analyst can distinguish assistant prose, proposed edits, and published data.',
		'The provider boundary and current authoring destination remain visible.',
		'The analyst can distinguish a new conversation from a new workspace or a new entity task.',
	],
	recoveryBranches: [
		{
			trigger: 'The proposed geometry is wrong.',
			success: 'Cancel or undo leaves the editor recoverable and a refined prompt can be sent.',
		},
		{
			trigger: 'The model stream stalls or chat is closed.',
			success: 'The analyst can stop the run and continue with ordinary editor controls.',
		},
		{
			trigger: 'The analyst finishes or pauses the Dataset and begins unrelated work.',
			success:
				'The new task makes retained chat, workspace, editor, and map state explicit rather than silently carrying it forward.',
		},
	],
	followUpTask:
		'Hide AI chat, inspect the published Dataset, create a new chat, then save an unrelated Story draft and identify which task state remains active.',
	capabilities: [
		'ai-assist',
		'discover',
		'author-geometry',
		'inspect',
		'organize',
		'publish',
		'recover',
		'transition',
	],
	parityExpectation:
		'Desktop is the primary analysis surface; any later mobile viewer must receive the same canonical Dataset rather than a chat-only artifact.',
	automationLevel: 'experience-audit',
	knownGaps: [
		'Deterministic model replay proves the OpenAI/tool/editor contract, not answer quality or real-world source correctness.',
		'Live-provider evaluation is opt-in and cannot use private or unpublished inputs by default.',
	],
	tags: ['desktop', 'ai-chat', 'tool-calling', 'second-cohort'],
})
