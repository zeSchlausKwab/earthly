import {
	ArrowDown,
	ArrowLeft,
	ArrowRight,
	ArrowUp,
	Braces,
	ChevronRight,
	Compass,
	Download,
	ExternalLink,
	Map as MapIcon,
	MapPin,
	MessageCircle,
	Network,
	Radio,
	Route,
	Share2,
	Users,
	WifiOff,
} from 'lucide-react'
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react'
import { GithubIcon } from '../../components/icons/GithubIcon'
import earthlyMark from '../../assets/square_logo_rose.svg'
import './tour-page.css'

const TOUR_ASSET_ROOT = '/static/tour'
const EARTHLY_GITHUB_URL = 'https://github.com/zeSchlausKwab/earthly'
const EARTHLY_APK_URL =
	'https://github.com/zeSchlausKwab/earthly/releases/download/v0.0.3/earthly-0.0.3-arm64-v8a.apk'
const EARTHLY_ZAPSTORE_URL =
	'https://zapstore.dev/apps/naddr1qqxxx6t50yhx2ctjw35xc7gprpmhxue69uhhyetvv9uju7npwpehgmmjv5hxgetkqgsxaamh579jgp06666dk2npjytygyfrkq70zjrgszzzsrd32sua43qrqsqqqlstt49k8z'

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
		id: 'festival-authoring',
		filmNumber: 'FILM 01',
		format: 'desktop',
		tabLabel: 'Make the map',
		tabMeta: 'Desktop authoring',
		frameLabel: 'Live product',
		frameCode: 'DESKTOP · GEOJSON EDITOR',
		kicker: 'Author the ground truth',
		title: 'Turn a plan into a living map.',
		description:
			'A real Earthly session redraws a festival plan, adds the practical details visitors need, and keeps every shape editable.',
		chapterHref: '#create',
		chapterLabel: 'Explore mapmaking',
		video: {
			label: 'Earthly desktop editor building a festival map',
			mp4: 'festival-map-editor.mp4',
			poster: 'festival-map-editor-poster.png',
			webm: 'festival-map-editor.webm',
		},
	},
	{
		id: 'visitor-participation',
		filmNumber: 'FILM 02',
		format: 'mobile',
		tabLabel: 'Join the place',
		tabMeta: 'Mobile visitor',
		frameLabel: 'Visitor view',
		frameCode: 'MOBILE · COMMENT + SHARE',
		kicker: 'Meet on the map',
		title: 'Comment, attach, and share a point.',
		description:
			'The visitor opens a stage, adds a comment with an exact meeting point, and shares the place without losing its context.',
		chapterHref: '#participate',
		chapterLabel: 'Follow the visitor',
		video: {
			label: 'Earthly mobile visitor commenting on a stage and sharing a point',
			mp4: 'visitor-comment-share.mp4',
			poster: 'visitor-comment-share-poster.png',
			webm: 'visitor-comment-share.webm',
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
						<span>VISITOR MODE / MARA</span>
						<strong>The conversation has coordinates.</strong>
						<p>Open the stage, attach a meeting point, and send the place itself.</p>
						<ul aria-label="Mobile visitor actions">
							<li>
								<MessageCircle aria-hidden="true" />
								Comment
							</li>
							<li>
								<MapPin aria-hidden="true" />
								Attach
							</li>
							<li>
								<Share2 aria-hidden="true" />
								Share
							</li>
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
					<a href="#foundation">Foundation</a>
					<a href="#possibilities">Possibilities</a>
				</nav>
				<div className="tour-nav-actions">
					<a
						className="tour-nav-link"
						href={EARTHLY_GITHUB_URL}
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
						className="tour-nav-link"
						href={EARTHLY_APK_URL}
						aria-label="Download the Earthly Android APK from GitHub"
					>
						<Download aria-hidden="true" />
						<span>APK</span>
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
							<span>01—05</span>
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
								DONAUINSEL, VIENNA
								<small>48.246° N · 16.397° E</small>
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
