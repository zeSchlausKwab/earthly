import { type NDKUserProfile } from "@nostr-dev-kit/ndk"
import { Globe, User } from "lucide-react"
import { useEffect, useState } from "react"
import useMedia from "use-media"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { useNDKStore } from "~/store/ndk-store"

export default function UserInfo({
  onlyImageOnMobile = false,
}: {
  onlyImageOnMobile?: boolean
}) {
  const { ndkUser, ndk } = useNDKStore()
  const isWide = useMedia({ minWidth: "1024px" })

  const [fetchedProfile, setFetchedProfile] = useState<
    NDKUserProfile | undefined
  >(undefined)

  useEffect(() => {
    const fetchUser = async () => {
      const newUser = await ndkUser?.fetchProfile()
      if (newUser && ndk) {
        setFetchedProfile(newUser)
      } else {
        // Handle the case when 'newUser' is null
        setFetchedProfile(undefined)
      }
    }

    void fetchUser()
  }, [ndkUser])

  return (
    <div>
      {fetchedProfile && (
        <div className={"flex flex-row lg:gap-4"}>
          <Avatar>
            <AvatarImage
              className="h-8 w-8 lg:h-10 lg:w-10"
              src={fetchedProfile.image}
            />
            <AvatarFallback>{fetchedProfile.name?.at(0)}</AvatarFallback>
          </Avatar>
          {onlyImageOnMobile && !isWide ? null : (
            <div className={"flex flex-col justify-around"}>
              <div className={"flex flex-row gap-1"}>
                <User size={16} color="#8b8c4a" />
                <div>{fetchedProfile.name}</div>
              </div>
              <div className={"flex flex-row gap-1"}>
                <Globe size={16} color="#8b8c4a" />
                <div>{fetchedProfile.website}</div>
              </div>
              {/*TODO: add nip 05 verification*/}
              {/*<div className={"flex flex-row"}>*/}
              {/*  <ShieldCheck size={16}/>*/}
              {/*  <div>{fetchedProfile.nip05}</div>*/}
              {/*</div>*/}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
