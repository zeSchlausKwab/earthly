import { X } from "lucide-react";
import React, { useRef } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../../components/ui/select";
import { useEditorStore } from "../store";

export function MapSettingsPanel() {
    const mapSource = useEditorStore((state) => state.mapSource);
    const setMapSource = useEditorStore((state) => state.setMapSource);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleSourceTypeChange = (value: "default" | "pmtiles") => {
        setMapSource({
            ...mapSource,
            type: value,
            // Reset location if switching to default, or keep if pmtiles
            location: value === "default" ? "remote" : mapSource.location,
        });
    };

    const handleLocationChange = (value: "remote" | "local") => {
        setMapSource({
            ...mapSource,
            location: value,
        });
    };

    const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setMapSource({
            ...mapSource,
            url: e.target.value,
        });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setMapSource({
                ...mapSource,
                file,
            });
        }
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Map Source</Label>
                <Select
                    value={mapSource.type}
                    onValueChange={handleSourceTypeChange}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select source" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="default">Default (OpenFreeMap)</SelectItem>
                        <SelectItem value="pmtiles">Protomaps (PMTiles)</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {mapSource.type === "pmtiles" && (
                <>
                    <div className="space-y-2">
                        <Label>Location</Label>
                        <Select
                            value={mapSource.location}
                            onValueChange={handleLocationChange}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Select location" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="remote">Remote URL</SelectItem>
                                <SelectItem value="local">Local File</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {mapSource.location === "remote" ? (
                        <div className="space-y-2">
                            <Label>URL</Label>
                            <Input
                                value={mapSource.url || ""}
                                onChange={handleUrlChange}
                                placeholder="https://example.com/map.pmtiles"
                            />
                            <p className="text-xs text-gray-500">
                                Enter the URL to a remote PMTiles file.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label>File</Label>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    {mapSource.file ? mapSource.file.name : "Select File"}
                                </Button>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    className="hidden"
                                    accept=".pmtiles"
                                    onChange={handleFileChange}
                                />
                            </div>
                            <p className="text-xs text-gray-500">
                                Select a local .pmtiles file from your device.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
