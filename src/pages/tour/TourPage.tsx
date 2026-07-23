import {
	ArrowDown,
	ArrowRight,
	Braces,
	ChevronRight,
	Compass,
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
import { useEffect, useRef, useState } from 'react'
import earthlyMark from '../../assets/square_logo_rose.svg'
import './tour-page.css'

const TOUR_ASSET_ROOT = '/static/tour'

type ProductFilmProps = {
	className?: string
	label: string
	mp4: string
	poster: string
	webm: string
}

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
		const alignBelowNavigation = (target: HTMLElement) => {
			const scroller = document.querySelector<HTMLElement>('.tour-page')
			const navigation = document.querySelector<HTMLElement>('.tour-nav')
			if (!scroller) return

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

		scrollToHash()
		window.addEventListener('hashchange', scrollToHash)
		return () => {
			disposed = true
			window.cancelAnimationFrame(animationFrame)
			window.removeEventListener('hashchange', scrollToHash)
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
				<a className="tour-nav-cta" href="/">
					Open Earthly
					<ArrowRight aria-hidden="true" />
				</a>
			</header>

			<main>
				<section className="tour-hero" aria-labelledby="tour-heading">
					<div className="tour-hero-grid" aria-hidden="true" />
					<div className="tour-hero-copy">
						<p className="tour-eyebrow">
							<span>Earthly field guide</span>
							<span>01—04</span>
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
						<div className="tour-media-frame tour-media-frame-desktop">
							<div className="tour-media-bar">
								<span>
									<i />
									Live product
								</span>
								<code>DESKTOP · GEOJSON EDITOR</code>
							</div>
							<ProductFilm
								label="Earthly desktop editor building a festival map"
								mp4="festival-map-editor.mp4"
								poster="festival-map-editor-poster.png"
								webm="festival-map-editor.webm"
							/>
							<span className="tour-corner tour-corner-nw" />
							<span className="tour-corner tour-corner-se" />
						</div>
						<p className="tour-film-note">
							<span>FILM 01</span>A real Earthly session redraws a festival plan and turns it into
							an editable shared dataset.
						</p>
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
					<ArrowDown aria-hidden="true" />
				</a>
			</footer>
		</div>
	)
}

export default TourPage
