import { z } from "zod"

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc"

export const curatedItemsRouter = createTRPCRouter({
  all: publicProcedure.query(async ({ input, ctx }) => {
    return await ctx.db.curatedFeature.findMany({})
  }),
  allCategories: publicProcedure.query(async ({ input, ctx }) => {
    return await ctx.db.curatedFeatureCategory.findMany({
      include: {
        curatedFeature: {
          select: { admin: true, isoA3: true, name: true, id: true },
        },
      },
    })
  }),
  getOne: publicProcedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.db.curatedFeature.findUnique({
        where: { id: input.id },
      })
    }),
  getOneByName: publicProcedure
    .input(
      z.object({
        category: z.string(),
        name: z.string(),
      }),
    )
    .query(async ({ input, ctx }) => {
      return await ctx.db.curatedFeature.findFirst({
        where: { name: input.name, category: { name: input.category } },
      })
    }),
})
