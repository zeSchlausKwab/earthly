import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form"
import { Input } from "~/components/ui/input"
import { useNDKStore } from "~/store/ndk-store"
import { Button } from "./ui/button"

const profileMetaSchema = z.object({
  displayName: z.string().optional(),
  about: z.string().optional(),
  banner: z.string().optional(),
  bio: z.string().optional(),
  image: z.string().optional(),
  website: z.string().optional(),
  name: z.string().optional(),
})

type ProfileMetaSchema = z.infer<typeof profileMetaSchema>

export default function ProfileMetaForm() {
  const { ndk, ndkUser } = useNDKStore()

  const form = useForm<ProfileMetaSchema>({
    resolver: zodResolver(profileMetaSchema),
  })

  const { data, error } = useQuery({
    queryKey: [`user-${ndkUser?.pubkey}`],
    queryFn: async () => {
      const res = await ndkUser?.fetchProfile()

      if (res) {
        form.reset(res)
      }

      return res
    },
    enabled: Boolean(ndkUser?.pubkey),
  })

  const handleFormSubmit = async (data: ProfileMetaSchema) => {
    const user = ndk?.getUser({
      npub: ndkUser?.npub,
    })

    await user?.fetchProfile()

    if (!user?.profile) {
      return
    }

    user.profile.displayName = data.displayName ?? user?.profile?.displayName
    user.profile.about = data.about ?? user?.profile?.about
    user.profile.banner = data.banner ?? user?.profile?.banner
    user.profile.bio = data.bio ?? user?.profile?.bio
    user.profile.image = data.image ?? user?.profile?.image
    user.profile.website = data.website ?? user?.profile?.website
    user.profile.name = data.name ?? user?.profile?.name

    await user?.publish()
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(handleFormSubmit)}
          className="space-y-8"
        >
          <FormField
            control={form.control}
            name="displayName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>display name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="about"
            render={({ field }) => (
              <FormItem>
                <FormLabel>about</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="banner"
            render={({ field }) => (
              <FormItem>
                <FormLabel>banner</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="bio"
            render={({ field }) => (
              <FormItem>
                <FormLabel>bio</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="image"
            render={({ field }) => (
              <FormItem>
                <FormLabel>image</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="website"
            render={({ field }) => (
              <FormItem>
                <FormLabel>website</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit">Save</Button>
        </form>
      </Form>
    </div>
  )
}
