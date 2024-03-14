import NDK, { NDKEvent, NDKPrivateKeySigner, type NDKKind } from "@nostr-dev-kit/ndk"
import { testUser1PK, testUser2PK } from "./seed-users"
import { featureEventKind } from "~/config/constants"

const pointsUser1 = [
  {
    type: "Feature",
    properties: {
      id: "667d4b00-f7f7-4dd7-a8d9-78ca615a8d41",
      name: "First Point",
      description: "This is the first point",
      color: "#FF0000",
    },
    geometry: {
      coordinates: [9.77477120468771, 47.52220324767006],
      type: "Point",
    },
  },
  {
    type: "Feature",
    properties: {
      id: "f4e5e3f2-5e2f-4f4b-9c2e-4f4a5e3d2c1b",
      name: "Second Point",
      description: "This is the second point",
      color: "#00FF00",
    },
    geometry: {
      type: "Point",
      coordinates: [9.240404320719932, 47.35220836627008],
    },
  },
  {
    type: "Feature",
    properties: {
      id: "0667c5f0-b31a-4674-b647-d249a0adfc9c",
      name: "Third Point",
      description: "This is the third point",
      color: "#0000FF",
    },
    geometry: {
      type: "Point",
      coordinates: [9.460725138020052, 47.32385928303475],
    },
  },
  {
    type: "Feature",
    properties: {
      id: "de1b4214-f56e-480b-85d9-b3f0c9c7429f",
      name: "Fourth Point",
      description: "This is the fourth point",
      color: "#FF00FF",
    },
    geometry: {
      type: "Point",
      coordinates: [9.747978861842398, 47.28982029071767],
    },
  },
]

const pointsUser2 = [
  {
    type: "Feature",
    properties: {
      id: "63e42923-6111-4852-b80f-d50814be353d",
      name: "User 2 First Point",
      description: "This is the first point",
      color: "#FF0000",
    },
    geometry: {
      coordinates: [9.4648817955256, 47.6276057590907],
      type: "Point",
    },
  },
  {
    type: "Feature",
    properties: {
      id: "627f1876-5d9b-435c-918e-d0a78e5f53f0",
      name: "User 2 Second Point",
      description: "This is the second point",
      color: "#00FF00",
    },
    geometry: {
      type: "Point",
      coordinates: [9.430304693878554, 47.57320353501379],
    },
  },
  {
    type: "Feature",
    properties: {
      id: "9de5faeb-dd26-40c4-9b63-07414086d393",
      name: "User 2 Third Point",
      description: "This is the third point",
      color: "#0000FF",
    },
    geometry: {
      type: "Point",
      coordinates: [9.51252135779555, 47.57035233545204],
    },
  },
]

export const seedPoints = async () => {
  const signers = [
    {
      userPk: testUser1PK,
      points: pointsUser1,
    },
    {
      userPk: testUser2PK,
      points: pointsUser2,
    },
  ].map((usr) => {
    return {
      ...usr,
      signer: new NDKPrivateKeySigner(usr.userPk),
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

  const res = await Promise.all(
    signedUsers.map(async (user) => {
      const ndk = new NDK({
        explicitRelayUrls: ["wss://relay.earthly.land"],
        signer: user.signer,
      })

      await ndk.connect()

      return await Promise.all(
        user.points.map(async (point) => {
          const now = Math.floor(Date.now() / 1000)
          const newEvent = new NDKEvent(ndk, {
            kind: featureEventKind,
            pubkey: user.user.pubkey,
            created_at: now,
            content: JSON.stringify(point),
            tags: [
              ["d", point.properties.id],
              ["image", "https://source.unsplash.com/random/400x200"],
              ["published_at", now.toString()],
            ],
          })

          const publishedEvent = await newEvent.publish()

          return publishedEvent
        }),
      )
    }),
  )

  return { res }
}
