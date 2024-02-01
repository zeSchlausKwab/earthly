import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@radix-ui/react-collapsible"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@radix-ui/react-popover"
import { PanelTopOpen } from "lucide-react"
import { useState } from "react"
import { useEditingCollectionStore } from "~/store/edit-collection-store"
import { RouterOutputs, api } from "~/utils/api"
import { Button } from "../ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command"

type Category = RouterOutputs["curatedItems"]["allCategories"][0]
type CuratedFeature = Category["curatedFeature"][0]

function CategoryItem({ category }: { category: Category }) {
  const [open, setOpen] = useState(false)
  const [selectedStatus, setSelectedStatus] =
    useState<CuratedFeature>(undefined)

  const utils = api.useUtils()

  const { addCuratedFeature } = useEditingCollectionStore()

  const handleItemSelected = async (value: string) => {
    const curatedFeature = await utils.curatedItems.getOne.fetch({ id: value })
    if (!curatedFeature) return
    addCuratedFeature(curatedFeature)
  }

  return (
    <div className="flex items-center space-x-4">
      <p className="text-sm text-muted-foreground">{category.name}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="justify-start">
            {selectedStatus ? (
              <>{selectedStatus.name}</>
            ) : (
              <>+ add one of {category.name}</>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="p-0" side="right" align="start">
          <Command>
            <CommandInput placeholder="Change status..." />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {category.curatedFeature.map((feature: CuratedFeature) => (
                  <CommandItem
                    key={feature.name}
                    value={feature.name}
                    onSelect={(value) => {
                      setSelectedStatus(
                        category.curatedFeature.find(
                          (f: CuratedFeature) => f.name === value,
                        ) ?? null,
                      )
                      void handleItemSelected(feature.id as string)
                      setOpen(false)
                    }}
                  >
                    {feature.admin}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default function CuratedItems({}) {
  const [isOpen, setIsOpen] = useState(false)

  const { data } = api.curatedItems.allCategories.useQuery()

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="space-y-2">
      <div className="flex items-center justify-between space-x-4 px-4">
        <h4 className="text-sm font-semibold">add a curated item</h4>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm">
            <PanelTopOpen className="h-4 w-4" />
            <span className="sr-only">Toggle</span>
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-2">
        {data?.map((category: string) => {
          return <CategoryItem category={category} />
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}
