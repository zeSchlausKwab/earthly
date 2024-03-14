import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs"
import RecentCollections from "./recent-collections"
import RecentFeatures from "./recent-features"

export default function RecentItemsLists() {
  return (
    <Tabs defaultValue="places" className="w-full">
      <TabsList className="w-full justify-between">
        <TabsTrigger value="places">Places</TabsTrigger>
        <TabsTrigger value="collections">Collections</TabsTrigger>
      </TabsList>
      <TabsContent value="places">
        <RecentFeatures />
      </TabsContent>
      <TabsContent value="collections">
        <RecentCollections />
      </TabsContent>
    </Tabs>
  )
}
