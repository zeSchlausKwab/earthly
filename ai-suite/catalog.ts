import { createIdentityTask } from './tasks/auth/create-identity'
import { authorizeJourneyIdentityTask } from './tasks/auth/authorize-journey-identity'
import { signInTask } from './tasks/auth/sign-in'
import { startDatasetTask } from './tasks/create/dataset'
import { createContextTask } from './tasks/create/context'
import { createGeometryDraftTask, publishGeometryDatasetTask } from './tasks/create/geometry'
import { createStoryDraftTask, publishStoryTask } from './tasks/create/story'
import { createSightingTask } from './tasks/create/sighting'
import {
	cancelDrawingTask,
	mapStackDraftLifecycleTask,
	undoRedoGeometryTask,
} from './tasks/editor/lifecycle'
import { monitorBrowserHealthTask } from './tasks/diagnostics/browser-health'
import { inspectSurfaceTask } from './tasks/diagnostics/inspect-surface'
import { observeJourneyStepTask } from './tasks/diagnostics/journey-observation'
import { keyboardWalkTask } from './tasks/diagnostics/keyboard-walk'
import { openPanelTask } from './tasks/navigation/open-panel'
import { completeTourTask, inspectTourTask, skipTourTask } from './tasks/onboarding/tour'
import { seedDatasetProposalTask, seedStoryProposalTask } from './tasks/setup/story-proposal'
import {
	postAnnotatedCommentTask,
	postCommentTask,
	replyToCommentTask,
	toggleCommentAnnotationsTask,
	verifyCommentAnnotationDurabilityTask,
} from './tasks/social/comments'
import {
	decideDatasetProposalTask,
	proposeDatasetEditTask,
	proposeDatasetGeometryEditTask,
	reviewDatasetProposalTask,
} from './tasks/social/dataset-proposals'
import {
	acceptStoryEditTask,
	proposeStoryEditTask,
	rejectStoryEditTask,
} from './tasks/social/story-proposals'

const tasks = [
	createIdentityTask,
	authorizeJourneyIdentityTask,
	signInTask,
	completeTourTask,
	skipTourTask,
	inspectTourTask,
	openPanelTask,
	postCommentTask,
	replyToCommentTask,
	postAnnotatedCommentTask,
	toggleCommentAnnotationsTask,
	verifyCommentAnnotationDurabilityTask,
	reviewDatasetProposalTask,
	decideDatasetProposalTask,
	proposeDatasetEditTask,
	proposeDatasetGeometryEditTask,
	proposeStoryEditTask,
	acceptStoryEditTask,
	rejectStoryEditTask,
	seedStoryProposalTask,
	seedDatasetProposalTask,
	startDatasetTask,
	cancelDrawingTask,
	undoRedoGeometryTask,
	mapStackDraftLifecycleTask,
	createContextTask,
	createGeometryDraftTask,
	publishGeometryDatasetTask,
	createStoryDraftTask,
	publishStoryTask,
	createSightingTask,
	monitorBrowserHealthTask,
	inspectSurfaceTask,
	observeJourneyStepTask,
	keyboardWalkTask,
].sort((a, b) => a.id.localeCompare(b.id))

console.log('Earthly AI suite tasks\n')
for (const task of tasks) {
	console.log(`${task.id} [${task.viewports}]`)
	console.log(`  ${task.summary}`)
	console.log(`  requires: ${task.preconditions.join('; ') || 'none'}`)
	console.log(`  effects: ${task.sideEffects.join('; ') || 'none'}\n`)
}
