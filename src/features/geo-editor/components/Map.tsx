import { layers as protomapsLayers, namedFlavor } from "@protomaps/basemaps";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import React, { createContext, useContext, useEffect, useRef, useState } from "react";

interface MapContextType {
    map: maplibregl.Map | null;
    isLoaded: boolean;
}

const MapContext = createContext<MapContextType>({ map: null, isLoaded: false });

export const useMap = () => useContext(MapContext);

export interface MapSource {
    type: "default" | "pmtiles";
    location: "remote" | "local";
    url?: string;
    file?: File;
}

interface MapProps {
    style?: string | maplibregl.StyleSpecification;
    center?: [number, number];
    zoom?: number;
    children?: React.ReactNode;
    className?: string;
    onLoad?: (map: maplibregl.Map) => void;
    mapSource?: MapSource;
}

export const Map: React.FC<MapProps> = ({
    style: initialStyle = "https://tiles.openfreemap.org/styles/liberty",
    center = [-74.006, 40.7128],
    zoom = 12,
    children,
    className = "w-full h-full",
    onLoad,
    mapSource = { type: "default", location: "remote" },
}) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);
    const protocolRef = useRef<Protocol | null>(null);

    useEffect(() => {
        if (!protocolRef.current) {
            const protocol = new Protocol();
            maplibregl.addProtocol("pmtiles", protocol.tile);
            protocolRef.current = protocol;
        }

        if (!mapContainer.current || mapRef.current) return;

        const map = new maplibregl.Map({
            container: mapContainer.current,
            style: initialStyle,
            center,
            zoom,
        });

        mapRef.current = map;

        map.on("load", () => {
            setIsLoaded(true);
            if (onLoad) onLoad(map);
        });

        const resizeObserver = new ResizeObserver(() => {
            map.resize();
        });
        resizeObserver.observe(mapContainer.current);

        return () => {
            resizeObserver.disconnect();
            map.remove();
            mapRef.current = null;
        };
    }, []);

    // Handle map source updates
    const currentStyleUrlRef = useRef<string | null>(null);

    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const updateStyle = async () => {
            if (mapSource.type === "default") {
                if (currentStyleUrlRef.current === initialStyle) return;
                map.setStyle(initialStyle);
                currentStyleUrlRef.current = initialStyle as string;
            } else if (mapSource.type === "pmtiles") {
                let url = mapSource.url;

                if (mapSource.location === "local" && mapSource.file) {
                    url = URL.createObjectURL(mapSource.file);
                }

                if (!url) return;

                // Ensure pmtiles:// prefix
                const pmtilesUrl = url.startsWith("pmtiles://") ? url : `pmtiles://${url}`;

                // Avoid reloading if it's the same PMTiles URL (simplified check)
                // Note: constructing the style object every time makes strict equality hard, 
                // but we can check the URL if we want. For now, let's just rely on the fact 
                // that mapSource object identity changes. 
                // Actually, let's track the pmtilesUrl.
                if (currentStyleUrlRef.current === pmtilesUrl) return;

                const style: maplibregl.StyleSpecification = {
                    version: 8,
                    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
                    sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
                    sources: {
                        protomaps: {
                            type: "vector",
                            url: pmtilesUrl,
                            attribution: '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org">OpenStreetMap</a>',
                        },
                    },
                    layers: protomapsLayers("protomaps", namedFlavor("light"), { lang: "en" }),
                };

                map.setStyle(style);
                currentStyleUrlRef.current = pmtilesUrl;
            }
        };

        updateStyle();
    }, [mapSource, initialStyle]);

    // Handle prop updates for view state
    useEffect(() => {
        if (!mapRef.current) return;
        // We typically don't update center/zoom programmatically from props 
        // after init to avoid fighting with user interaction, 
        // unless it's a specific "flyTo" action which is usually handled via refs or events.
    }, [center, zoom]);

    return (
        <MapContext.Provider value={{ map: mapRef.current, isLoaded }}>
            <div ref={mapContainer} className={className} />
            {children}
        </MapContext.Provider>
    );
};
