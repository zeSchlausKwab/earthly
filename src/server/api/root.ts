import { curatedItemsRouter } from "~/server/api/routers/curated-items"
import { createTRPCRouter } from "~/server/api/trpc"

export const appRouter = createTRPCRouter({
  curatedItems: curatedItemsRouter,
})

export type AppRouter = typeof appRouter
