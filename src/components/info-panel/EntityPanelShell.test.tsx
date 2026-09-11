import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'
import { PanelTranslucencyContext } from '@/components/PanelTranslucencyContext'
import { EntityListTranslucencyContext } from '@/components/entity-list/TranslucencyContext'
import { MobileObjectNavigationContext } from './MobileObjectNavigation'
import { ThreadTabNotice } from './ObjectTabs'
import { mobileObjectNavigationState } from '@/features/geo-editor/components/mobileResumeNavigation'

describe('EntityPanelShell mobile Thread', () => {
	test('nested discussions share the list and sheet transparency setting', () => {
		expect(EntityListTranslucencyContext).toBe(PanelTranslucencyContext)
		const html = renderToStaticMarkup(
			<PanelTranslucencyContext.Provider value={true}>
				<EntityPanelSurface tone="discussion">Composer and replies</EntityPanelSurface>
			</PanelTranslucencyContext.Provider>,
		)
		expect(html).toContain('bg-transparent')
		expect(html).not.toContain('bg-card')
	})

	test('discussions restore their solid surface when transparency is off', () => {
		const html = renderToStaticMarkup(
			<PanelTranslucencyContext.Provider value={false}>
				<EntityPanelSurface tone="discussion">Composer and replies</EntityPanelSurface>
			</PanelTranslucencyContext.Provider>,
		)
		expect(html).toContain('bg-card')
		expect(html).not.toContain('bg-transparent')
	})

	test('bounds non-Map conversations to the space below their object tabs', () => {
		const html = renderToStaticMarkup(
			<MobileObjectNavigationContext.Provider
				value={{
					activeTab: 'thread',
					onClose: () => {},
					threadContent: <section aria-label="Story conversation">Composer</section>,
				}}
			>
				<EntityPanelShell title="A story" tabs="Object sections">
					<ThreadTabNotice />
				</EntityPanelShell>
			</MobileObjectNavigationContext.Provider>,
		)
		expect(html).toContain('min-h-0 flex-1 overflow-hidden')
		expect(html).toContain('h-full min-h-0')
		expect(html).toContain('aria-label="Story conversation"')
		expect(html).not.toContain('overflow-y-auto')
	})

	test('keeps normal Details and desktop panels scrollable', () => {
		const html = renderToStaticMarkup(<EntityPanelShell title="A story">Details</EntityPanelShell>)
		expect(html).toContain('overflow-y-auto')
		expect(html).toContain('space-y-3 pb-3 pr-1')
	})

	test('lets Comments own scrolling on desktop as well as mobile', () => {
		const html = renderToStaticMarkup(
			<EntityPanelShell title="A story" contained>
				<div>Comments list and docked composer</div>
			</EntityPanelShell>,
		)
		expect(html).toContain('min-h-0 flex-1 overflow-hidden')
		expect(html).not.toContain('overflow-y-auto')
	})

	test('a resumed editor stays scrollable while the previous Thread route is being cleared', () => {
		const navigation = mobileObjectNavigationState(false, 'edit', 'thread')
		const html = renderToStaticMarkup(
			<MobileObjectNavigationContext.Provider
				value={{ activeTab: navigation.activeTab, onClose: () => {} }}
			>
				<EntityPanelShell title="Edit Story">
					<form>All retained editor controls</form>
				</EntityPanelShell>
			</MobileObjectNavigationContext.Provider>,
		)
		expect(html).toContain('overflow-y-auto')
		expect(html).not.toContain('overflow-hidden')
	})
})
