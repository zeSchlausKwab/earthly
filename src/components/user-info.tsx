import React, { useEffect, useState } from "react"
import { useNDKStore } from "~/store/ndk-store"
import { type NDKUserProfile } from "@nostr-dev-kit/ndk"
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar"
import { Globe, User } from "lucide-react"

export default function UserInfo() {
  const { ndkUser, ndk } = useNDKStore()

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
        <div className={"flex flex-row gap-4"}>
          <Avatar>
            <AvatarImage src={fetchedProfile.image} />
            <AvatarFallback>{fetchedProfile.name?.at(0)}</AvatarFallback>
          </Avatar>
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
        </div>
      )}
    </div>
  )
}
