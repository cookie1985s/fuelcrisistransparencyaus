import type { Express } from "express";
import { createServer } from "http";
import { storage } from "./storage";
import { insertAlertThresholdSchema } from "@shared/schema";
import { fetchAbsSitcAll, SITC_CODES } from "./absFetcher";
// AIS live service removed — snapshot-only mode (free, no WebSocket dependency)

// Track in-flight sync to prevent concurrent runs
let syncInProgress = false;

/**
 * Run a full ABS data sync: fetch all SITC codes + all countries, upsert into DB.
 */
async function runSync(): Promise<{ success: boolean; results: any[] }> {
  if (syncInProgress) {
    return { success: false, results: [{ error: "Sync already in progress" }] };
  }
  syncInProgress = true;
  const results: any[] = [];

  try {
    for (const sitcCode of SITC_CODES) {
      try {
        const { rows, latestPeriod } = await fetchAbsSitcAll(sitcCode);
        if (rows.length > 0) {
          storage.upsertImportRows(rows);
        }
        storage.upsertSyncLog(sitcCode, latestPeriod || "", "ok");
        results.push({ sitcCode, rowCount: rows.length, latestPeriod, status: "ok" });
      } catch (err: any) {
        const msg = err?.message || "Unknown error";
        storage.upsertSyncLog(sitcCode, "", "error", msg);
        results.push({ sitcCode, status: "error", error: msg });
      }
    }
    return { success: true, results };
  } finally {
    syncInProgress = false;
  }
}

/**
 * Auto-sync on server startup if no data or data is stale (>24h old).
 */
async function autoSyncIfStale() {
  try {
    const logs = storage.getSyncLogs();
    const now = Date.now();
    const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

    const needsSync = logs.length === 0 || logs.some(log => {
      const age = now - new Date(log.lastSyncAt).getTime();
      return age > STALE_MS || log.status === "error";
    });

    if (needsSync) {
      console.log("[ABS Sync] Starting auto-sync (data stale or missing)...");
      const { results } = await runSync();
      console.log("[ABS Sync] Complete:", results.map(r => `${r.sitcCode}:${r.status}`).join(", "));
    } else {
      console.log("[ABS Sync] Data is fresh, skipping auto-sync");
    }
  } catch (err) {
    console.error("[ABS Sync] Auto-sync failed:", err);
  }
}

// Kick off auto-sync after a short delay (don't block startup)
setTimeout(autoSyncIfStale, 3000);

// ── DAILY SCHEDULED AUTO-SYNC ────────────────────────────────────────────────
// Runs every 24 hours so the public dashboard always has the latest ABS data
// without any manual intervention. ABS MERCH_IMP publishes ~4-6 weeks after
// month end, so daily polling ensures new months are caught promptly.
const DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
setInterval(async () => {
  console.log("[ABS Sync] Daily scheduled sync starting...");
  try {
    const { results } = await runSync();
    console.log("[ABS Sync] Daily sync complete:", results.map(r => `${r.sitcCode}:${r.status}`).join(", "));
  } catch (err) {
    console.error("[ABS Sync] Daily sync failed:", err);
  }
}, DAILY_SYNC_INTERVAL_MS);

export function registerRoutes(httpServer: ReturnType<typeof createServer>, app: Express) {

  // ── SYNC ENDPOINTS ───────────────────────────────────────────────────────────

  /** Manual sync trigger */
  app.post("/api/sync", async (_req, res) => {
    if (syncInProgress) {
      return res.status(409).json({ error: "Sync already in progress" });
    }
    // Fire and forget — client polls /api/sync/status
    runSync().catch(console.error);
    res.json({ ok: true, message: "Sync started" });
  });

  /** Sync status */
  app.get("/api/sync/status", (_req, res) => {
    const logs = storage.getSyncLogs();
    res.json({
      inProgress: syncInProgress,
      logs,
    });
  });

  // ── IMPORT DATA ENDPOINTS ─────────────────────────────────────────────────────

  /**
   * GET /api/import-data?sitcCode=562&countryCode=TOT
   * Returns rows for a single SITC + country.
   */
  app.get("/api/import-data", (req, res) => {
    const { sitcCode, countryCode } = req.query as Record<string, string>;
    if (!sitcCode || !countryCode) {
      return res.status(400).json({ error: "sitcCode and countryCode required" });
    }
    const rows = storage.getImportData(sitcCode, countryCode);
    res.json(rows);
  });

  /**
   * GET /api/import-data/multi?sitcCodes=562,272&countryCode=TOT
   * Returns rows for multiple SITC codes.
   */
  app.get("/api/import-data/multi", (req, res) => {
    const { sitcCodes, countryCode } = req.query as Record<string, string>;
    if (!sitcCodes || !countryCode) {
      return res.status(400).json({ error: "sitcCodes and countryCode required" });
    }
    const codes = sitcCodes.split(",").map(s => s.trim()).filter(Boolean);
    const rows = storage.getImportDataMulti(codes, countryCode);
    res.json(rows);
  });

  /**
   * GET /api/import-data/all
   * Returns all cached rows (for dashboard to process client-side).
   */
  app.get("/api/import-data/all", (_req, res) => {
    const rows = storage.getImportDataMulti([...SITC_CODES], "TOT");
    const countryRows = storage.getImportDataMulti([...SITC_CODES], "SAUD")
      .concat(storage.getImportDataMulti([...SITC_CODES], "QATA"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "OMAN"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "EGYP"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "RKOR"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "SING"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "CHIN"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "JAP"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "INIA"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "TAIW"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "INDO"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "MLAY"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "CAN"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "RUSS"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "BELA"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "FGMY"))
      .concat(storage.getImportDataMulti([...SITC_CODES], "MORO"));
    res.json([...rows, ...countryRows]);
  });

  // ── ALERT ENDPOINTS ──────────────────────────────────────────────────────────

  app.get("/api/alert-thresholds", (_req, res) => {
    res.json(storage.getAlertThresholds());
  });

  app.post("/api/alert-thresholds", (req, res) => {
    const parsed = insertAlertThresholdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error });
    const result = storage.upsertAlertThreshold(parsed.data);
    res.json(result);
  });

  app.get("/api/dismissed-alerts", (_req, res) => {
    res.json(storage.getDismissedAlerts());
  });

  app.post("/api/dismissed-alerts/:key", (req, res) => {
    const key = decodeURIComponent(req.params.key);
    if (key.length > 200) return res.status(400).json({ error: "Key too long" });
    const result = storage.dismissAlert(key);
    res.json(result);
  });

  app.delete("/api/dismissed-alerts/:key", (req, res) => {
    const key = decodeURIComponent(req.params.key);
    if (key.length > 200) return res.status(400).json({ error: "Key too long" });
    storage.restoreAlert(key);
    res.json({ ok: true });
  });

  // ── Fuel shortage crowd reports ──
  app.get("/api/fuel-reports", (_req, res) => {
    res.json(storage.getFuelReports(72));
  });

  app.get("/api/fuel-reports/count", (_req, res) => {
    res.json({ count: storage.getFuelReportCount() });
  });

  app.post("/api/fuel-reports", (req, res) => {
    const { suburb, state, fuelType, status, stationName, note } = req.body;
    if (!suburb || !state || !fuelType || !status) {
      return res.status(400).json({ error: "suburb, state, fuelType and status are required" });
    }
    const VALID_STATUS = ["dry", "low", "limited", "ok"];
    const VALID_FUEL = ["unleaded", "diesel", "e10", "lpg", "premium"];
    const VALID_STATE = ["NSW","VIC","QLD","WA","SA","TAS","NT","ACT"];
    if (!VALID_STATUS.includes(status)) return res.status(400).json({ error: "Invalid status" });
    if (!VALID_FUEL.includes(fuelType)) return res.status(400).json({ error: "Invalid fuelType" });
    if (!VALID_STATE.includes(state)) return res.status(400).json({ error: "Invalid state" });
    if (suburb.length > 80) return res.status(400).json({ error: "suburb too long" });
    const report = storage.addFuelReport({
      suburb: suburb.trim(),
      state,
      fuelType,
      status,
      stationName: stationName?.trim().slice(0,100) || null,
      note: note?.trim().slice(0,300) || null,
      reportedAt: new Date().toISOString(),
      lat: null,
      lng: null,
    });
    res.json(report);
  });

  // ── AIS vessel tracking removed — snapshot data is now embedded in frontend ──
  // (No backend dependency; snapshot dataset is served statically)

  // ── LASTDROP PROXY — avoids CORS on the published site ──────────────────────
  // Proxies lastdrop.au public API endpoints so the frontend can call our own
  // domain instead of a third-party origin. lastdrop.au data is publicly
  // accessible with no auth required.

  // ── In-memory cache for lastdrop.au (survives brief upstream outages) ──────
  let vesselCache: { data: any[]; ts: number } | null = null;
  let dayCountCache: { data: any[]; ts: number } | null = null;
  const VESSEL_TTL   = 2 * 60 * 1000;
  const DAYCOUNT_TTL = 5 * 60 * 1000;

  // Static snapshot — Jun 20 2026 (used when upstream is unreachable in sandbox)
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
    {fuelType:"JET",   totalDays:27.69, inCountryDays:26.56, onWaterDays:1.12, likelyOnWaterDays:0, scheduledOnWaterDays:0, calculatedAt:"2026-06-20T07:01:32.060Z"},
    {fuelType:"DIESEL",totalDays:34.0,  inCountryDays:32.79, onWaterDays:1.21, likelyOnWaterDays:0, scheduledOnWaterDays:0, calculatedAt:"2026-06-20T07:01:32.060Z"},
    {fuelType:"PETROL",totalDays:38.0,  inCountryDays:37.06, onWaterDays:0.93, likelyOnWaterDays:0, scheduledOnWaterDays:0, calculatedAt:"2026-06-20T07:01:32.060Z"},
  ];

  app.get("/api/proxy/vessels", async (_req, res) => {
    // Serve in-memory cache if still fresh
    if (vesselCache && Date.now() - vesselCache.ts < VESSEL_TTL) {
      res.setHeader("Cache-Control", "public, max-age=120");
      return res.json(vesselCache.data);
    }
    try {
      const r = await fetch("https://www.lastdrop.au/api/vessels", {
        headers: { "User-Agent": "FuelCrisisTransparencyAus/1.0" },
        signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`Upstream ${r.status}`);
      const raw = await r.json();
      // Unwrap {vessels:[...]} or bare array
      const vessels: any[] = Array.isArray(raw) ? raw : (raw?.vessels ?? []);
      vesselCache = { data: vessels, ts: Date.now() };
      res.setHeader("Cache-Control", "public, max-age=120");
      return res.json(vessels);
    } catch (_err) {
      // Upstream unreachable — serve stale cache, else static snapshot
      const fallback = vesselCache?.data ?? STATIC_VESSELS;
      res.setHeader("Cache-Control", "no-store");
      return res.json(fallback);
    }
  });

  app.get("/api/proxy/day-counts", async (_req, res) => {
    // Serve in-memory cache if still fresh
    if (dayCountCache && Date.now() - dayCountCache.ts < DAYCOUNT_TTL) {
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.json(dayCountCache.data);
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
      return res.json(arr);
    } catch (_err) {
      // Upstream unreachable — serve stale cache, else static snapshot
      const fallback = dayCountCache?.data ?? STATIC_DAY_COUNTS;
      res.setHeader("Cache-Control", "no-store");
      return res.json(fallback);
    }
  });

  // Brent Crude price proxy — tries Yahoo Finance first, falls back to stooq.com
  // Yahoo Finance v8 chart endpoint returns OHLCV for the nearest futures contract (BZ=F)
  app.get("/api/proxy/brent", async (_req, res) => {
    // Try Yahoo Finance v8
    try {
      const yahooUrl =
        "https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=5d&includePrePost=false";
      const r = await fetch(yahooUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; FuelCrisisTransparencyAus/1.0)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const json = await r.json();
        const meta = json?.chart?.result?.[0]?.meta;
        if (meta?.regularMarketPrice) {
          const price: number = meta.regularMarketPrice;
          const prevClose: number =
            meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPrice;
          const changePct = prevClose
            ? ((price - prevClose) / prevClose) * 100
            : 0;
          res.setHeader("Cache-Control", "public, max-age=300");
          return res.json({
            price,
            changePct: parseFloat(changePct.toFixed(2)),
            currency: meta.currency ?? "USD",
            source: "Yahoo Finance",
            symbol: meta.symbol ?? "BZ=F",
            timestamp: meta.regularMarketTime
              ? new Date(meta.regularMarketTime * 1000).toISOString()
              : new Date().toISOString(),
          });
        }
      }
    } catch (_e) {
      // fall through to stooq
    }

    // Fallback: stooq.com CSV endpoint for Brent (symbol = "lcoc.f" = Brent Crude Continuous)
    try {
      const stooqUrl = "https://stooq.com/q/l/?s=lcoc.f&f=sd2t2ohlcv&h&e=csv";
      const r = await fetch(stooqUrl, {
        headers: { "User-Agent": "FuelCrisisTransparencyAus/1.0" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const text = await r.text();
        const lines = text.trim().split("\n");
        // CSV: Symbol,Date,Time,Open,High,Low,Close,Volume
        if (lines.length >= 2) {
          const cols = lines[1].split(",");
          const close = parseFloat(cols[6]);
          const open = parseFloat(cols[3]);
          if (!isNaN(close)) {
            const changePct = open ? ((close - open) / open) * 100 : 0;
            res.setHeader("Cache-Control", "public, max-age=300");
            return res.json({
              price: close,
              changePct: parseFloat(changePct.toFixed(2)),
              currency: "USD",
              source: "stooq",
              symbol: "Brent Crude",
              timestamp: new Date().toISOString(),
            });
          }
        }
      }
    } catch (_e) {
      // fall through
    }

    // Last resort: return a static fallback value so the UI always renders
    res.setHeader("Cache-Control", "no-store");
    res.json({
      price: 83.0,
      changePct: 0,
      currency: "USD",
      source: "fallback",
      symbol: "Brent Crude",
      timestamp: new Date().toISOString(),
      isFallback: true,
    });
  });
}
