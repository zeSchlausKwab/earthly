import type { RouterHistory } from '@tanstack/history'
import {
	createRootRoute,
	createRoute,
	createRouter,
	lazyRouteComponent,
	Outlet,
	useParams,
	useRouter,
	useRouterState,
	type RouteComponent,
} from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { normalizeEarthlySearch, parseEarthlyRoute } from './routeContract'
import { EarthlyRouteStateProvider } from './routeState'

const LazyAppRoute = lazyRouteComponent(() => import('../App'), 'App')
const LazyReadRoute = lazyRouteComponent(() => import('../pages/read/ReadRoute'), 'ReadRoute')

function RootLayout() {
	const location = useRouterState({ select: (state) => state.location })
	const routeState = useMemo(
		() => parseEarthlyRoute(location.pathname, location.search),
		[location.pathname, location.search],
	)
	return (
		<EarthlyRouteStateProvider state={routeState}>
			<Outlet />
		</EarthlyRouteStateProvider>
	)
}

function RoutePending() {
	return (
		<main className="earthly-boot" role="status" aria-live="polite">
			<section className="earthly-boot__card" aria-labelledby="earthly-route-loading-title">
				<p className="earthly-boot__eyebrow">Earthly · loading field atlas</p>
				<h1 id="earthly-route-loading-title">Opening the map</h1>
				<p>Connecting to the map index and restoring this view…</p>
				<div className="earthly-boot__progress" aria-hidden="true" />
			</section>
		</main>
	)
}

function RouteNotFound() {
	return (
		<main className="earthly-boot">
			<section className="earthly-boot__card">
				<p className="earthly-boot__eyebrow">Earthly · unknown route</p>
				<h1>This path is not on the map</h1>
				<p>The link may be incomplete or use a route this client does not understand.</p>
				<a href="/">Open Earthly</a>
			</section>
		</main>
	)
}

function LensEntryRedirect() {
	const router = useRouter()
	const { atlas } = useParams({ strict: false }) as { atlas?: string }

	useEffect(() => {
		if (!atlas) return
		const search = new URLSearchParams(window.location.search)
		search.set('in', atlas)
		const query = search.toString()
		void router.navigate({ href: `/browse/maps${query ? `?${query}` : ''}`, replace: true })
	}, [atlas, router])

	return <RoutePending />
}

export interface CreateEarthlyRouterOptions {
	/** Injectable for route-contract tests and native/web history adapters. */
	history?: RouterHistory
	/** Lightweight test doubles can avoid loading the full editor bundle. */
	appComponent?: RouteComponent
	readComponent?: RouteComponent
}

const NEW_APP_PATHS = [
	'/',
	'/browse/$kind',
	'/map/$id',
	'/map/$id/edit',
	'/map/$id/comment/$commentId',
	'/story/$id',
	'/story/$id/edit',
	'/story/$id/comment/$commentId',
	'/atlas/$id',
	'/atlas/$id/edit',
	'/atlas/$id/comment/$commentId',
	'/sighting/$id',
	'/sighting/$id/comment/$commentId',
	'/person/$id',
	'/ask',
	'/shelf',
	'/circle/$id',
	'/circle/$id/$view',
	'/nearby/$id',
	'/nearby/$id/$view',
	'/live/$id',
	'/live/$id/comment/$commentId',
	'/inbox',
	'/me',
	'/me/$section',
] as const

const LEGACY_SIDEBAR_PATHS = [
	'drafts',
	'datasets',
	'map-stack',
	'contexts',
	'field-sessions',
	'private-groups',
	'context-editor',
	'stories',
	'sightings',
	'beacons',
	'combined',
	'edit',
	'posts',
	'shoutbox',
	'delivery',
	'settings',
	'help',
	'wallet',
	'chat',
] as const

const LEGACY_SHARE_PREFIXES = ['geoevent', 'mapcontext', 'context', 'beacon'] as const

/**
 * Create Earthly's complete code-based client router.
 *
 * Bun owns HTTP/API/static/OG delivery. TanStack owns every in-app path, search
 * value, and history mutation. Legacy aliases are explicit routes rather than a
 * global catch-all, so an unknown path cannot accidentally boot a different UI.
 */
export function createEarthlyRouter(options: CreateEarthlyRouterOptions = {}) {
	const AppComponent = options.appComponent ?? LazyAppRoute
	const ReadComponent = options.readComponent ?? LazyReadRoute
	const rootRoute = createRootRoute({
		component: RootLayout,
		validateSearch: normalizeEarthlySearch,
		notFoundComponent: RouteNotFound,
	})

	const newAppRoutes = NEW_APP_PATHS.map((path) =>
		createRoute({ getParentRoute: () => rootRoute, path, component: AppComponent }),
	)
	const readerRoutes = [
		createRoute({
			getParentRoute: () => rootRoute,
			path: '/read/$naddr',
			component: ReadComponent,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: '/read/$naddr/comment/$commentId',
			component: ReadComponent,
		}),
	]
	const lensEntryRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: '/in/$atlas',
		component: LensEntryRedirect,
	})

	const legacySidebarRoutes = LEGACY_SIDEBAR_PATHS.flatMap((view) => [
		createRoute({ getParentRoute: () => rootRoute, path: `/${view}`, component: AppComponent }),
		createRoute({
			getParentRoute: () => rootRoute,
			path: `/${view}/$focusType/$naddr`,
			component: AppComponent,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: `/${view}/$focusType/$naddr/comment/$commentId`,
			component: AppComponent,
		}),
	])
	const legacyShareRoutes = LEGACY_SHARE_PREFIXES.flatMap((prefix) => [
		createRoute({
			getParentRoute: () => rootRoute,
			path: `/${prefix}/$naddr`,
			component: AppComponent,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: `/${prefix}/$naddr/comment/$commentId`,
			component: AppComponent,
		}),
	])
	const legacyScopedRoutes = [
		createRoute({
			getParentRoute: () => rootRoute,
			path: '/context/$contextNaddr/$view',
			component: AppComponent,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: '/context/$contextNaddr/$view/$focusType/$naddr',
			component: AppComponent,
		}),
		createRoute({
			getParentRoute: () => rootRoute,
			path: '/context/$contextNaddr/$view/$focusType/$naddr/comment/$commentId',
			component: AppComponent,
		}),
		...['privategroup', 'private-group', 'fieldsession', 'field-session'].flatMap((scope) => [
			createRoute({
				getParentRoute: () => rootRoute,
				path: `/${scope}/$id`,
				component: AppComponent,
			}),
			createRoute({
				getParentRoute: () => rootRoute,
				path: `/${scope}/$id/$view`,
				component: AppComponent,
			}),
		]),
		createRoute({ getParentRoute: () => rootRoute, path: '/user/$id', component: AppComponent }),
	]

	const routeTree = rootRoute.addChildren([
		...readerRoutes,
		lensEntryRoute,
		...newAppRoutes,
		...legacySidebarRoutes,
		...legacyShareRoutes,
		...legacyScopedRoutes,
	])

	return createRouter({
		routeTree,
		history: options.history,
		defaultPendingComponent: RoutePending,
		defaultPreload: 'intent',
	})
}
