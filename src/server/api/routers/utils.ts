import { PrismaClient } from "@prisma/client"
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc"
import { seedCollections } from "./utils/seed-nostr-collections"
import { seedPoints } from "./utils/seed-nostr-events"
import { seedUsers } from "./utils/seed-users"

const relayPrismaClient = new PrismaClient({
  datasources: {
    db: {
      url: `${process.env.RELAY_DB_URL}`,
    },
  },
})

export const utilsRouter = createTRPCRouter({
  seedEvents: publicProcedure.query(async ({ ctx }) => {
    const res = await seedPoints()
    return { res }
  }),
  createUsers: publicProcedure.query(async ({ ctx }) => {
    const res = await seedUsers()
    return { res }
  }),
  createCollections: publicProcedure.query(async ({ ctx }) => {
    const res = await seedCollections()
    return { res }
  }),
  nukeRelay: publicProcedure.query(async ({ ctx }) => {
    const res = await relayPrismaClient.$queryRaw`DELETE FROM events`
    return { res }
  }),
  reset: publicProcedure.query(async ({ ctx }) => {
    const resNuke = await relayPrismaClient.$queryRaw`DELETE FROM events`
    const resSeedUsers = await seedUsers()
    const resSeedPoints = await seedPoints()
    const resSeedCollections = await seedCollections()

    return { hello: "world" }
  }),
})
