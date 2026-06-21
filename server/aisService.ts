/**
 * AISstream.io WebSocket client — Hormuz Crisis Vessel Tracker
 *
 * AISstream uses terrestrial AIS receivers. The Persian Gulf / Hormuz region
 * has NO receiver coverage (conflict zone). We therefore subscribe to the
 * GLOBAL stream and filter in-memory for the expanded crisis region:
 *
 *   Region A: Persian Gulf + Strait of Hormuz + Gulf of Oman
 *             (20–30°N, 46–65°E)
 *   Region B: Northern Arabian Sea — diverted tanker anchoring zone
 *             (14–26°N, 55–72°E)
 *   Region C: Red Sea / Suez alternative route
 *             (12–30°N, 32–46°E)
 *
 * If no vessels appear it means AISstream genuinely has no receivers
 * covering that sea area — this is the real-world data reality.
 *
 * Get a free key at https://aisstream.io (GitHub login, no credit card).
 * Set AIS_API_KEY=<your-key> in .env
 */

import WebSocket from "ws";

const NAV_STATUS: Record<number, string> = {
  0: "Under way (engine)",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted manoeuvrability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Engaged in fishing",
  8: "Under way (sail)",
  15: "Undefined",
};

export interface AisVessel {
  mmsi: number;
  name: string;
  lat: number;
  lon: number;
  cog: number;
  heading: number;   // 511 = not available
  sog: number;
  navStatus: number;
  navStatusLabel: string;
  shipType: number;
  updatedAt: string;
}

const vessels = new Map<number, AisVessel>();

// Bounding regions for the Hormuz crisis area
const REGIONS = [
  { name: "Persian Gulf / Hormuz / Gulf of Oman", latMin: 20.0, latMax: 30.5, lonMin: 46.0, lonMax: 65.0 },
  { name: "Northern Arabian Sea (diversion zone)",  latMin: 14.0, latMax: 26.0, lonMin: 55.0, lonMax: 72.0 },
  { name: "Red Sea / Suez alternative",             latMin: 12.0, latMax: 30.0, lonMin: 32.0, lonMax: 46.0 },
];

function inRegion(lat: number, lon: number): boolean {
  return REGIONS.some(r => lat >= r.latMin && lat <= r.latMax && lon >= r.lonMin && lon <= r.lonMax);
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let isConnected = false;
let lastMessageAt: Date | null = null;
let connectionAttempts = 0;

function connect(apiKey: string) {
  if (ws) { try { ws.terminate(); } catch (_) {} ws = null; }

  connectionAttempts++;
  console.log(`[AIS] Connecting to AISstream (attempt ${connectionAttempts})...`);

  ws = new WebSocket("wss://stream.aisstream.io/v0/stream");

  ws.on("open", () => {
    isConnected = true;
    connectionAttempts = 0;
    console.log("[AIS] Connected. Subscribing to global stream (filtering for Hormuz crisis region)...");

    // Global subscription — we filter by region in-memory
    // because AISstream has no terrestrial receivers in the Middle East
    ws!.send(JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FilterMessageTypes: ["PositionReport", "ShipStaticData"],
    }));
  });

  ws.on("message", (data: WebSocket.RawData) => {
    try {
      const msg = JSON.parse(data.toString());
      lastMessageAt = new Date();

      if (msg.MessageType === "PositionReport") {
        const pr = msg.Message?.PositionReport;
        const meta = msg.Metadata || {};
        if (!pr || !pr.Valid) return;

        const lat: number = pr.Latitude;
        const lon: number = pr.Longitude;

        // Filter: only keep vessels in our crisis regions
        if (!inRegion(lat, lon)) return;

        const mmsi: number = pr.UserID ?? meta.MMSI;
        if (!mmsi) return;

        const existing = vessels.get(mmsi);
        vessels.set(mmsi, {
          mmsi,
          name: meta.ShipName?.trim() || existing?.name || `MMSI ${mmsi}`,
          lat,
          lon,
          cog: pr.Cog ?? 0,
          heading: pr.TrueHeading ?? 511,
          sog: pr.Sog ?? 0,
          navStatus: pr.NavigationalStatus ?? 15,
          navStatusLabel: NAV_STATUS[pr.NavigationalStatus ?? 15] ?? "Undefined",
          shipType: existing?.shipType ?? 0,
          updatedAt: meta.time_utc || new Date().toISOString(),
        });
      }

      if (msg.MessageType === "ShipStaticData") {
        const ssd = msg.Message?.ShipStaticData;
        const meta = msg.Metadata || {};
        if (!ssd) return;
        const mmsi: number = ssd.UserID ?? meta.MMSI;
        if (!mmsi) return;

        const existing = vessels.get(mmsi);
        if (existing) {
          const name = ssd.Name?.trim();
          if (name) existing.name = name;
          if (ssd.Type) existing.shipType = ssd.Type;
          vessels.set(mmsi, existing);
        }
      }
    } catch (_) {}
  });

  ws.on("error", (err) => {
    console.error("[AIS] WebSocket error:", err.message);
    isConnected = false;
  });

  ws.on("close", (code) => {
    isConnected = false;
    const delay = Math.min(30_000, 5_000 * connectionAttempts);
    console.log(`[AIS] Disconnected (${code}). Reconnecting in ${delay/1000}s...`);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect(apiKey), delay);
  });
}

function pruneStale() {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [mmsi, v] of vessels) {
    if (new Date(v.updatedAt).getTime() < cutoff) vessels.delete(mmsi);
  }
}

export function startAisService() {
  const apiKey = process.env.AIS_API_KEY;
  if (!apiKey) {
    console.log("[AIS] AIS_API_KEY not set — live feed disabled. Snapshot mode active.");
    return;
  }
  connect(apiKey);
  setInterval(pruneStale, 5 * 60 * 1000);
}

export function getAisStatus() {
  return {
    enabled: !!process.env.AIS_API_KEY,
    connected: isConnected,
    vesselCount: vessels.size,
    lastMessageAt: lastMessageAt?.toISOString() ?? null,
    note: vessels.size === 0 && isConnected
      ? "No AIS receivers in this region — sparse traffic reflects the crisis reality. AISstream coverage is terrestrial only."
      : null,
  };
}

export function getVessels(): AisVessel[] {
  return Array.from(vessels.values());
}
