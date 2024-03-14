import NDK, { NDKPrivateKeySigner, type NDKUserProfile } from "@nostr-dev-kit/ndk"

export const testUser1PK = "034eb4a2b8fe29b62ce0e74874ecc30c711e0deb1ace1f931f35c26b5e2d3923"
export const testUser2PK = "9719635406a7164f70cab32c91794272cbfa9bfdbffd4db81ca395e004e4a4dc"
export const testUser3PK = "e667f3b626994adb3e364a7b039acc413cae6c39125ada3460960ccb66af2c98"

export const testUser1NSec =
  "nsec1xqengetzx3snyc3cvejnywtzxcexxefsv5mngwphx3jkxcenxp3nwvf3v5cxgetzx9skxef3vcunxvtxxv6kxv3kvg6k2vnyxvunyvcdav9d6"
export const testUser2NSec =
  "nsec18ymnzwfkxv6ngvpkvymnzd35vcmnqcmpvgenyceexymnjdpjxuexxcnxvyukyenyvfnxvep5v33rsvtrvyenjdt9xqcrgef5vy6xgcc9emeev"
export const testUser3NSec =
  "nsec1v5mrvdmxxd3rvv3k8yungctyvgek2vekx3snwc3sxvukzcmrxscnxcmpv5mxxveexyer2ctyvyengd3s8ymrqcmrvgmrvctxxf3njwqtztkx4"

const newTestUser1 = {
  pk: testUser1PK,
  profileData: {
    about: "I am a test user 1 about",
    banner:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Black-faced_Woodswallow_1_-_Sturt_National_Park.jpg/1280px-Black-faced_Woodswallow_1_-_Sturt_National_Park.jpg",
    displayName: "Test User 1",
    bio: "I am a test user 1 bio",
    image:
      "https://en.wikipedia.org/wiki/Wikipedia:Picture_of_the_day/December_2015#/media/File:Gebang_Temple,_29_December_2013_02.jpg",
    name: "Test User 1",
    website: "https://www.google.com",
  } as NDKUserProfile,
}

const newTestUser2 = {
  pk: testUser2PK,
  profileData: {
    about: "I am a test user 2 about",
    banner:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Black-faced_Woodswallow_1_-_Sturt_National_Park.jpg/1280px-Black-faced_Woodswallow_1_-_Sturt_National_Park.jpg",
    displayName: "Test User 2",
    bio: "I am a test user 2 bio",
    image:
      "https://en.wikipedia.org/wiki/Wikipedia:Picture_of_the_day/December_2015#/media/File:Gebang_Temple,_29_December_2013_02.jpg",
    name: "Test User 2",
    website: "https://www.google.com",
  } as NDKUserProfile,
}

const newTestUser3 = {
  pk: testUser3PK,
  profileData: {
    about: "I am a test user 3 about",
    banner:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9f/Black-faced_Woodswallow_1_-_Sturt_National_Park.jpg/1280px-Black-faced_Woodswallow_1_-_Sturt_National_Park.jpg",
    displayName: "Test User 3",
    bio: "I am a test user 3 bio",
    image:
      "https://en.wikipedia.org/wiki/Wikipedia:Picture_of_the_day/December_2015#/media/File:Gebang_Temple,_29_December_2013_02.jpg",
    name: "Test User 3",
    website: "https://www.google.com",
  } as NDKUserProfile,
}

export const seedUsers = async () => {
  const signers = [newTestUser1, newTestUser2, newTestUser3].map((usr) => {
    return {
      ...usr,
      signer: new NDKPrivateKeySigner(usr.pk),
    }
  })
  const signedUsers = await Promise.all(
    signers.map(async (signer) => {
      return {
        ...signer,
        user: await signer.signer.user(),
      }
    }),
  )

  const results = await Promise.all(
    signedUsers.map(async (user) => {
      const ndk = new NDK({
        explicitRelayUrls: ["wss://relay.earthly.land"],
        signer: user.signer,
      })

      await ndk.connect()

      const testUser = ndk.getUser({
        pubkey: user.user.pubkey,
      })

      testUser.profile = user.profileData

      await testUser.publish()

      return testUser.profile
    }),
  )

  return results
}
