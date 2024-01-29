import { Prisma } from "@prisma/client"
import { z } from "zod"

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc"

export const curatedItemsRouter = createTRPCRouter({
  all: publicProcedure.query(async ({ input, ctx }) => {
    const curatedItems = await ctx.db.curatedFeature.findMany({})
    return curatedItems
  }),
  allCategories: publicProcedure.query(async ({ input, ctx }) => {
    const curatedItems = await ctx.db.curatedFeatureCategory.findMany({
      include: {
        curatedFeature: {
          select: { admin: true, isoA3: true, name: true, id: true },
        },
      },
    })
    return curatedItems
  }),
  getOne: publicProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const curatedItem = await ctx.db.curatedFeature.findUnique({
        where: { id: input.id },
      })
      return curatedItem
    }),
})
