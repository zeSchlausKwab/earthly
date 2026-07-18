export interface AndroidTaskDefinition {
	id: string
	description: string
}

export interface AndroidScenarioDefinition {
	id: string
	description: string
	tasks: string[]
}

export const androidTasks: AndroidTaskDefinition[] = [
	{
		id: 'app.open-link',
		description: 'Open a verified earthly.city route directly in the Android app.',
	},
	{
		id: 'surface.await-visible',
		description: 'Wait for a user-visible Android accessibility label.',
	},
	{
		id: 'surface.assert-stable',
		description: 'Continuously check a surface and the absence of the runtime-error overlay.',
	},
]

export const androidScenarios: AndroidScenarioDefinition[] = [
	{
		id: 'smoke.workspace-app-links',
		description:
			'Open Field sessions, Private groups, and Local drafts through consecutive cold/warm App Links and verify every surface remains stable.',
		tasks: ['app.open-link', 'surface.await-visible', 'surface.assert-stable'],
	},
]

export function catalogMarkdown(): string {
	return [
		'# Earthly Android E2E catalog',
		'',
		'## Tasks',
		'',
		...androidTasks.map((task) => `- \`${task.id}\` — ${task.description}`),
		'',
		'## Scenarios',
		'',
		...androidScenarios.flatMap((scenario) => [
			`- \`${scenario.id}\` — ${scenario.description}`,
			`  - Tasks: ${scenario.tasks.map((task) => `\`${task}\``).join(', ')}`,
		]),
	].join('\n')
}

if (import.meta.main) console.log(catalogMarkdown())
