import { useQuery } from "@tanstack/react-query"
import { useNDKStore } from "~/store/ndk-store"
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar"

export default function ProfileByPubkey({ pubkey }: { pubkey: string }) {
  const { ndk } = useNDKStore()

  const { data, error } = useQuery({
    queryKey: [`user-${pubkey}`],
    queryFn: async () => {
      const user = ndk?.getUser({ pubkey })
      const profile = await user?.fetchProfile()
      return profile
    },
    enabled: Boolean(pubkey),
  })

  const userNameToInitials = (name: string) => {
    const nameParts = name.split(" ")
    const initials = nameParts.map((part) => part[0]).join("")
    return initials
  }

  return (
    <div className={"flex flex-row gap-2 text-xs"}>
      <Avatar>
        <AvatarImage src={data?.image} />
        <AvatarFallback>
          {userNameToInitials(data?.displayName ?? "")}
        </AvatarFallback>
      </Avatar>
      <div className="flex flex-col justify-around">
        <div>{data?.displayName}</div>
        <div>{data?.website}</div>
      </div>
    </div>
  )
}
