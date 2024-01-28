import * as React from "react"
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Input } from "~/components/ui/input"
import { Textarea } from "~/components/ui/textarea"

export const Icons = {
  spinner: Loader2,
}

export default function EditingStoryMetaForm({
  title,
  description,
  onChange,
}: {
  title: string
  description: string
  onChange: (title: string, description: string) => void
}) {
  const [value, setValue] = useState<{
    title: string
    description: string
  }>({
    title: title ?? "",
    description: description ?? "",
  })

  useEffect(() => {
    onChange(value.title, value.description)
  }, [value])

  return (
    <div className={"rounded-lg border p-4 text-sm"}>
      {" "}
      <Input
        value={title}
        onChange={(e) => setValue({ ...value, title: e.target.value })}
      />
      <Textarea
        value={description}
        onChange={(e) => setValue({ ...value, description: e.target.value })}
      />
    </div>
  )
}
