import * as React from "react"
import { useEffect } from "react"
import { Textarea } from "~/components/ui/textarea"
import { Input } from "~/components/ui/input"
import { Button } from "~/components/ui/button"

export default function FeaturePopup({
  featureId,
  currentDescription,
  currentTitle,
  currentColor,
  onChange,
  onDelete,
}: {
  featureId: string
  currentTitle: string | undefined
  currentColor: string | undefined
  currentDescription: string | undefined
  onChange: (
    featureId: string,
    title: string,
    description: string,
    color: string,
  ) => void
  onDelete: (featureId: string) => void
}) {
  const [value, setValue] = React.useState<{
    title: string
    color: string
    description: string
  }>({
    title: currentTitle ?? "",
    description: currentDescription ?? "",
    color: currentColor ?? "",
  })

  useEffect(() => {
    onChange(featureId, value.title, value.description, value.color)
  }, [value])

  return (
    <div>
      {featureId}
      <Input
        onChange={(e) => {
          const title = e.target.value || ""
          setValue({ ...value, title })
        }}
        defaultValue={currentTitle}
      />
      <Textarea
        onChange={(e) => {
          const description = e.target.value || ""
          setValue({ ...value, description })
        }}
        defaultValue={currentDescription}
      />
      <input
        type="color"
        onChange={(e) => {
          const color = e.target.value || ""
          setValue({ ...value, color })
        }}
        defaultValue={currentColor}
      />
      <Button onClick={() => onDelete(featureId)}>Delete</Button>
    </div>
  )
}
