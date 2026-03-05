"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

type Props = {
  latitude: number;
  longitude: number;
  address: string | null;
  neighborhood: string | null;
};

export function ListingLocationMap({ latitude, longitude, address, neighborhood }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let map: import("maplibre-gl").Map;

    import("maplibre-gl").then((maplibre) => {
      if (!containerRef.current) return;

      map = new maplibre.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [longitude, latitude],
        zoom: 14.5,
        attributionControl: false,
        scrollZoom: false,
      });

      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-left");

      map.on("load", () => {
        // Pin marker
        const el = document.createElement("div");
        el.style.cssText = `
          width: 40px;
          height: 40px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          background: var(--accent, #C27D3A);
          border: 3px solid white;
          box-shadow: 0 2px 12px rgba(0,0,0,0.25);
          cursor: default;
        `;

        new maplibre.Marker({ element: el, anchor: "bottom", offset: [0, -6] })
          .setLngLat([longitude, latitude])
          .addTo(map);
      });

      mapRef.current = map;
    });

    return () => {
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayLocation = neighborhood ?? (address ? address.split(",").slice(-2).join(",").trim() : null) ?? "New York, NY";

  return (
    <section>
      <h2 className="text-[1.375rem] font-semibold text-[var(--foreground)] mb-1">Where you&apos;ll be</h2>
      {displayLocation && (
        <p className="text-[var(--muted)] text-base mb-5">{displayLocation}</p>
      )}
      <div
        ref={containerRef}
        className="w-full rounded-2xl overflow-hidden"
        style={{ height: 460 }}
      />
    </section>
  );
}
