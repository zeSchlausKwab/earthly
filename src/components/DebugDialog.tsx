import React from "react";
import JsonView from "react18-json-view";
import "react18-json-view/src/style.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import type { NDKGeoEvent } from "@/lib/ndk/NDKGeoEvent";
import type { NDKGeoCollectionEvent } from "@/lib/ndk/NDKGeoCollectionEvent";

interface DebugDialogProps {
  event: NDKGeoEvent | NDKGeoCollectionEvent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const DebugDialog: React.FC<DebugDialogProps> = ({
  event,
  open,
  onOpenChange,
}) => {
  const rawEvent = event.rawEvent();
  const isCollection = "metadata" in event && "datasetReferences" in event;
  const displayName = isCollection
    ? event.metadata?.name ?? event.collectionId ?? event.id
    : ((event.featureCollection as any)?.name as string | undefined) ??
      event.datasetId ??
      event.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Geo Event Debug</DialogTitle>
          <DialogDescription>
            Raw Nostr event data for {displayName || event.id || "Untitled"}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-auto rounded-md bg-gray-50 p-4">
          <JsonView src={rawEvent} collapsed={1} />
        </div>
      </DialogContent>
    </Dialog>
  );
};
