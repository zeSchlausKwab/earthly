export type AiSuiteViewport = 'desktop' | 'mobile' | 'both'

export interface AiTaskMetadata {
	id: string
	summary: string
	preconditions: string[]
	sideEffects: string[]
	viewports: AiSuiteViewport
}
