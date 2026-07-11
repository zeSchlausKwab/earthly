import { createIdentityTask } from './tasks/auth/create-identity'
import { signInTask } from './tasks/auth/sign-in'
import { startDatasetTask } from './tasks/create/dataset'
import { createStoryDraftTask } from './tasks/create/story'
import { monitorBrowserHealthTask } from './tasks/diagnostics/browser-health'
import { inspectSurfaceTask } from './tasks/diagnostics/inspect-surface'
import { keyboardWalkTask } from './tasks/diagnostics/keyboard-walk'
import { openPanelTask } from './tasks/navigation/open-panel'
import { completeTourTask, inspectTourTask, skipTourTask } from './tasks/onboarding/tour'

const tasks = [
	createIdentityTask,
	signInTask,
	completeTourTask,
	skipTourTask,
	inspectTourTask,
	openPanelTask,
	startDatasetTask,
	createStoryDraftTask,
	monitorBrowserHealthTask,
	inspectSurfaceTask,
	keyboardWalkTask,
].sort((a, b) => a.id.localeCompare(b.id))

console.log('Earthly AI suite tasks\n')
for (const task of tasks) {
	console.log(`${task.id} [${task.viewports}]`)
	console.log(`  ${task.summary}`)
	console.log(`  requires: ${task.preconditions.join('; ') || 'none'}`)
	console.log(`  effects: ${task.sideEffects.join('; ') || 'none'}\n`)
}
