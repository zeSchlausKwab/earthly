import { util } from "zod"
import { curatedItemsRouter } from "~/server/api/routers/curated-items"
import { createTRPCRouter } from "~/server/api/trpc"
import { utilsRouter } from "./routers/utils"

export const appRouter = createTRPCRouter({
  curatedItems: curatedItemsRouter,
  utils: utilsRouter,
})

export type AppRouter = typeof appRouter
