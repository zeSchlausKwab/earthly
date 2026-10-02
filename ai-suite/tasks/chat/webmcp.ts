import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { openPanel } from '../navigation/open-panel'
import { isLoopbackURL } from '../../core/environment'

export const setDesktopAgentAccessTask: AiTaskMetadata = {
	id: 'chat.desktop-agent-access',
	summary: 'Enable or disable WebMCP editor tools through Settings.',
	preconditions: ['Earthly is open in a browser with WebMCP enabled'],
	sideEffects: ['Opens Chat settings', 'Saves desktop agent access in this browser'],
	viewports: 'both',
}

export const executeWebMcpToolTask: AiTaskMetadata = {
	id: 'chat.execute-webmcp-tool',
	summary: 'Discover and execute an Earthly tool through the browser’s native WebMCP API.',
	preconditions: ['Desktop agent access is enabled', 'An editable Map is open for Map tools'],
	sideEffects: [
		'Local draft edits or isolated loopback publications, according to the discovered tool',
	],
	viewports: 'both',
}

export const setDesktopAgentSafetyTask: AiTaskMetadata = {
	id: 'chat.desktop-agent-edit-safety',
	summary: 'Choose the shared AI edit review policy through Desktop agent settings.',
	preconditions: ['Desktop agent access is enabled'],
	sideEffects: ['Changes the review policy shared with Earthly chat', 'Opens Chat settings'],
	viewports: 'both',
}

export async function setDesktopAgentSafety(
	earthly: EarthlySession,
	policy: 'Preview all changes' | 'Confirm edits and deletions' | 'Apply with Undo',
): Promise<void> {
	await setDesktopAgentAccess(earthly, true)
	const safety = earthly.page.getByRole('combobox', { name: 'AI edit safety', exact: true })
	await safety.click()
	await earthly.page.getByRole('option', { name: policy, exact: true }).click()
	await expect(safety).toHaveText(policy)
}

export const setDesktopExternalQueriesTask: AiTaskMetadata = {
	id: 'chat.desktop-agent-external-queries',
	summary: 'Allow or revoke WebMCP geography and remote query tools through Settings.',
	preconditions: ['Desktop agent access is enabled'],
	sideEffects: [
		'Changes the native tool catalog and invalidates old map tokens',
		'Saves the external query preference in this browser',
		'Does not run a remote query',
	],
	viewports: 'both',
}

export async function setDesktopExternalQueries(
	earthly: EarthlySession,
	enabled: boolean,
): Promise<void> {
	if (!isLoopbackURL(earthly.page.url()))
		throw new Error('Desktop agent tasks require a loopback page.')
	await setDesktopAgentAccess(earthly, true)
	const section = earthly.page.getByRole('region', { name: 'Desktop agent access', exact: true })
	const toggle = section.getByRole('switch', { name: 'External queries', exact: true })
	if ((await toggle.isChecked()) !== enabled) await toggle.click()
	await expect(section.getByRole('status')).toHaveText(
		/Earthly tools available to your desktop agent\./,
	)
	await expect
		.poll(async () =>
			(await discoverWebMcpTools(earthly)).some((tool) => tool.name === 'earthly_valhalla_route'),
		)
		.toBe(enabled)
}

export async function setDesktopAgentAccess(
	earthly: EarthlySession,
	enabled: boolean,
): Promise<void> {
	if (enabled && !isLoopbackURL(earthly.page.url()))
		throw new Error('Desktop agent tasks require a loopback page.')
	const closeActivity = earthly.page.getByRole('button', {
		name: 'Close desktop agent activity',
		exact: true,
	})
	if (await closeActivity.isVisible()) await closeActivity.click()
	if (!(await earthly.page.getByRole('tab', { name: 'Chat', exact: true }).isVisible()))
		await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	const section = earthly.page.getByRole('region', { name: 'Desktop agent access', exact: true })
	const toggle = section.getByRole('switch', { name: 'Desktop agent access', exact: true })
	if ((await toggle.isChecked()) !== enabled) await toggle.click()
	if (enabled) await expect(section.getByRole('status')).toHaveText(/Earthly tools available/)
	else await expect(section.getByRole('status')).toHaveText('Desktop agent access is off.')
}

export async function discoverWebMcpTools(earthly: EarthlySession) {
	return earthly.page.evaluate(async () => {
		const context = (
			document as Document & {
				modelContext: {
					getTools(): Promise<
						Array<{
							name: string
							inputSchema: unknown
							annotations: { readOnlyHint: boolean; consequentialHint: boolean }
						}>
					>
				}
			}
		).modelContext
		const tools = await context.getTools()
		return tools
			.filter((tool) => tool.name.startsWith('earthly_'))
			.map((tool) => ({
				name: tool.name,
				inputSchema: tool.inputSchema,
				annotations: tool.annotations,
			}))
	})
}

export async function executeWebMcpTool(
	earthly: EarthlySession,
	name: string,
	input: Record<string, unknown> = {},
) {
	if (!isLoopbackURL(earthly.page.url())) throw new Error('WebMCP tasks require a loopback page.')
	// Chrome <155 takes JSON text; newer releases take the object directly.
	const version = Number(earthly.page.context().browser()?.version().split('.')[0])
	return earthly.page.evaluate(
		async ({ name, input, stringify }) => {
			const context = (
				document as Document & {
					modelContext: {
						getTools(): Promise<Array<{ name: string }>>
						executeTool(
							tool: { name: string },
							input: string | Record<string, unknown>,
						): Promise<string>
					}
				}
			).modelContext
			const tool = (await context.getTools()).find((item) => item.name === name)
			if (!tool) throw new Error(`WebMCP tool unavailable: ${name}`)
			return JSON.parse(
				await context.executeTool(tool, stringify ? JSON.stringify(input) : input),
			) as Record<string, unknown>
		},
		{ name, input, stringify: version < 155 },
	)
}
