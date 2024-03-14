import { useQuery } from "@tanstack/react-query"
import { useMapListStore } from "~/store/map-list-store"
import { useNDKStore } from "~/store/ndk-store"
import { type RecentFeature } from "~/store/recent-features-store"
import { encodeNaddr } from "~/utils/naddr"
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar"
import { featureEventKind } from "~/config/constants"

export default function PointPin({ feature }: { feature: RecentFeature }) {
  const { ndk } = useNDKStore()
  const { setFocusOnFeature } = useMapListStore()

  const { data, error } = useQuery({
    queryKey: [`user-${feature.pubkey}`],
    queryFn: async () => {
      const user = ndk?.getUser({ pubkey: feature.pubkey })
      return await user?.fetchProfile()
    },
    enabled: Boolean(feature.pubkey),
  })

  const userNameToInitials = (name: string) => {
    const nameParts = name.split(" ")
    const initials = nameParts.map((part) => part[0]).join("")
    return initials
  }

  return (
    <div
      className="flex flex-col items-center"
      onClick={() => {
        setFocusOnFeature(
          encodeNaddr({
            identifier: feature.identifier,
            pubkey: feature.pubkey,
            kind: featureEventKind,
          }),
        )
      }}
    >
      <Avatar>
        <AvatarImage src={data?.image} />
        <AvatarFallback>{userNameToInitials(data?.displayName ?? "")}</AvatarFallback>
      </Avatar>
      <div className="break-words text-center">{feature.title}</div>
    </div>
  )
}
