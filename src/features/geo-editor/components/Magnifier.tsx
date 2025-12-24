import maplibregl from 'maplibre-gl';
import React, { useEffect, useRef } from 'react';

interface MagnifierProps {
	enabled: boolean;
	visible: boolean;
	position: { x: number; y: number };
	center: [number, number] | null;
	mainMap: maplibregl.Map | null;
	size: number;
}

export function Magnifier({ enabled, visible, position, center, mainMap, size }: MagnifierProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const mapRef = useRef<maplibregl.Map | null>(null);

	useEffect(() => {
		if (!enabled || !visible) return;
		if (!containerRef.current) return;
		if (!mainMap) return;

		if (!mapRef.current) {
			mapRef.current = new maplibregl.Map({
				container: containerRef.current,
				style: mainMap.getStyle() as any,
				center: mainMap.getCenter(),
				zoom: mainMap.getZoom() + 1,
				interactive: false,
				attributionControl: false,
				preserveDrawingBuffer: true
			} as any);

			mapRef.current.dragPan.disable();
			mapRef.current.scrollZoom.disable();
			mapRef.current.touchZoomRotate.disable();
			mapRef.current.doubleClickZoom.disable();
		} else {
			mapRef.current.resize();
		}

		return () => {
			mapRef.current?.remove();
			mapRef.current = null;
		};
	}, [enabled, visible, mainMap]);

	useEffect(() => {
		if (!enabled) return;
		if (!mapRef.current || !mainMap) return;
		if (!center) return;
		mapRef.current.jumpTo({
			center: center,
			zoom: mainMap.getZoom() + 1,
			bearing: mainMap.getBearing(),
			pitch: mainMap.getPitch()
		});
		mapRef.current.resize();
	}, [center, enabled, mainMap]);

	if (!enabled || !visible) return null;

	return (
		<div
			className="pointer-events-none absolute z-40"
			style={{
				width: size,
				height: size,
				left: position.x - size / 2,
				top: position.y - size / 2
			}}
		>
			<div className="relative h-full w-full overflow-hidden rounded-full border border-gray-300 bg-white shadow-xl">
				<div ref={containerRef} className="h-full w-full" />
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<svg
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						className="text-primary/50"
					>
						<line x1="12" y1="5" x2="12" y2="19" />
						<line x1="5" y1="12" x2="19" y2="12" />
					</svg>
				</div>
			</div>
		</div>
	);
}
