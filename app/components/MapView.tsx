"use client";

import { useEffect, useRef } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

type MapListing = {
  id: string;
  latitude: number;
  longitude: number;
  price: number | null;
  neighborhood: string | null;
};

type Props = {
  listings: MapListing[];
  hoveredListingId: string | null;
  selectedNeighborhoods: Set<string>;
  onNeighborhoodToggle: (ntaname: string) => void;
  onPinHover: (id: string | null) => void;
  onPinClick: (id: string) => void;
};

function formatPriceLabel(price: number | null): string {
  if (price == null) return "";
  const k = price / 1000;
  if (k >= 1) {
    const rounded = Math.round(k * 10) / 10;
    return `$${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
  }
  return `$${price}`;
}

export function MapView({
  listings,
  hoveredListingId,
  selectedNeighborhoods,
  onNeighborhoodToggle,
  onPinHover,
  onPinClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("maplibre-gl").Map | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maplibreRef = useRef<any>(null);
  const styleLoadedRef = useRef(false);
  const hoveredNeighborhoodRef = useRef<string | null>(null);

  // Stable refs for callbacks and data
  const markersMapRef = useRef<Map<string, { marker: import("maplibre-gl").Marker; el: HTMLDivElement }>>(new Map());
  const listingsRef = useRef(listings);
  const onPinHoverRef = useRef(onPinHover);
  const onPinClickRef = useRef(onPinClick);
  const onNeighborhoodToggleRef = useRef(onNeighborhoodToggle);
  const refreshMarkersRef = useRef<(() => void) | null>(null);

  // Keep prop refs current every render
  listingsRef.current = listings;
  onPinHoverRef.current = onPinHover;
  onPinClickRef.current = onPinClick;
  onNeighborhoodToggleRef.current = onNeighborhoodToggle;

  // ── Initial map setup ──
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    import("maplibre-gl").then((maplibre) => {
      if (cancelled || !containerRef.current) return;
      maplibreRef.current = maplibre;

      const map = new maplibre.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [-73.9712, 40.7831],
        zoom: 11.5,
        attributionControl: false,
      });

      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");

      mapRef.current = map;

      // ── Refresh price marker pins ──
      const refreshMarkers = () => {
        if (!styleLoadedRef.current) return;

        markersMapRef.current.forEach(({ marker }) => marker.remove());
        markersMapRef.current.clear();

        listingsRef.current.forEach((l) => {
          if (l.price == null) return;

          const el = document.createElement("div");
          el.className = "price-marker";
          el.textContent = formatPriceLabel(l.price);
          el.addEventListener("click", () => onPinClickRef.current(l.id));
          el.addEventListener("mouseenter", () => onPinHoverRef.current(l.id));
          el.addEventListener("mouseleave", () => onPinHoverRef.current(null));

          const marker = new maplibre.Marker({ element: el, anchor: "bottom" })
            .setLngLat([l.longitude, l.latitude])
            .addTo(map);

          markersMapRef.current.set(l.id, { marker, el });
        });
      };

      refreshMarkersRef.current = refreshMarkers;

      map.on("load", () => {
        if (cancelled) return;
        styleLoadedRef.current = true;

        // ── Neighborhood source + layers ──
        map.addSource("neighborhoods", {
          type: "geojson",
          data: "/manhattan-neighborhoods.geojson",
        });

        const selectedArr = [...selectedNeighborhoods];

        map.addLayer({
          id: "neighborhood-fill",
          type: "fill",
          source: "neighborhoods",
          paint: {
            "fill-color": "#C27D3A",
            "fill-opacity": [
              "case",
              ["in", ["get", "ntaname"], ["literal", selectedArr]],
              0.22,
              0.03,
            ],
          },
        });

        map.addLayer({
          id: "neighborhood-outline",
          type: "line",
          source: "neighborhoods",
          paint: {
            "line-color": [
              "case",
              ["in", ["get", "ntaname"], ["literal", selectedArr]],
              "#C27D3A",
              "#C8BFB5",
            ],
            "line-width": [
              "case",
              ["in", ["get", "ntaname"], ["literal", selectedArr]],
              2,
              0.75,
            ],
          },
        });

        map.addLayer({
          id: "neighborhood-hover",
          type: "fill",
          source: "neighborhoods",
          paint: {
            "fill-color": "#C27D3A",
            "fill-opacity": 0.1,
          },
          filter: ["==", "ntaname", ""],
        });

        // ── Events ──
        map.on("click", "neighborhood-fill", (e) => {
          const feat = e.features?.[0];
          if (!feat) return;
          const name = feat.properties?.ntaname as string;
          if (name) onNeighborhoodToggleRef.current(name);
        });

        map.on("mousemove", "neighborhood-fill", (e) => {
          const feat = e.features?.[0];
          if (!feat) return;
          const name = feat.properties?.ntaname as string;
          if (name !== hoveredNeighborhoodRef.current) {
            hoveredNeighborhoodRef.current = name;
            map.setFilter("neighborhood-hover", ["==", "ntaname", name ?? ""]);
          }
          map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", "neighborhood-fill", () => {
          hoveredNeighborhoodRef.current = null;
          map.setFilter("neighborhood-hover", ["==", "ntaname", ""]);
          map.getCanvas().style.cursor = "";
        });

        // Add initial markers now that map is loaded
        refreshMarkers();
      });
    });

    return () => {
      cancelled = true;
      styleLoadedRef.current = false;
      markersMapRef.current.forEach(({ marker }) => marker.remove());
      markersMapRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Reactive: update neighborhood paint ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoadedRef.current) return;
    const selectedArr = [...selectedNeighborhoods];
    map.setPaintProperty("neighborhood-fill", "fill-opacity", [
      "case",
      ["in", ["get", "ntaname"], ["literal", selectedArr]],
      0.22,
      0.03,
    ]);
    map.setPaintProperty("neighborhood-outline", "line-color", [
      "case",
      ["in", ["get", "ntaname"], ["literal", selectedArr]],
      "#C27D3A",
      "#C8BFB5",
    ]);
    map.setPaintProperty("neighborhood-outline", "line-width", [
      "case",
      ["in", ["get", "ntaname"], ["literal", selectedArr]],
      2,
      0.75,
    ]);
  }, [selectedNeighborhoods]);

  // ── Reactive: rebuild price markers when listings change ──
  useEffect(() => {
    refreshMarkersRef.current?.();
  }, [listings]);

  // ── Reactive: update hover state on markers ──
  useEffect(() => {
    markersMapRef.current.forEach(({ el }, id) => {
      el.classList.toggle("active", id === hoveredListingId);
    });
  }, [hoveredListingId]);

  return <div ref={containerRef} className="w-full h-full" />;
}
