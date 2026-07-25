import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	BookOpen,
	Braces,
	CheckCircle2,
	ChevronRight,
	Compass,
	Download,
	ExternalLink,
	Laptop,
	Map as MapIcon,
	MapPin,
	MessageCircle,
	Network,
	NotebookTabs,
	Radio,
	Route,
	ScanSearch,
	Share2,
	Smartphone,
	TreePine,
	Users,
	WifiOff,
} from 'lucide-react'
import {
	type KeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from 'react'
import { GithubIcon } from '../../components/icons/GithubIcon'
import earthlyMark from '../../assets/square_logo_rose.svg'
import {
	EARTHLY_ANDROID_APK_URL,
	EARTHLY_GITHUB_REPOSITORY_URL,
	EARTHLY_MACOS_DMG_URL,
	EARTHLY_ZAPSTORE_URL,
} from '../../config/app-downloads'
import './tour-page.css'

const TOUR_ASSET_ROOT = '/static/tour'

type ProductFilmProps = {
	className?: string
	label: string
	mp4: string
	poster: string
	webm: string
}

type HeroStory = {
	chapterHref: string
	chapterLabel: string
	description: string
	filmNumber: string
	format: 'desktop' | 'mobile'
	frameCode: string
	frameLabel: string
	id: string
	kicker: string
	mobileStory?: {
		actions: Array<{
			icon: typeof MapPin
			label: string
		}>
		copy: string
		eyebrow: string
		title: string
	}
	tabLabel: string
	tabMeta: string
	title: string
	video: {
		label: string
		mp4: string
		poster: string
		webm: string
	}
}

const heroStories: HeroStory[] = [
	{
		id: 'beira-response-draft',
		filmNumber: 'FILM 01',
		format: 'desktop',
		tabLabel: 'Draft the plan',
		tabMeta: 'Human authoring',
		frameLabel: 'Cyclone response drill',
		frameCode: 'BEIRA · DESKTOP EDITOR',
		kicker: 'Draw what operations need',
		title: 'Build the response plan by hand.',
		description:
			'In Beira, a coordinator redraws a flood forecast, dashed evacuation routes, command post, and three relief camps—then adds field clinic, clean water, shelter, logistics, radio, and reunification points.',
		chapterHref: '#create',
		chapterLabel: 'Explore mapmaking',
		video: {
			label: 'Earthly desktop editor drafting a cyclone response map for Beira',
			mp4: 'beira-cyclone-draft.mp4',
			poster: 'beira-cyclone-draft-poster.png',
			webm: 'beira-cyclone-draft.webm',
		},
	},
	{
		id: 'porto-ai-home-search',
		filmNumber: 'FILM 02',
		format: 'desktop',
		tabLabel: 'Ask where to live',
		tabMeta: 'AI spatial analysis',
		frameLabel: 'AI-assisted search',
		frameCode: 'PORTO · CHAT + ISOCHRONE',
		kicker: 'Ask in ordinary language',
		title: 'Turn a life question into a spatial answer.',
		description:
			'A concise question maps a 20-minute bicycle catchment around Casa da Música, then layers the parks, groceries, and metro stops that make a Porto apartment work.',
		chapterHref: '#analyze',
		chapterLabel: 'Explore AI spatial analysis',
		video: {
			label:
				'Earthly AI mapping a Porto apartment search with a bicycle isochrone and nearby amenities',
			mp4: 'porto-ai-home-search.mp4',
			poster: 'porto-ai-home-search-poster.png',
			webm: 'porto-ai-home-search.webm',
		},
	},
	{
		id: 'private-coordination',
		filmNumber: 'FILM 03',
		format: 'desktop',
		tabLabel: 'Work in private',
		tabMeta: 'Desktop ↔ mobile',
		frameLabel: 'Private coordination',
		frameCode: 'WEB + MOBILE · MLS',
		kicker: 'Keep the crew connected',
		title: 'Coordinate privately, across devices.',
		description:
			'A coordinator creates an MLS-protected festival group, Mara joins from her phone, and the operations desk answers by drawing the exact Crew Gate on the map.',
		chapterHref: '/private-groups',
		chapterLabel: 'Open private groups',
		video: {
			label:
				'Earthly private group created on desktop, joined from a phone, and answered on desktop',
			mp4: 'private-group-cross-device.mp4',
			poster: 'private-group-cross-device-poster.png',
			webm: 'private-group-cross-device.webm',
		},
	},
	{
		id: 'ai-map-story',
		filmNumber: 'FILM 04',
		format: 'desktop',
		tabLabel: 'Ask Earthly',
		tabMeta: 'AI map + Story',
		frameLabel: 'AI-assisted mapping',
		frameCode: 'DESKTOP · AI + GEOJSON',
		kicker: 'Delegate the cartography',
		title: 'Ask once. Get a map—and its story.',
		description:
			'A short prompt becomes a 117-feature Belt and Road Dataset with distinct port anchors, annotated nodes, maritime routes, and potential Arctic passages—then a Story cites the signed map inline.',
		chapterHref: '#foundation',
		chapterLabel: 'See how it stays yours',
		video: {
			label:
				'Earthly AI creating a Belt and Road map, showing its actions, and publishing a Story with an inline Dataset reference',
			mp4: 'ai-belt-road-story.mp4',
			poster: 'ai-belt-road-story-poster.png',
			webm: 'ai-belt-road-story.webm',
		},
	},
	{
		id: 'hormuz-shipping-network',
		filmNumber: 'FILM 05',
		format: 'desktop',
		tabLabel: 'Trace the routes',
		tabMeta: 'AI global routes',
		frameLabel: 'AI-assisted routing',
		frameCode: 'DESKTOP · PORTS + ROUTES',
		kicker: 'Make the network legible',
		title: 'Turn a chokepoint into a global network.',
		description:
			'A concise correction turns the map outward: 24 Persian Gulf port and chokepoint markers connect through Hormuz to seven labeled global destinations across seven representative corridors.',
		chapterHref: '#possibilities',
		chapterLabel: 'Imagine your own network',
		video: {
			label:
				'Earthly AI replacing internal Persian Gulf lanes with outbound shipping corridors through Hormuz to major global ports',
			mp4: 'hormuz-ports-shipping.mp4',
			poster: 'hormuz-ports-shipping-poster.png',
			webm: 'hormuz-ports-shipping.webm',
		},
	},
	{
		id: 'offline-trail-edit',
		filmNumber: 'FILM 06',
		format: 'mobile',
		tabLabel: 'Draw offline',
		tabMeta: 'Mobile magnifier',
		frameLabel: 'Offline field edit',
		frameCode: 'MOBILE · TOUCH + MAGNIFIER',
		kicker: 'Keep mapping beyond the signal',
		title: 'Draw precisely—even offline.',
		description:
			'Near Refugio Chileno in Torres del Paine, a hiker disconnects, marks a creek-crossing hazard with the live magnifier, and traces a safe detour for friends.',
		mobileStory: {
			eyebrow: 'W TREK / TORRES DEL PAINE',
			title: 'A safer trail starts under your finger.',
			copy: 'Lose the signal, keep the map, and place the detail exactly where your group needs it.',
			actions: [
				{ icon: WifiOff, label: 'Offline' },
				{ icon: MapPin, label: 'Magnify' },
				{ icon: Route, label: 'Detour' },
			],
		},
		chapterHref: '#create',
		chapterLabel: 'Explore mobile mapmaking',
		video: {
			label:
				'Earthly mobile hiker drawing a creek-crossing hazard and safe detour offline with the live magnifier in Torres del Paine',
			mp4: 'mobile-drawing-magnifier.mp4',
			poster: 'mobile-drawing-magnifier-poster.png',
			webm: 'mobile-drawing-magnifier.webm',
		},
	},
]

function usePrefersReducedMotion() {
	const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

	useEffect(() => {
		const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
		const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches)
		updatePreference()
		mediaQuery.addEventListener('change', updatePreference)
		return () => mediaQuery.removeEventListener('change', updatePreference)
	}, [])

	return prefersReducedMotion
}

function useTourHashNavigation() {
	useEffect(() => {
		let animationFrame = 0
		let disposed = false
		let isInitialLocation = true
		const resetScroller = (scroller: HTMLElement) => {
			const previousScrollBehavior = scroller.style.scrollBehavior
			scroller.style.scrollBehavior = 'auto'
			scroller.scrollTop = 0
			scroller.style.scrollBehavior = previousScrollBehavior
		}
		const alignBelowNavigation = (target: HTMLElement) => {
			const scroller = document.querySelector<HTMLElement>('.tour-page')
			const navigation = document.querySelector<HTMLElement>('.tour-nav')
			if (!scroller) return
			if (target === scroller) {
				resetScroller(scroller)
				return
			}

			const previousScrollBehavior = scroller.style.scrollBehavior
			scroller.style.scrollBehavior = 'auto'
			scroller.scrollTop = Math.max(
				0,
				scroller.scrollTop + target.getBoundingClientRect().top - (navigation?.offsetHeight ?? 0),
			)
			scroller.style.scrollBehavior = previousScrollBehavior
		}
		const scrollToHash = () => {
			const targetId = decodeURIComponent(window.location.hash.slice(1))
			const target = targetId ? document.getElementById(targetId) : null
			if (!target) {
				isInitialLocation = false
				return
			}

			window.cancelAnimationFrame(animationFrame)
			animationFrame = window.requestAnimationFrame(() => {
				const scroller = document.querySelector<HTMLElement>('.tour-page')
				if (target.id === 'tour-top' && scroller) {
					resetScroller(scroller)
					isInitialLocation = false
					return
				}

				if (isInitialLocation) {
					alignBelowNavigation(target)
					isInitialLocation = false
					void document.fonts.ready.then(() => {
						if (disposed || window.location.hash.slice(1) !== targetId) return
						window.cancelAnimationFrame(animationFrame)
						animationFrame = window.requestAnimationFrame(() => alignBelowNavigation(target))
					})
					return
				}

				target.scrollIntoView({ block: 'start' })
			})
		}
		const handleSameHashLink = (event: MouseEvent) => {
			const link =
				event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
			if (!link) return
			const destination = new URL(link.href, window.location.href)
			if (
				destination.origin !== window.location.origin ||
				destination.pathname !== window.location.pathname ||
				!destination.hash ||
				destination.hash !== window.location.hash
			) {
				return
			}
			window.cancelAnimationFrame(animationFrame)
			animationFrame = window.requestAnimationFrame(scrollToHash)
		}

		scrollToHash()
		window.addEventListener('hashchange', scrollToHash)
		document.addEventListener('click', handleSameHashLink)
		return () => {
			disposed = true
			window.cancelAnimationFrame(animationFrame)
			window.removeEventListener('hashchange', scrollToHash)
			document.removeEventListener('click', handleSameHashLink)
		}
	}, [])
}

function ProductFilm({ className, label, mp4, poster, webm }: ProductFilmProps) {
	const videoRef = useRef<HTMLVideoElement>(null)
	const prefersReducedMotion = usePrefersReducedMotion()

	useEffect(() => {
		const video = videoRef.current
		if (!video) return

		if (prefersReducedMotion) {
			video.pause()
			return
		}

		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) {
					void video.play().catch(() => undefined)
				} else {
					video.pause()
				}
			},
			{ threshold: 0.32 },
		)

		observer.observe(video)
		return () => observer.disconnect()
	}, [prefersReducedMotion])

	return (
		<video
			ref={videoRef}
			aria-label={label}
			className={className}
			controls={prefersReducedMotion}
			loop
			muted
			playsInline
			poster={`${TOUR_ASSET_ROOT}/${poster}`}
			preload="metadata"
		>
			<source src={`${TOUR_ASSET_ROOT}/${webm}`} type="video/webm" />
			<source src={`${TOUR_ASSET_ROOT}/${mp4}`} type="video/mp4" />
		</video>
	)
}

function HeroStoryFilm({ story }: { story: HeroStory }) {
	const mobileStory = story.mobileStory
	return (
		<div className="tour-media-frame tour-media-frame-desktop">
			<div className="tour-media-bar">
				<span>
					<i />
					{story.frameLabel}
				</span>
				<code>{story.frameCode}</code>
			</div>
			{story.format === 'desktop' ? (
				<ProductFilm
					label={story.video.label}
					mp4={story.video.mp4}
					poster={story.video.poster}
					webm={story.video.webm}
				/>
			) : (
				<div className="tour-hero-mobile-film">
					<div className="tour-hero-mobile-story">
						<span>{mobileStory?.eyebrow}</span>
						<strong>{mobileStory?.title}</strong>
						<p>{mobileStory?.copy}</p>
						<ul aria-label={`${story.tabLabel} actions`}>
							{mobileStory?.actions.map(({ icon: Icon, label }) => (
								<li key={label}>
									<Icon aria-hidden="true" />
									{label}
								</li>
							))}
						</ul>
					</div>
					<div className="tour-hero-mobile-device">
						<div className="tour-hero-mobile-speaker" aria-hidden="true" />
						<ProductFilm
							className="tour-hero-mobile-video"
							label={story.video.label}
							mp4={story.video.mp4}
							poster={story.video.poster}
							webm={story.video.webm}
						/>
					</div>
				</div>
			)}
			<span className="tour-corner tour-corner-nw" />
			<span className="tour-corner tour-corner-se" />
		</div>
	)
}

function HeroStorySlider() {
	const [activeStoryIndex, setActiveStoryIndex] = useState(0)
	const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
	const swipeRef = useRef<{
		pointerId: number
		startX: number
		startY: number
	} | null>(null)
	const sliderId = useId()
	const activeStory = heroStories[activeStoryIndex] ?? heroStories[0]
	if (!activeStory) return null

	const selectAdjacentStory = (direction: -1 | 1) => {
		setActiveStoryIndex((currentIndex) => {
			return (currentIndex + direction + heroStories.length) % heroStories.length
		})
	}

	const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
		let nextIndex: number | null = null
		if (event.key === 'ArrowRight') {
			nextIndex = (currentIndex + 1) % heroStories.length
		} else if (event.key === 'ArrowLeft') {
			nextIndex = (currentIndex - 1 + heroStories.length) % heroStories.length
		} else if (event.key === 'Home') {
			nextIndex = 0
		} else if (event.key === 'End') {
			nextIndex = heroStories.length - 1
		}

		if (nextIndex === null) return
		event.preventDefault()
		setActiveStoryIndex(nextIndex)
		tabRefs.current[nextIndex]?.focus()
	}

	const handleSwipeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return
		swipeRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
		}
	}

	const handleSwipeEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
		const swipe = swipeRef.current
		swipeRef.current = null
		if (!swipe || swipe.pointerId !== event.pointerId) return

		const deltaX = event.clientX - swipe.startX
		const deltaY = event.clientY - swipe.startY
		if (Math.abs(deltaX) < 52 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return
		selectAdjacentStory(deltaX < 0 ? 1 : -1)
	}

	return (
		<section className="tour-story-slider" aria-label="Featured Earthly product films">
			<div className="tour-slider-navigation">
				<div className="tour-slider-tabs" role="tablist" aria-label="Featured product films">
					{heroStories.map((story, index) => (
						<button
							key={story.id}
							ref={(node) => {
								tabRefs.current[index] = node
							}}
							id={`${sliderId}-tab-${index}`}
							type="button"
							role="tab"
							aria-controls={`${sliderId}-panel`}
							aria-selected={activeStoryIndex === index}
							tabIndex={activeStoryIndex === index ? 0 : -1}
							onClick={() => setActiveStoryIndex(index)}
							onKeyDown={(event) => handleTabKeyDown(event, index)}
						>
							<span>{String(index + 1).padStart(2, '0')}</span>
							<strong>{story.tabLabel}</strong>
							<small>{story.tabMeta}</small>
						</button>
					))}
				</div>
				<div className="tour-slider-arrows">
					<button
						type="button"
						aria-label="Previous product film"
						onClick={() => selectAdjacentStory(-1)}
					>
						<ArrowLeft aria-hidden="true" />
					</button>
					<button
						type="button"
						aria-label="Next product film"
						onClick={() => selectAdjacentStory(1)}
					>
						<ArrowRight aria-hidden="true" />
					</button>
				</div>
			</div>

			<div
				id={`${sliderId}-panel`}
				className="tour-slider-panel"
				role="tabpanel"
				aria-labelledby={`${sliderId}-tab-${activeStoryIndex}`}
				onPointerDown={handleSwipeStart}
				onPointerUp={handleSwipeEnd}
				onPointerCancel={() => {
					swipeRef.current = null
				}}
			>
				<div key={activeStory.id} className="tour-hero-slide">
					<HeroStoryFilm story={activeStory} />
					<div className="tour-story-explanation">
						<div className="tour-story-number">
							<span>{activeStory.filmNumber}</span>
							<small>
								{String(activeStoryIndex + 1).padStart(2, '0')} /{' '}
								{String(heroStories.length).padStart(2, '0')}
							</small>
						</div>
						<div className="tour-story-copy">
							<p>{activeStory.kicker}</p>
							<h2>{activeStory.title}</h2>
							<span>{activeStory.description}</span>
						</div>
						<a className="tour-story-link" href={activeStory.chapterHref}>
							{activeStory.chapterLabel}
							<ArrowRight aria-hidden="true" />
						</a>
					</div>
				</div>
			</div>
		</section>
	)
}

function TourMetadata() {
	useEffect(() => {
		const previousTitle = document.title
		const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
		const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
		const previousDescription = description?.content
		const previousCanonical = canonical?.href

		document.title = 'Tour Earthly — Maps become shared places'
		if (description) {
			description.content =
				'See how Earthly turns local knowledge into collaborative GeoJSON maps on Nostr—from drawing a place to commenting and sharing on mobile.'
		}
		if (canonical) canonical.href = 'https://earthly.city/tour'

		return () => {
			document.title = previousTitle
			if (description && previousDescription) description.content = previousDescription
			if (canonical && previousCanonical) canonical.href = previousCanonical
		}
	}, [])

	return null
}

const tourPromises = [
	{
		icon: Braces,
		kicker: 'Portable',
		title: 'Draw real GeoJSON',
		copy: 'Points, lines, polygons, and the details that make a place useful.',
	},
	{
		icon: Network,
		kicker: 'Verifiable',
		title: 'Publish signed events',
		copy: 'Versioned geographic entities travel through the open Nostr network.',
	},
	{
		icon: MessageCircle,
		kicker: 'Situated',
		title: 'Talk on the geometry',
		copy: 'Comments, proposals, stories, and sightings stay attached to place.',
	},
	{
		icon: WifiOff,
		kicker: 'Field-ready',
		title: 'Keep working nearby',
		copy: 'The Android app supports local collaboration when the internet does not.',
	},
] as const

const useCases = [
	{
		number: '01',
		icon: MapIcon,
		title: 'A festival people can navigate',
		copy: 'Publish stages, entrances, stands, toilets, boundaries, and live observations as one useful ground truth.',
		tags: ['operations', 'visitors', 'live updates'],
	},
	{
		number: '02',
		icon: Compass,
		title: 'Field knowledge that comes home',
		copy: 'Capture sightings, photos, notes, and live beacons on location—then keep the geometry with the conversation.',
		tags: ['ecology', 'surveys', 'expeditions'],
	},
	{
		number: '03',
		icon: Users,
		title: 'A neighborhood memory',
		copy: 'Curate accessible routes, repair needs, local history, and proposals without flattening them into a pin list.',
		tags: ['civic maps', 'accessibility', 'local history'],
	},
] as const

export function TourPage() {
	useTourHashNavigation()

	return (
		<div className="tour-page" id="tour-top">
			<TourMetadata />

			<header className="tour-nav">
				<a className="tour-brand" href="#tour-top" aria-label="Earthly tour home">
					<img src={earthlyMark} alt="" />
					<span>earthly.city</span>
					<em>tour</em>
				</a>
				<nav aria-label="Tour chapters">
					<a href="#create">Create</a>
					<a href="#participate">Participate</a>
					<a href="#collaborate">Collaborate</a>
					<a href="#learn">Learn</a>
					<a href="#foundation">Foundation</a>
					<a href="#possibilities">Possibilities</a>
				</nav>
				<div className="tour-nav-actions">
					<a
						className="tour-nav-link"
						href={EARTHLY_GITHUB_REPOSITORY_URL}
						target="_blank"
						rel="noreferrer"
						aria-label="Earthly on GitHub"
					>
						<GithubIcon />
						<span>GitHub</span>
					</a>
					<a
						className="tour-nav-link"
						href={EARTHLY_ZAPSTORE_URL}
						target="_blank"
						rel="noreferrer"
						aria-label="Install Earthly from Zapstore"
					>
						<span>Zapstore</span>
						<ExternalLink aria-hidden="true" />
					</a>
					<a
						className="tour-nav-link tour-nav-link-apk"
						href={EARTHLY_ANDROID_APK_URL}
						aria-label="Download the Earthly Android APK from GitHub"
					>
						<Download aria-hidden="true" />
						<span>APK</span>
					</a>
					<a
						className="tour-nav-link"
						href={EARTHLY_MACOS_DMG_URL}
						aria-label="Download Earthly for macOS from GitHub"
					>
						<Laptop aria-hidden="true" />
						<span>macOS</span>
					</a>
					<a className="tour-nav-cta" href="/">
						Open Earthly
						<ArrowRight aria-hidden="true" />
					</a>
				</div>
			</header>

			<main>
				<section className="tour-hero" aria-labelledby="tour-heading">
					<div className="tour-hero-grid" aria-hidden="true" />
					<div className="tour-hero-copy">
						<p className="tour-eyebrow">
							<span>Earthly field guide</span>
							<span>01—08</span>
						</p>
						<h1 id="tour-heading">
							Maps become <br />
							<em>shared places.</em>
						</h1>
						<p className="tour-hero-lede">
							Earthly turns local knowledge into living GeoJSON maps—drawn in the browser, discussed
							at the exact place, and published as signed events on Nostr.
						</p>
						<div className="tour-hero-actions">
							<a className="tour-button tour-button-primary" href="#create">
								Start the tour
								<ArrowDown aria-hidden="true" />
							</a>
							<a className="tour-text-link" href="/">
								Go straight to the map
								<ArrowRight aria-hidden="true" />
							</a>
						</div>
						<div className="tour-hero-coordinate">
							<MapPin aria-hidden="true" />
							<span>
								FIELD TO GLOBAL
								<small>LOCAL-FIRST · OPEN GEOGRAPHY</small>
							</span>
						</div>
					</div>

					<div className="tour-hero-media">
						<HeroStorySlider />
					</div>

					<a className="tour-scroll-cue" href="#tour-promises" aria-label="Continue tour">
						<span>Scroll to follow the route</span>
						<ArrowDown aria-hidden="true" />
					</a>
				</section>

				<section className="tour-promises" id="tour-promises" aria-label="What Earthly connects">
					{tourPromises.map(({ copy, icon: Icon, kicker, title }) => (
						<article key={title}>
							<div className="tour-promise-heading">
								<Icon aria-hidden="true" />
								<span>{kicker}</span>
							</div>
							<h2>{title}</h2>
							<p>{copy}</p>
						</article>
					))}
				</section>

				<section className="tour-chapter tour-create" id="create" aria-labelledby="create-heading">
					<div className="tour-chapter-marker" aria-hidden="true">
						<span>01</span>
						<i />
					</div>
					<div className="tour-chapter-intro">
						<p className="tour-kicker">From file to place</p>
						<h2 id="create-heading">Build a map people can actually use.</h2>
						<p>
							Import what you already have or draw directly on the map. Earthly keeps the geometry,
							properties, layers, and publishing flow in one workspace, so a sketch can become a
							durable dataset without changing tools.
						</p>
					</div>
					<div className="tour-chapter-index">
						<span>01 / CREATE</span>
						<p>GeoJSON authoring, layers, metadata, publishing</p>
					</div>

					<figure className="tour-create-film">
						<div className="tour-media-frame tour-media-frame-wide">
							<div className="tour-media-bar">
								<span>
									<i />
									Donau festival map
								</span>
								<code>ACTUAL UI · LOOP</code>
							</div>
							<ProductFilm
								label="Festival ground plan being recreated in Earthly"
								mp4="festival-map-editor.mp4"
								poster="festival-map-editor-poster.png"
								webm="festival-map-editor.webm"
							/>
						</div>
						<figcaption>
							<span>What is happening</span>
							<p>
								The editor frames the festival grounds, redraws the supplied plan, and adds the
								practical details visitors need.
							</p>
						</figcaption>
					</figure>

					<div className="tour-create-details">
						<article>
							<span className="tour-detail-number">A</span>
							<h3>Geometry stays first-class</h3>
							<p>
								Points, paths, and areas remain editable data—not a flattened image or presentation.
							</p>
						</article>
						<article>
							<span className="tour-detail-number">B</span>
							<h3>One map, many layers</h3>
							<p>
								Combine facilities, stages, observations, beacons, and trusted basemaps without
								losing their sources.
							</p>
						</article>
						<article>
							<span className="tour-detail-number">C</span>
							<h3>Publish with provenance</h3>
							<p>
								Every public entity is signed and versioned, giving shared geography an attributable
								history.
							</p>
						</article>
					</div>

					<section
						className="tour-ai-point"
						id="analyze"
						aria-labelledby="analyze-heading"
					>
						<div className="tour-ai-point-copy">
							<div className="tour-ai-point-number" aria-hidden="true">
								<span>01B</span>
								<i />
								<small>ANALYZE</small>
							</div>
							<p className="tour-kicker">A second way to draw</p>
							<h3 id="analyze-heading">Ask the map to do the legwork.</h3>
							<p>
								Earthly can turn an ordinary life question into editable spatial analysis. The
								answer is not a screenshot: the travel-time area, destination, parks, groceries,
								and transit stops all remain map features.
							</p>
							<blockquote>
								“Show me where to look for a flat in Porto if I want to cycle to Casa da Música
								in 20 minutes and live near parks, groceries and the metro.”
							</blockquote>
							<ol className="tour-ai-point-steps">
								<li>
									<span>01</span>
									<div>
										<strong>Ask naturally</strong>
										<p>No query language or long specification.</p>
									</div>
								</li>
								<li>
									<span>02</span>
									<div>
										<strong>See the reasoning</strong>
										<p>Expand the actions while Earthly builds the answer.</p>
									</div>
								</li>
								<li>
									<span>03</span>
									<div>
										<strong>Keep the geography</strong>
										<p>Edit, publish, or combine every resulting feature.</p>
									</div>
								</li>
							</ol>
						</div>

						<figure className="tour-ai-point-film">
							<div className="tour-media-frame tour-media-frame-wide">
								<div className="tour-media-bar">
									<span>
										<i />
										Porto home search · Casa da Música
									</span>
									<code>CHAT → ISOCHRONE · ACTUAL UI</code>
								</div>
								<ProductFilm
									label="Earthly AI mapping a Porto apartment search with a bicycle isochrone and nearby amenities"
									mp4="porto-ai-home-search.mp4"
									poster="porto-ai-home-search-poster.png"
									webm="porto-ai-home-search.webm"
								/>
							</div>
							<figcaption>
								<span>FILM 02 · AI SPATIAL ANALYSIS</span>
								<p>
									A 20-minute cycling catchment becomes a legible search map with semantic
									icons for the everyday amenities around it.
								</p>
							</figcaption>
						</figure>
					</section>
				</section>

				<section
					className="tour-chapter tour-participate"
					id="participate"
					aria-labelledby="participate-heading"
				>
					<div className="tour-chapter-marker" aria-hidden="true">
						<span>02</span>
						<i />
					</div>
					<div className="tour-participate-copy">
						<p className="tour-kicker">The visitor’s map</p>
						<h2 id="participate-heading">
							A pin can carry
							<br />a conversation.
						</h2>
						<p>
							On mobile, the map becomes a social surface. Open a stage, comment with a precise
							point attached, then share that location with someone else. The context travels with
							the link.
						</p>
						<ol className="tour-steps">
							<li>
								<span>1</span>
								<div>
									<strong>Find the place</strong>
									<p>Open the shared festival dataset on the mobile map.</p>
								</div>
							</li>
							<li>
								<span>2</span>
								<div>
									<strong>Add local context</strong>
									<p>Write a comment and attach the exact meeting point.</p>
								</div>
							</li>
							<li>
								<span>3</span>
								<div>
									<strong>Pass it on</strong>
									<p>Share a deep link that brings the other person back to it.</p>
								</div>
							</li>
						</ol>
					</div>

					<figure className="tour-phone-stage">
						<div className="tour-phone-orbit" aria-hidden="true">
							<span>COMMENT</span>
							<span>POINT</span>
							<span>SHARE</span>
						</div>
						<div className="tour-phone">
							<div className="tour-phone-speaker" />
							<ProductFilm
								label="Earthly mobile visitor commenting on a stage and sharing a point"
								mp4="visitor-comment-share.mp4"
								poster="visitor-comment-share-poster.png"
								webm="visitor-comment-share.webm"
							/>
						</div>
						<figcaption>
							<span>FILM 02 · MOBILE</span>
							Comment on a place, attach geometry, share the result.
						</figcaption>
					</figure>

					<aside
						className="tour-participate-aside"
						aria-label="Why geometry-aware discussion matters"
					>
						<div className="tour-aside-glyph">
							<MessageCircle aria-hidden="true" />
							<MapPin aria-hidden="true" />
						</div>
						<p className="tour-kicker">More than coordinates</p>
						<h3>The meaning stays attached.</h3>
						<p>
							Ordinary chat makes location a side note. Earthly lets a comment include a point,
							line, polygon, or text annotation as part of the message itself.
						</p>
						<div className="tour-aside-rule" />
						<div className="tour-aside-stat">
							<Share2 aria-hidden="true" />
							<span>
								<strong>One share</strong>
								<small>map + entity + selected place</small>
							</span>
						</div>
					</aside>
				</section>

				<section
					className="tour-chapter tour-collaborate"
					id="collaborate"
					aria-labelledby="collaborate-heading"
				>
					<div className="tour-chapter-marker" aria-hidden="true">
						<span>03</span>
						<i />
					</div>
					<div className="tour-chapter-intro">
						<p className="tour-kicker">Public collaboration</p>
						<h2 id="collaborate-heading">
							Let the field propose.
							<br />
							Keep the owner in control.
						</h2>
						<p>
							On West Woss Road in Vancouver Island, a contractor marks a damaged bridge and traces
							a surveyed bypass from her phone. The operations planner sees a signed proposal,
							previews the exact geometry, and decides whether it becomes canonical.
						</p>
					</div>
					<div className="tour-chapter-index">
						<span>03 / COLLABORATE</span>
						<p>Mobile field edits, signed proposals, geometry preview, owner acceptance</p>
					</div>

					<figure className="tour-collaborate-film">
						<div className="tour-media-frame tour-media-frame-wide">
							<div className="tour-media-bar">
								<span>
									<i />
									Nimpkish forestry access · Woss
								</span>
								<code>MOBILE → DESKTOP · ACTUAL UI</code>
							</div>
							<ProductFilm
								label="Earthly forestry contractor proposing a damaged bridge and bypass from mobile for desktop owner review"
								mp4="collaborative-map-proposal.mp4"
								poster="collaborative-map-proposal-poster.png"
								webm="collaborative-map-proposal.webm"
							/>
						</div>
						<figcaption>
							<span>FILM 07 · PUBLIC PROPOSAL</span>
							<p>
								The shared map changes only after its owner inspects and accepts the contributor’s
								two geometry edits.
							</p>
						</figcaption>
					</figure>

					<section className="tour-collaboration-flow" aria-label="How a public map proposal works">
						<article>
							<TreePine aria-hidden="true" />
							<span>01 / FIELD</span>
							<h3>Draw what changed</h3>
							<p>The contributor works in an editable copy and keeps the original map intact.</p>
						</article>
						<article>
							<ScanSearch aria-hidden="true" />
							<span>02 / REVIEW</span>
							<h3>Preview the geometry</h3>
							<p>The owner sees the proposed point and route before making a decision.</p>
						</article>
						<article>
							<CheckCircle2 aria-hidden="true" />
							<span>03 / ACCEPT</span>
							<h3>Publish a signed revision</h3>
							<p>Acceptance creates an attributable update to the canonical Dataset.</p>
						</article>
					</section>
				</section>

				<section className="tour-chapter tour-learn" id="learn" aria-labelledby="learn-heading">
					<div className="tour-chapter-marker" aria-hidden="true">
						<span>04</span>
						<i />
					</div>
					<div className="tour-chapter-intro">
						<p className="tour-kicker">Map encyclopedia</p>
						<h2 id="learn-heading">
							A Story can open
							<br />
							the map beneath it.
						</h2>
						<p>
							In the Galápagos, an editor turns a geographic question into a sourced Story. A
							student opens the referenced atlas on a phone, compares the younger western islands
							with the older east, then jumps directly to Sierra Negra.
						</p>
					</div>
					<div className="tour-chapter-index">
						<span>04 / LEARN</span>
						<p>Long-form Stories, inline map references, mobile reading, evidence in place</p>
					</div>

					<figure className="tour-learn-film">
						<div className="tour-media-frame tour-media-frame-wide">
							<div className="tour-media-bar">
								<span>
									<i />
									Galápagos evolution atlas · Ecuador
								</span>
								<code>DESKTOP → MOBILE · ACTUAL UI</code>
							</div>
							<ProductFilm
								label="Earthly editor publishing a Galápagos evolution Story whose inline Dataset and Sierra Negra references open on a student's phone"
								mp4="story-to-map.mp4"
								poster="story-to-map-poster.png"
								webm="story-to-map.webm"
							/>
						</div>
						<figcaption>
							<span>FILM 08 · MAP ENCYCLOPEDIA</span>
							<p>
								The narrative remains readable, while each inline reference can reveal its geometry
								and move the map to the evidence.
							</p>
						</figcaption>
					</figure>

					<section className="tour-learning-flow" aria-label="How a map-backed Story works">
						<article>
							<BookOpen aria-hidden="true" />
							<span>01 / READ</span>
							<h3>Begin with a question</h3>
							<p>The Story gives the map a thesis, context, and sources—not just a title.</p>
						</article>
						<article>
							<NotebookTabs aria-hidden="true" />
							<span>02 / REVEAL</span>
							<h3>Open the referenced atlas</h3>
							<p>An inline Dataset becomes a visible layer without leaving the reading flow.</p>
						</article>
						<article>
							<ScanSearch aria-hidden="true" />
							<span>03 / EXPLORE</span>
							<h3>Move to the evidence</h3>
							<p>A feature reference can frame the exact island, port, trail, or observation.</p>
						</article>
					</section>
				</section>

				<section className="tour-foundation" id="foundation" aria-labelledby="foundation-heading">
					<div className="tour-foundation-top">
						<div>
							<p className="tour-kicker">Under the map</p>
							<h2 id="foundation-heading">
								Open geography,
								<br />
								open infrastructure.
							</h2>
						</div>
						<p>
							Earthly is not a proprietary map format with collaboration bolted on. Portable
							geometry is the base; signed, relayable events carry the people, revisions, and
							conversation around it.
						</p>
					</div>

					<section className="tour-protocol-flow" aria-label="How Earthly data moves">
						<article>
							<span>INPUT / MODEL</span>
							<Braces aria-hidden="true" />
							<h3>GeoJSON</h3>
							<p>Portable geometry and properties remain legible outside Earthly.</p>
						</article>
						<ChevronRight aria-hidden="true" />
						<article>
							<span>IDENTITY / HISTORY</span>
							<Radio aria-hidden="true" />
							<h3>Signed Nostr events</h3>
							<p>Datasets, comments, stories, and revisions retain authorship.</p>
						</article>
						<ChevronRight aria-hidden="true" />
						<article>
							<span>DELIVERY / CONTEXT</span>
							<Network aria-hidden="true" />
							<h3>Relays &amp; devices</h3>
							<p>Publish publicly, work privately, or collaborate over a nearby node.</p>
						</article>
					</section>

					<div className="tour-tech-row">
						<span>Built with</span>
						<ul aria-label="Core technology">
							<li>React</li>
							<li>MapLibre</li>
							<li>PMTiles</li>
							<li>Turf</li>
							<li>Nostr</li>
							<li>Blossom</li>
							<li>Tauri</li>
						</ul>
					</div>
				</section>

				<section
					className="tour-possibilities"
					id="possibilities"
					aria-labelledby="possibilities-heading"
				>
					<div className="tour-possibilities-heading">
						<p className="tour-kicker">A few possible maps</p>
						<h2 id="possibilities-heading">What would you make visible?</h2>
						<p>
							Earthly works best when the map is not the end product, but the shared surface where a
							place keeps evolving.
						</p>
					</div>
					<div className="tour-use-cases">
						{useCases.map(({ copy, icon: Icon, number, tags, title }) => (
							<article key={title}>
								<div className="tour-use-case-top">
									<span>{number}</span>
									<Icon aria-hidden="true" />
								</div>
								<h3>{title}</h3>
								<p>{copy}</p>
								<ul aria-label={`${title} themes`}>
									{tags.map((tag) => (
										<li key={tag}>{tag}</li>
									))}
								</ul>
							</article>
						))}
					</div>
				</section>

				<section className="tour-downloads" id="apps" aria-labelledby="apps-heading">
					<div className="tour-downloads-heading">
						<p className="tour-kicker">Native when the network is not</p>
						<h2 id="apps-heading">Take Earthly beyond the browser.</h2>
						<p>
							The web app is the quickest way into a public map. Install Earthly when you need
							nearby Field sessions, saved offline regions, and a durable native delivery queue.
						</p>
					</div>
					<div className="tour-download-cards">
						<article>
							<div className="tour-download-platform">
								<Smartphone aria-hidden="true" />
								<span>
									<small>FIELD + MOBILE</small>
									<strong>Android</strong>
								</span>
							</div>
							<p>
								Use touch-first drawing, QR invitations, offline maps, and nearby collaboration from
								a phone or tablet.
							</p>
							<div className="tour-download-actions">
								<a className="tour-button tour-button-primary" href={EARTHLY_ZAPSTORE_URL}>
									Get it on Zapstore
									<ExternalLink aria-hidden="true" />
								</a>
								<a className="tour-text-link" href={EARTHLY_ANDROID_APK_URL}>
									Download APK
									<Download aria-hidden="true" />
								</a>
							</div>
						</article>
						<article>
							<div className="tour-download-platform">
								<Laptop aria-hidden="true" />
								<span>
									<small>DESKTOP + NATIVE</small>
									<strong>macOS</strong>
								</span>
							</div>
							<p>
								Keep the full desktop workspace while adding local services, Field sessions, and
								native offline storage on Apple silicon.
							</p>
							<div className="tour-download-actions">
								<a className="tour-button tour-button-primary" href={EARTHLY_MACOS_DMG_URL}>
									Download for macOS
									<Download aria-hidden="true" />
								</a>
								<span>Apple silicon · unsigned preview</span>
							</div>
						</article>
					</div>
				</section>

				<section className="tour-closing" aria-labelledby="closing-heading">
					<div className="tour-closing-route" aria-hidden="true">
						<Route />
					</div>
					<p className="tour-kicker">End of the tour · Start of a map</p>
					<h2 id="closing-heading">
						Your next map can be
						<br />
						<em>more than a file.</em>
					</h2>
					<p>Open Earthly and explore the public map, or start drawing a place you know.</p>
					<div className="tour-closing-actions">
						<a className="tour-button tour-button-primary" href="/">
							Open Earthly
							<ArrowRight aria-hidden="true" />
						</a>
						<a className="tour-button tour-button-secondary" href="/datasets">
							Explore public datasets
							<MapIcon aria-hidden="true" />
						</a>
					</div>
				</section>
			</main>

			<footer className="tour-footer">
				<a className="tour-brand" href="#tour-top" aria-label="Back to the top">
					<img src={earthlyMark} alt="" />
					<span>earthly.city</span>
				</a>
				<p>Collaborative maps on open protocols.</p>
				<a href="#tour-top">
					Back to top
					<ArrowUp aria-hidden="true" />
				</a>
			</footer>
		</div>
	)
}

export default TourPage
