import NDK, { NDKEvent, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk"
import { v4 as uuidv4 } from "uuid"
import {
  approvalEventKind,
  communityFeatureTagIdentifier,
  featureEventKind,
  moderatedCommunityEventKind,
} from "~/config/constants"
import { testUser1PK, testUser2PK } from "./seed-users"

const community1User1 = {
  name: "Community 1 User 1",
  description: "This is community 1 user 1",
  image: "https://source.unsplash.com/random/400x200",
}

const community2User1 = {
  name: "Community 2 User 1",
  description: "This is community 2 user 1",
  image: "https://source.unsplash.com/random/400x200",
}

const community1User2 = {
  name: "Community 1 User 2",
  description: "This is community 1 user 1",
  image: "https://source.unsplash.com/random/400x200",
}

const community1FeaturesUser1 = [
  {
    type: "Feature",
    properties: {
      id: "eab621c9-c816-44b5-acbb-1e0c9063ae07",
      name: "User 1 First Polygon",
      description: "This is the first Feature",
      color: "#FF0000",
    },
    geometry: {
      coordinates: [
        [
          [10.054922027712053, 47.55026669578393],
          [9.917998139015907, 47.574161893543504],
          [9.883767166842603, 47.51998379825184],
          [9.95222911119015, 47.47612231239938],
          [10.070266946272682, 47.502443600757545],
          [10.054922027712053, 47.55026669578393],
        ],
      ],
      type: "Polygon",
    },
  },
  {
    type: "Feature",
    properties: {
      id: "af0590d6-02e5-4e53-8164-3cfdfcee178d",
      name: "User 1 Second Polygon",
      description: "This is the second Feature",
      color: "#00FF00",
    },
    geometry: {
      coordinates: [
        [
          [10.082217565486332, 47.48933710210116],
          [9.969340730641505, 47.46027231350885],
          [9.936194358505048, 47.40937024825496],
          [10.04996704124494, 47.38693347895324],
          [10.12790580816187, 47.41482639616086],
          [10.144031070282523, 47.436645335171875],
          [10.082217565486332, 47.48933710210116],
        ],
      ],
      type: "Polygon",
    },
  },
  {
    type: "Feature",
    properties: {
      id: "05f004b1-397b-4ce1-8259-035f98694da1",
      name: "User 1 Third Polygon",
      description: "This is the third Feature",
      color: "#0000FF",
    },
    geometry: {
      coordinates: [
        [
          [10.208532118765334, 47.554674103617145],
          [10.11984317710079, 47.55588328071323],
          [10.113572241832657, 47.50325828308797],
          [10.182552529793469, 47.470567931354026],
          [10.290950125160293, 47.4863102700175],
          [10.271241471456563, 47.531694437146086],
          [10.208532118765334, 47.554674103617145],
        ],
      ],
      type: "Polygon",
    },
  },
]

const community2FeaturesUser1 = [
  {
    type: "Feature",
    properties: {
      id: "1608e3c5-2425-4467-9f42-57346e280546",
      name: "User 2 First MultiPolygon",
      description: "This is the first MultiPolygon",
      color: "#FF0000",
    },
    geometry: {
      coordinates: [
        [
          [
            [9.62441809100983, 47.40890381959409],
            [9.582315087719934, 47.39940506498999],
            [9.558456719189053, 47.38800429856897],
            [9.549334401809489, 47.372324217374114],
            [9.55775500246682, 47.36186823911382],
            [9.566175603125288, 47.33619477746501],
            [9.562667019517676, 47.3143149412675],
            [9.578806504112322, 47.30955725590516],
            [9.597051138871336, 47.33334139973212],
            [9.6047700228076, 47.358065551309096],
            [9.636347275275824, 47.37612587740384],
            [9.649679892983983, 47.405104523285246],
            [9.63915414216126, 47.43833907455672],
            [9.632838691668269, 47.420300064293826],
            [9.62441809100983, 47.40890381959409],
          ],
          [
            [9.727291120218467, 47.46200443897328],
            [9.720823674081913, 47.45277278593207],
            [9.721901581771334, 47.44256749419006],
            [9.719027161265473, 47.42847121698932],
            [9.706810874117195, 47.41485743513431],
            [9.698906217727796, 47.40172652566778],
            [9.682018997258353, 47.39248429367822],
            [9.671239920364144, 47.37740138224379],
            [9.662257356284158, 47.370344990641485],
            [9.642855017873472, 47.3574463869476],
            [9.633872453793458, 47.34503154539641],
            [9.624530587151128, 47.322628758950316],
            [9.638184084552307, 47.33066563415176],
            [9.656508515273572, 47.344544629355994],
            [9.674114340868869, 47.34941358765232],
            [9.68992365364889, 47.36693811882026],
            [9.694235284406602, 47.37448161058171],
            [9.725135304839569, 47.39029510655345],
            [9.743819038124371, 47.40707655061186],
            [9.743819038124371, 47.41923367750849],
            [9.733399263792563, 47.44572648655637],
            [9.727291120218467, 47.46200443897328],
          ],
        ],
      ],
      type: "MultiPolygon",
    },
  },
  {
    type: "Feature",
    properties: {
      id: "dd96ac31-cfcf-4473-958a-1331e7fc80b6",
      name: "User 1 Third Polygon",
      description: "This is the third Feature",
      color: "#0000FF",
    },
    geometry: {
      coordinates: [
        [
          [9.568256499295899, 47.44626369000994],
          [9.536801493346644, 47.453790320747004],
          [9.424047395096721, 47.43055246923734],
          [9.485021714321078, 47.40828687537811],
          [9.520832028787567, 47.39092627987972],
          [9.563417267611271, 47.426623930995646],
          [9.596807966234678, 47.42433214827514],
          [9.606486429603905, 47.43546272969519],
          [9.568256499295899, 47.44626369000994],
        ],
      ],
      type: "Polygon",
    },
  },
]

const community1FeaturesUser2 = [
  {
    type: "Feature",
    properties: {
      id: "1dbdd0fc-1531-4a17-b862-d1e1ce2ac308",
      name: "User 2 First Polygon 1 ",
      description: "This is the first Feature",
      color: "#FF0000",
    },
    geometry: {
      coordinates: [
        [
          [9.816725195227974, 47.358181301187614],
          [9.801981694483374, 47.36357424303051],
          [9.763353722533083, 47.3571825477585],
          [9.733276981014427, 47.34659459911603],
          [9.749789701848186, 47.32561220151345],
          [9.810827794930134, 47.336404190201876],
          [9.816725195227974, 47.358181301187614],
        ],
      ],
      type: "Polygon",
    },
  },
  {
    type: "Feature",
    properties: {
      id: "46567f55-e47e-4b04-949b-413f6a02c169",
      name: "User 2 Second Polygon 2",
      description: "This is the second Feature",
      color: "#00FF00",
    },
    geometry: {
      coordinates: [
        [
          [9.857122387267424, 47.34679439139373],
          [9.832058436002029, 47.34779334143755],
          [9.819968765391167, 47.33460567856207],
          [9.823212335555269, 47.321614609030604],
          [9.8585967373414, 47.33260726045171],
          [9.857122387267424, 47.34679439139373],
        ],
      ],
      type: "Polygon",
    },
  },
  {
    type: "Feature",
    properties: {
      id: "5a576fc6-dade-40ec-b514-4e9010fbc4cb",
      name: "User 2 Third Polygon Unapproved!",
      description: "This is the third Feature",
      color: "#0000FF",
    },
    geometry: {
      coordinates: [
        [
          [9.796674034214902, 47.32181449583953],
          [9.77308443302445, 47.32341356308319],
          [9.757751192250367, 47.31321868014004],
          [9.76512294262227, 47.30802053178783],
          [9.792840724021403, 47.31221907593155],
          [9.796674034214902, 47.32181449583953],
        ],
      ],
      type: "Polygon",
    },
  },
]

export const seedCollections = async () => {
  const signers = [
    {
      userPk: testUser1PK,
      communities: [
        { community: community1User1, features: community1FeaturesUser1 },
        { community: community2User1, features: community2FeaturesUser1 },
      ],
    },
    {
      userPk: testUser2PK,
      communities: [{ community: community1User2, features: community1FeaturesUser2 }],
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
        user.communities.map(async (community) => {
          const now = Math.floor(Date.now() / 1000)
          const motherEventId = uuidv4()
          const newCommunity = new NDKEvent(ndk, {
            kind: moderatedCommunityEventKind,
            pubkey: user.user.pubkey,
            content: community.community.description,
            created_at: now,
            tags: [
              ["d", motherEventId],
              ["title", community.community.name],
              ["description", community.community.description],
              ["image", community.community.image],
              ["published_at", now.toString()],
              ["relay", "wss;//relay.earthly.land", "author"],
              ["relay", "wss;//relay.earthly.land", "requests"],
              ["relay", "wss;//relay.earthly.land", "approvals"],
              ["p", user.user.pubkey, "moderator"],
            ],
          })

          const featureEvents = community.features.map((feature) => {
            const newFeature = new NDKEvent(ndk, {
              kind: featureEventKind,
              pubkey: user.user.pubkey,
              created_at: now,
              content: JSON.stringify(feature),
              tags: [
                ["a", `${featureEventKind}:${user.user.pubkey}:${motherEventId}`, "wss://relay.earthly.land"],
                ["d", feature.properties.id],
                ["published_at", now.toString()],
                ["y", communityFeatureTagIdentifier],
              ],
            })
            return newFeature
          })

          const newFeatureApprovals = await Promise.all(
            featureEvents.map(async (event) => {
              if (event.content.search("Unapproved!") !== -1) {
                return
              }

              const originalEvent = await event.toNostrEvent()
              const approvalEvent = new NDKEvent(ndk, {
                kind: approvalEventKind,
                pubkey: user.user.pubkey,
                content: JSON.stringify(originalEvent),
                created_at: now,
                tags: [
                  ["a", `${featureEventKind}:${user.user.pubkey}:${motherEventId}`, "wss://relay.earthly.land"],
                  ["e", event.id, "wss://relay.earthly.land"],
                  ["p", `${user.user.pubkey}`, "wss://relay.earthly.land"],
                  ["k", `${featureEventKind}`],
                ],
              })
              return approvalEvent
            }),
          )

          await newCommunity.publish()
          await Promise.all(
            featureEvents.map(async (event) => {
              return await event.publish()
            }),
          )
          await Promise.all(
            newFeatureApprovals
              .filter((approval) => approval !== undefined)
              .map(async (event) => {
                if (!event) return
                return await event.publish()
              }),
          )

          return { user }
        }),
      )
    }),
  )

  return { res }
}
