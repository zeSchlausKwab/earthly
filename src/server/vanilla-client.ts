import { createTRPCClient, httpBatchLink } from "@trpc/client"
import superjson from "superjson"
import { type AppRouter } from "./api/root"

export const vanillaClient = createTRPCClient<AppRouter>({
  transformer: superjson,
  links: [
    httpBatchLink({
      url: `http://localhost:${process.env.PORT ?? 3000}/api/trpc`,
    }),
  ],
})
