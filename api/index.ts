/**
 * Vercel Serverless Function — Fuel Crisis Transparency Aus
 *
 * Self-contained proxy routes only. No SQLite/better-sqlite3 dependency.
 * The full Express server (with DB) runs only on the pplx.app deployment.
 *
 * Routes exposed:
 *   GET /api/proxy/vessels    — tanker positions from lastdrop.au
 *   GET /api/proxy/day-counts — fuel day-of-supply from lastdrop.au
 *   GET /api/proxy/brent      — Brent crude price from Yahoo Finance / stooq
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";

// ── Static snapshot fallbacks (Jun 20 2026) ──────────────────────────────────
const STATIC_VESSELS: any[] = [
  {mmsi:"241632000",name:"SEA DOLPHIN",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.42,cargoConfidence:"high",isProductTanker:true,destination:"AUBNE",destinationConfidence:"high",eta:"9/6",origin:"Long Beach USA",distanceKm:89,source:"snapshot",supplyDays:0.366},
  {mmsi:"249329000",name:"HAFNIA LOTTE",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.5,cargoConfidence:"high",isProductTanker:true,destination:"AUSYD",destinationConfidence:"high",eta:"",origin:"Hong Kong",distanceKm:17,source:"snapshot",supplyDays:0.367},
  {mmsi:"255917256",name:"CAPE BONNY",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:38.13,cargoConfidence:"estimated",isProductTanker:true,destination:"SGSIN > AUKWI",destinationConfidence:"high",eta:"14/6",origin:"Singapore",distanceKm:37,source:"snapshot",supplyDays:0.329},
  {mmsi:"256627000",name:"SERIANA",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:93.49,cargoConfidence:"high",isProductTanker:true,destination:"BRISBANE",destinationConfidence:"high",eta:"",origin:"Singapore",distanceKm:87,source:"snapshot",supplyDays:0.807},
  {mmsi:"258032000",name:"BALLARD",detailedType:"other",fuelTypeConfidence:"inferred",cargoML:68.2,cargoConfidence:"high",isProductTanker:true,destination:"CNJGY>>AUKWI",destinationConfidence:"high",eta:"19/6",origin:"Jiangyin China",distanceKm:41,source:"snapshot",supplyDays:0.589},
  {mmsi:"311001600",name:"ICS TENACIOUS",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:7.1,cargoConfidence:"high",isProductTanker:true,destination:"MEL<>GEX",destinationConfidence:"high",eta:"17/6",origin:"Melbourne Australia",distanceKm:5,source:"snapshot",supplyDays:0.061},
  {mmsi:"352006555",name:"PIS MADURA",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.5,cargoConfidence:"high",isProductTanker:true,destination:"AU BSN FOR ORDERS",destinationConfidence:"high",eta:"",origin:"Ulsan Korea",distanceKm:null,source:"snapshot",supplyDays:0.367},
  {mmsi:"413258730",name:"XING TONG 799",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.47,cargoConfidence:"high",isProductTanker:true,destination:"AU DPO",destinationConfidence:"high",eta:"",origin:"Muara Brunei",distanceKm:15,source:"snapshot",supplyDays:0.367},
  {mmsi:"477147100",name:"FOREVER GLORY",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.47,cargoConfidence:"high",isProductTanker:true,destination:"AU BNE",destinationConfidence:"high",eta:"17/6",origin:"Marsden Point NZ",distanceKm:4,source:"snapshot",supplyDays:0.367},
  {mmsi:"477637200",name:"GOLDEN RESOLUTION",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:10.8,cargoConfidence:"high",isProductTanker:true,destination:"AU BTB",destinationConfidence:"high",eta:"",origin:"Pasir Gudang Malaysia",distanceKm:198,source:"snapshot",supplyDays:0.093},
  {mmsi:"503190890",name:"AURIGA TITAN",detailedType:"products",fuelType:"DIESEL",fuelTypeConfidence:"high",cargoML:4.14,cargoConfidence:"high",isProductTanker:true,destination:"BRISBANE",destinationConfidence:"high",eta:"",origin:"Brisbane Australia",distanceKm:7,source:"snapshot",supplyDays:0.045},
  {mmsi:"538010335",name:"PETITE SOEUR",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.86,cargoConfidence:"high",isProductTanker:true,destination:"AUGEX",destinationConfidence:"high",eta:"",origin:"Muara Brunei",distanceKm:46,source:"snapshot",supplyDays:0.370},
  {mmsi:"538011239",name:"SFL BONAIRE",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:28.34,cargoConfidence:"high",isProductTanker:true,destination:"AU BNE",destinationConfidence:"high",eta:"",origin:"Kuantan Malaysia",distanceKm:7,source:"snapshot",supplyDays:0.245},
  {mmsi:"538011585",name:"NORDIC MOON",detailedType:"crude",fuelTypeConfidence:"inferred",cargoML:131.56,cargoConfidence:"high",isProductTanker:true,destination:"AU BNE",destinationConfidence:"high",eta:"",origin:"Walvis Bay Namibia",distanceKm:17,source:"snapshot",supplyDays:1.136},
  {mmsi:"563085100",name:"OCEANA RIVER",detailedType:"crude",fuelTypeConfidence:"inferred",cargoML:96.11,cargoConfidence:"high",isProductTanker:true,destination:"AUBNE",destinationConfidence:"high",eta:"",origin:"Sungai Linggi Malaysia",distanceKm:88,source:"snapshot",supplyDays:0.830},
];

const STATIC_DAY_COUNTS: any[] = [
  {fuelType:"JET",   totalDays:27.69,inCountryDays:26.56,onWaterDays:1.12,likelyOnWaterDays:0,scheduledOnWaterDays:0,calculatedAt:"2026-06-20T07:01:32.060Z"},
  {fuelType:"DIESEL",totalDays:34.0, inCountryDays:32.79,onWaterDays:1.21,likelyOnWaterDays:0,scheduledOnWaterDays:0,calculatedAt:"2026-06-20T07:01:32.060Z"},
  {fuelType:"PETROL",totalDays:38.0, inCountryDays:37.06,onWaterDays:0.93,likelyOnWaterDays:0,scheduledOnWaterDays:0,calculatedAt:"2026-06-20T07:01:32.060Z"},
];

// ── Module-level cache (shared across warm invocations) ───────────────────────
let vesselCache: { data: any[]; ts: number } | null = null;
let dayCountCache: { data: any[]; ts: number } | null = null;
const VESSEL_TTL   = 2  * 60 * 1000; // 2 min
const DAYCOUNT_TTL = 5  * 60 * 1000; // 5 min

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = req.url ?? "";

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  // ── /api/proxy/vessels ──────────────────────────────────────────────────────
  if (url.startsWith("/api/proxy/vessels")) {
    if (vesselCache && Date.now() - vesselCache.ts < VESSEL_TTL) {
      res.setHeader("Cache-Control", "public, max-age=120");
      res.status(200).json(vesselCache.data);
      return;
    }
    try {
      const r = await fetch("https://www.lastdrop.au/api/vessels", {
        headers: { "User-Agent": "FuelCrisisTransparencyAus/1.0" },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`Upstream ${r.status}`);
      const raw = await r.json();
      const vessels: any[] = Array.isArray(raw) ? raw : (raw?.vessels ?? []);
      vesselCache = { data: vessels, ts: Date.now() };
      res.setHeader("Cache-Control", "public, max-age=120");
      res.status(200).json(vessels);
    } catch (_err) {
      const fallback = vesselCache?.data ?? STATIC_VESSELS;
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(fallback);
    }
    return;
  }

  // ── /api/proxy/day-counts ───────────────────────────────────────────────────
  if (url.startsWith("/api/proxy/day-counts")) {
    if (dayCountCache && Date.now() - dayCountCache.ts < DAYCOUNT_TTL) {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.status(200).json(dayCountCache.data);
      return;
    }
    try {
      const r = await fetch("https://www.lastdrop.au/api/day-counts", {
        headers: { "User-Agent": "FuelCrisisTransparencyAus/1.0" },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`Upstream ${r.status}`);
      const data = await r.json();
      const arr: any[] = Array.isArray(data) ? data : [];
      dayCountCache = { data: arr, ts: Date.now() };
      res.setHeader("Cache-Control", "public, max-age=300");
      res.status(200).json(arr);
    } catch (_err) {
      const fallback = dayCountCache?.data ?? STATIC_DAY_COUNTS;
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(fallback);
    }
    return;
  }

  // ── /api/proxy/brent ────────────────────────────────────────────────────────
  if (url.startsWith("/api/proxy/brent")) {
    // Try Yahoo Finance v8
    try {
      const yahooUrl = "https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=5d&includePrePost=false";
      const r = await fetch(yahooUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; FuelCrisisTransparencyAus/1.0)",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const json = await r.json();
        const meta = json?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          const price: number = meta.regularMarketPrice;
          const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price;
          const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
          res.setHeader("Cache-Control", "public, max-age=300");
          res.status(200).json({
            price,
            changePct: parseFloat(changePct.toFixed(2)),
            currency: meta.currency ?? "USD",
            source: "Yahoo Finance",
            symbol: meta.symbol ?? "BZ=F",
            timestamp: meta.regularMarketTime
              ? new Date(meta.regularMarketTime * 1000).toISOString()
              : new Date().toISOString(),
          });
          return;
        }
      }
    } catch (_e) { /* fall through */ }

    // Fallback: stooq.com CSV
    try {
      const stooqUrl = "https://stooq.com/q/l/?s=lcoc.f&f=sd2t2ohlcv&h&e=csv";
      const r = await fetch(stooqUrl, {
        headers: { "User-Agent": "FuelCrisisTransparencyAus/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const text = await r.text();
        const lines = text.trim().split("\n");
        if (lines.length >= 2) {
          const cols = lines[1].split(",");
          const close = parseFloat(cols[6]);
          const open  = parseFloat(cols[3]);
          if (!isNaN(close)) {
            const changePct = open ? ((close - open) / open) * 100 : 0;
            res.setHeader("Cache-Control", "public, max-age=300");
            res.status(200).json({
              price: close,
              changePct: parseFloat(changePct.toFixed(2)),
              currency: "USD",
              source: "stooq",
              symbol: "Brent Crude",
              timestamp: new Date().toISOString(),
            });
            return;
          }
        }
      }
    } catch (_e) { /* fall through */ }

    // Last resort static fallback
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      price: 83.0,
      changePct: 0,
      currency: "USD",
      source: "static-fallback",
      symbol: "Brent Crude",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // ── Unrecognised route ──────────────────────────────────────────────────────
  res.status(404).json({ error: "Not found", path: url });
}
