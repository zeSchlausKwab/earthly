import { Github } from "lucide-react"

export default function SiteInfo({}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-row items-center gap-2">
        <Github className="h-4 w-4" />
        <a href="https://github.com/moogmodular/earthly">github.com/moogmodular/earthly</a>
      </div>
      <article className="prose">
        <h1>earthly 🌍</h1>
        <p>earthly.land is the geojson editor on nostr no one has ever asked for.</p>
        <ul>
          <li>geometry features are 4326 Kinds</li>
          <li>geometry features are collected in 3455 moderated communities that are called collections</li>
          <li>later, collections can be composed in Article kinds</li>
        </ul>
        <p>
          This project is in an early WIP stage. It is not ready for production use. The relay
          https://relay.earthly.land is being nuked regularly, however you can visit the website, generate a keypair and
          start editing geojson features.
        </p>
      </article>
    </div>
  )
}
