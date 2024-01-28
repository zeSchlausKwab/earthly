import { useNDKStore } from "~/store/ndk-store";
import { useEffect, useState } from "react";
import { type NDKEvent } from "@nostr-dev-kit/ndk";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { decodeNaddr } from "~/utils/naddr";

export default function NostrFeature({ naddr }: { naddr: string }) {
  const { ndk } = useNDKStore();
  const [featureEvent, setFeatureEvent] = useState<NDKEvent>();

  const naddrData = decodeNaddr(naddr);

  useEffect(() => {
    const sub = ndk?.subscribe({
      authors: [naddrData.pubkey],
      "#d": [naddrData.identifier],
    });

    sub?.on("event", (event: NDKEvent) => {
      setFeatureEvent(event);
    });

    return () => {
      if (sub) sub.stop();
    };
  }, [ndk]);

  return (
    <div className={"rounded-lg border p-2 text-sm"}>
      {naddr}
      {naddrData.identifier}
      {featureEvent && (
        <div className={"p-3"}>
          <Accordion type="single" collapsible>
            <AccordionItem value="item-1">
              <AccordionTrigger>
                <b>{featureEvent.tagValue("title")}</b>
                <p>{featureEvent.content}</p>
              </AccordionTrigger>
              <AccordionContent>
                <div>{featureEvent.created_at}</div>
                <b>{featureEvent.id}</b>
                <div>{featureEvent.pubkey}</div>
                <div>{JSON.stringify(naddrData)}</div>
                <div>{featureEvent.tagValue("color")}</div>
                <div>{featureEvent.tagValue("type")}</div>
                <div>{featureEvent.tagValue("coordinates")}</div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </div>
  );
}
