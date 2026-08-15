import { createIdentityTask } from './tasks/auth/create-identity'
import { authorizeJourneyIdentityTask } from './tasks/auth/authorize-journey-identity'
import { signInTask } from './tasks/auth/sign-in'
import {
	approveAiEditTask,
	configureChatProviderTask,
	openAiChatTask,
	sendAiChatMessageTask,
	startNewAiChatTask,
} from './tasks/chat/conversation'
import { startDatasetTask } from './tasks/create/dataset'
import { createContextTask } from './tasks/create/context'
import { createGeometryDraftTask, publishGeometryDatasetTask } from './tasks/create/geometry'
import {
	createStoryDraftTask,
	insertStoryReferenceTask,
	publishStoryTask,
} from './tasks/create/story'
import { createSightingTask } from './tasks/create/sighting'
import {
	cancelDrawingTask,
	mapStackDraftLifecycleTask,
	undoRedoGeometryTask,
} from './tasks/editor/lifecycle'
import { placeMobilePrecisionPointTask } from './tasks/editor/mobile-precision-drawing'
import { geometryOperationsTask } from './tasks/editor/geometry-operations'
import { geometryWorkbenchTask } from './tasks/editor/geometry-workbench'
import { monitorBrowserHealthTask } from './tasks/diagnostics/browser-health'
import { inspectSurfaceTask } from './tasks/diagnostics/inspect-surface'
import { observeJourneyStepTask } from './tasks/diagnostics/journey-observation'
import { keyboardWalkTask } from './tasks/diagnostics/keyboard-walk'
import { openPanelTask } from './tasks/navigation/open-panel'
import { copyCurrentShareLinkTask } from './tasks/navigation/share-current-view'
import { completeTourTask, inspectTourTask, skipTourTask } from './tasks/onboarding/tour'
import { installSimulatedNativeLocalNodeTask } from './tasks/setup/simulated-native-local-node'
import { installDeterministicChatProviderTask } from './tasks/setup/deterministic-chat-provider'
import { installDeterministicMapStyleTask } from './tasks/setup/deterministic-map-style'
import {
	installDeterministicGeolocationTask,
	recoverDeviceLocationTask,
} from './tasks/setup/deterministic-geolocation'
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
	configureChatProviderTask,
	openAiChatTask,
	sendAiChatMessageTask,
	startNewAiChatTask,
	approveAiEditTask,
	completeTourTask,
	skipTourTask,
	inspectTourTask,
	openPanelTask,
	copyCurrentShareLinkTask,
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
	installSimulatedNativeLocalNodeTask,
	installDeterministicChatProviderTask,
	installDeterministicMapStyleTask,
	installDeterministicGeolocationTask,
	recoverDeviceLocationTask,
	startDatasetTask,
	cancelDrawingTask,
	undoRedoGeometryTask,
	mapStackDraftLifecycleTask,
	placeMobilePrecisionPointTask,
	geometryOperationsTask,
	geometryWorkbenchTask,
	createContextTask,
	createGeometryDraftTask,
	publishGeometryDatasetTask,
	createStoryDraftTask,
	insertStoryReferenceTask,
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
