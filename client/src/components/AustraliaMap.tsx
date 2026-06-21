import { useEffect, useRef } from "react";
import L from "leaflet";

// ── Shortage status data ──────────────────────────────────────────────────────
const STATE_NAME_TO_ABBR: Record<string, string> = {
  "New South Wales": "NSW",
  "Victoria": "VIC",
  "Queensland": "QLD",
  "Western Australia": "WA",
  "South Australia": "SA",
  "Tasmania": "TAS",
  "Northern Territory": "NT",
  "Australian Capital Territory": "ACT",
};

type ShortageLevel = "critical" | "severe" | "moderate" | "watch" | "ok";

const STATE_STATUS: Record<string, {
  level: ShortageLevel;
  diesel: string;
  unleaded: string;
  note: string;
}> = {
  NT:  { level: "critical",  diesel: "DRY in remote areas",            unleaded: "CRITICAL — rationing active",        note: "Most remote communities dry. Alice Springs limited. Darwin metro strained." },
  QLD: { level: "severe",    diesel: "SEVERE — regional dry",          unleaded: "SEVERE — 200+ stations out",         note: "Regional QLD worst affected. Cairns, Townsville, Mt Isa critically low. SEQ metro low stock." },
  WA:  { level: "severe",    diesel: "SEVERE — Pilbara/Kimberley dry", unleaded: "MODERATE metro, SEVERE regional",    note: "Perth metro strained. Pilbara mining ops on emergency rationing. Kimberley communities dry." },
  NSW: { level: "moderate",  diesel: "MODERATE — 1 in 7 stations out", unleaded: "MODERATE — rolling shortages",       note: "1-in-7 retailers out at peak. Regional NSW more affected than Sydney metro." },
  SA:  { level: "moderate",  diesel: "MODERATE — Outback routes dry",  unleaded: "WATCH — Adelaide metro",             note: "Outback SA routes critically low. Adelaide metro under strain." },
  VIC: { level: "watch",     diesel: "WATCH — price spike, supply ok", unleaded: "WATCH — spot shortages",             note: "Metro supply maintained at very low buffer. Price spike +40% diesel." },
  TAS: { level: "watch",     diesel: "WATCH — shipping delays",        unleaded: "WATCH — limited buffer",             note: "Bass Strait shipping adds transit risk. No dry stations yet." },
  ACT: { level: "ok",        diesel: "LOW — price elevated",           unleaded: "LOW — supply maintained",            note: "Supplied via NSW pipeline. No dry stations. Reserve buffer ~18 days." },
};

const LEVEL_FILL: Record<ShortageLevel, string> = {
  critical: "#7f1d1d",
  severe:   "#7c2d12",
  moderate: "#78350f",
  watch:    "#713f12",
  ok:       "#1e3a2f",
};
const LEVEL_STROKE: Record<ShortageLevel, string> = {
  critical: "#ef4444",
  severe:   "#f97316",
  moderate: "#f59e0b",
  watch:    "#eab308",
  ok:       "#22c55e",
};
const LEVEL_LABEL: Record<ShortageLevel, string> = {
  critical: "CRITICAL",
  severe:   "SEVERE",
  moderate: "MODERATE",
  watch:    "WATCH",
  ok:       "OK",
};

// ── Confirmed hotspot locations ───────────────────────────────────────────────
const HOTSPOTS = [
  { name: "Alice Springs, NT",  lat: -23.70, lng: 133.88, status: "dry",      fuels: "Diesel + Unleaded", note: "All independent stations exhausted. BP/Shell rationing 20L/visit.", source: "ABC News" },
  { name: "Darwin, NT",         lat: -12.46, lng: 130.84, status: "low",      fuels: "Diesel",            note: "Port supply strained. Trucking facing 48hr procurement delays.",    source: "LastDrop AU" },
  { name: "Cairns, QLD",        lat: -16.92, lng: 145.77, status: "dry",      fuels: "Unleaded",          note: "Independent station dry. Queue times 2–4hrs at major chains.",      source: "BBC News" },
  { name: "Townsville, QLD",    lat: -19.26, lng: 146.82, status: "critical", fuels: "Diesel",            note: "Port receiving reduced tanker volumes. Defence base priority alloc.", source: "SBS News" },
  { name: "Mt Isa, QLD",        lat: -20.73, lng: 139.50, status: "critical", fuels: "Diesel + Unleaded", note: "Mining supply chain severely disrupted. Emergency govt allocation.",  source: "SBS News" },
  { name: "Pilbara, WA",        lat: -21.60, lng: 117.10, status: "critical", fuels: "Diesel",            note: "Iron ore mine operators on emergency ration protocols.",              source: "AI Group" },
  { name: "Kimberley, WA",      lat: -17.00, lng: 124.00, status: "dry",      fuels: "Diesel + Unleaded", note: "Remote communities fully dry. Fuel airlifted to critical sites.",    source: "SBS News" },
  { name: "Regional NSW",       lat: -33.00, lng: 146.50, status: "low",      fuels: "Diesel + Unleaded", note: "1-in-7 retailers out at peak. Rolling shortages continue.",           source: "BBC News" },
  { name: "Outback SA",         lat: -28.00, lng: 135.00, status: "dry",      fuels: "Unleaded",          note: "Stuart Hwy stops critically low. Carry 200L reserve. SAPOL advisory.", source: "FuelCrisis AU" },
];

const HOTSPOT_COLOUR: Record<string, string> = {
  dry:      "#ef4444",
  critical: "#f97316",
  low:      "#f59e0b",
  limited:  "#eab308",
  ok:       "#22c55e",
};
const HOTSPOT_LABEL: Record<string, string> = {
  dry: "DRY", critical: "CRITICAL", low: "LOW", limited: "LIMITED", ok: "OK",
};

// Fix Leaflet default icon path (broken in bundlers)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl:       "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl:     "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export default function AustraliaMap() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Initialise map
    const map = L.map(containerRef.current, {
      center: [-25.5, 134.0],
      zoom: 4,
      minZoom: 3,
      maxZoom: 13,
      zoomControl: true,
      scrollWheelZoom: true,
    });
    mapRef.current = map;

    // Dark tile layer — CartoDB Dark Matter (free, no API key)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    // Fetch and render state GeoJSON choropleth
    fetch("/states.geojson")
      .then(r => r.json())
      .then(statesGeoJson => {
    L.geoJSON(statesGeoJson, {
      style: (feature) => {
        const name = feature?.properties?.STATE_NAME ?? "";
        const abbr = STATE_NAME_TO_ABBR[name] ?? "";
        const info = STATE_STATUS[abbr];
        const lv: ShortageLevel = info?.level ?? "ok";
        return {
          fillColor:   LEVEL_FILL[lv],
          fillOpacity: 0.75,
          color:       LEVEL_STROKE[lv],
          weight:      1.5,
          opacity:     0.9,
        };
      },
      onEachFeature: (feature, layer) => {
        const name = feature?.properties?.STATE_NAME ?? "";
        const abbr = STATE_NAME_TO_ABBR[name] ?? "";
        const info = STATE_STATUS[abbr];
        if (!info) return;
        const lv = info.level;
        const col = LEVEL_STROKE[lv];

        layer.bindPopup(`
          <div style="font-family:system-ui,sans-serif;min-width:220px">
            <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:6px">
              ${name} (${abbr})
              <span style="font-size:10px;font-weight:700;color:${col};background:rgba(0,0,0,0.4);border:1px solid ${col};padding:1px 6px;border-radius:4px;margin-left:6px">${LEVEL_LABEL[lv]}</span>
            </div>
            <div style="font-size:11px;color:#94a3b8;line-height:1.7">
              <div><span style="color:#64748b;width:70px;display:inline-block">Diesel</span><span style="color:${col}">${info.diesel}</span></div>
              <div><span style="color:#64748b;width:70px;display:inline-block">Unleaded</span><span style="color:${col}">${info.unleaded}</span></div>
              <div style="margin-top:6px;color:#94a3b8">${info.note}</div>
              <div style="margin-top:4px;font-size:10px;color:#475569">Updated Jun 4 2026 · DCCEEW + news reports</div>
            </div>
          </div>
        `, { maxWidth: 300, className: "au-map-popup" });

        // Highlight on hover
        layer.on("mouseover", () => {
          (layer as L.Path).setStyle({ fillOpacity: 0.92, weight: 2.5 });
        });
        layer.on("mouseout", () => {
          (layer as L.Path).setStyle({ fillOpacity: 0.75, weight: 1.5 });
        });
      },
    }).addTo(map);
      }); // end fetch .then

    // Hotspot circle markers
    HOTSPOTS.forEach((hs) => {
      const col = HOTSPOT_COLOUR[hs.status] ?? "#94a3b8";
      const label = HOTSPOT_LABEL[hs.status] ?? hs.status.toUpperCase();

      // Outer pulse ring
      const pulse = L.circleMarker([hs.lat, hs.lng], {
        radius: 14,
        color: col,
        weight: 1.5,
        fillColor: col,
        fillOpacity: 0.12,
        opacity: 0.5,
        interactive: false,
        pane: "shadowPane",
      }).addTo(map);

      // Inner dot
      const marker = L.circleMarker([hs.lat, hs.lng], {
        radius: 7,
        color: "#0f172a",
        weight: 2,
        fillColor: col,
        fillOpacity: 1,
      }).addTo(map);

      marker.bindPopup(`
        <div style="font-family:system-ui,sans-serif;min-width:200px">
          <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:5px">
            ${hs.name}
            <span style="font-size:10px;font-weight:700;color:${col};background:rgba(0,0,0,0.4);border:1px solid ${col};padding:1px 5px;border-radius:4px;margin-left:5px">${label}</span>
          </div>
          <div style="font-size:11px;color:#94a3b8;line-height:1.7">
            <div><span style="color:#64748b">Fuels: </span>${hs.fuels}</div>
            <div style="margin-top:4px">${hs.note}</div>
            <div style="margin-top:5px;font-size:10px;color:#475569">Source: ${hs.source}</div>
          </div>
        </div>
      `, { maxWidth: 280, className: "au-map-popup" });
    });

    // Legend control
    const legend = new L.Control({ position: "bottomright" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div");
      div.innerHTML = `
        <div style="background:rgba(15,23,42,0.92);border:1px solid #334155;border-radius:8px;padding:10px 12px;font-family:system-ui,sans-serif;font-size:11px;min-width:130px">
          <div style="font-weight:700;color:#e2e8f0;margin-bottom:6px;font-size:12px">Shortage Level</div>
          ${(["critical","severe","moderate","watch","ok"] as ShortageLevel[]).map(lv => `
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="width:12px;height:12px;border-radius:3px;background:${LEVEL_FILL[lv]};border:1.5px solid ${LEVEL_STROKE[lv]};flex-shrink:0;display:inline-block"></span>
              <span style="color:${LEVEL_STROKE[lv]};font-weight:600">${LEVEL_LABEL[lv]}</span>
            </div>
          `).join("")}
          <div style="border-top:1px solid #1e293b;margin-top:6px;padding-top:6px;display:flex;align-items:center;gap:6px">
            <span style="width:12px;height:12px;border-radius:50%;background:#ef4444;flex-shrink:0;display:inline-block"></span>
            <span style="color:#94a3b8">Confirmed hotspot</span>
          </div>
        </div>
      `;
      return div;
    };
    legend.addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
      <div className="text-sm font-bold text-slate-100 mb-1">Geographical Shortage Map</div>
      <div className="text-xs text-slate-500 mb-3">
        Click any state or marker for details · Scroll to zoom · Drag to pan
      </div>
      <div
        ref={containerRef}
        style={{ height: 520, borderRadius: 8, overflow: "hidden", zIndex: 0 }}
        className="w-full border border-slate-700/40"
      />
      <div className="text-[10px] text-slate-600 mt-2 text-right">
        Tiles © CARTO · Boundaries © OpenStreetMap · Severity based on DCCEEW + verified news · Updated Jun 4 2026
      </div>
    </div>
  );
}
