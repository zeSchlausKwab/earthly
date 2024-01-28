import { useNDKStore } from "~/store/ndk-store";
import NostrFeature from "~/pages/components/nostr-feature";
import { Button } from "~/components/ui/button";
import { publicKeyTest } from "~/pages";
import { useEditingCollectionStore } from "~/store/edit-collection-store";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { useRecentCollectionsStore } from "~/store/recent-collections-store";

export default function RecentStories() {
  const { collections } = useRecentCollectionsStore();
  const { setGeometryFromNostr } = useEditingCollectionStore();

  const handleEdit = (naddr: string) => {
    setGeometryFromNostr(naddr);
  };

  const handleClone = () => {
    console.log("clone");
  };

  return (
    <div className={"break-all rounded-lg border text-sm"}>
      {collections.map((collection, index) => {
        return (
          <div key={collection.naddr} className={"p-3"}>
            <div className={"flex justify-between"}>
              <b>{collection.title}</b>
              {publicKeyTest === collection.pubkey ? (
                <Button onClick={() => handleEdit(collection.naddr)}>
                  edit
                </Button>
              ) : (
                <Button onClick={handleClone}>clone</Button>
              )}
            </div>
            <b>{collection.naddr}</b>
            <div>{collection.identifier}</div>
            <div>{collection.published_at}</div>
            <div>{collection.description}</div>
            <Accordion type="single" collapsible>
              <AccordionItem value="item-1">
                <AccordionTrigger>geometry</AccordionTrigger>
                <AccordionContent className={"flex flex-col gap-2"}>
                  {collection.featureNaddrs.map((tag) => {
                    return <NostrFeature key={tag} naddr={tag} />;
                  })}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        );
      })}
    </div>
  );
}
