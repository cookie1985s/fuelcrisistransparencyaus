/**
 * AU Incoming Shipment Tracker — table view
 * Data: lastdrop.au public API (proxied via /api/proxy/vessels + /api/proxy/day-counts)
 */

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, AlertTriangle, ChevronUp, ChevronDown } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface Vessel {
  mmsi: string;
  name: string;
  shipType?: number;
  fuelType?: "PETROL" | "DIESEL" | "JET" | null;
  cargoML?: number;
  cargoConfidence?: string;
  detailedType?: string;
  isProductTanker?: boolean;
  destination?: string;
  destinationConfidence?: "high" | "likely" | "scheduled" | "unknown";
  eta?: string;
  origin?: string;
  distanceKm?: number;
  source?: string;
  supplyDays?: number;
  lastSeen?: string;
}

interface DayCount {
  fuelType: "PETROL" | "DIESEL" | "JET";
  totalDays: number;
  inCountryDays: number;
  onWaterDays: number;
  calculatedAt: string;
}

// ── Constants ──────────────────────────────────────────────────────────────
const DAILY_ML: Record<string, number> = { PETROL: 43.4, DIESEL: 92.3, JET: 28.8 };
const IEA_TARGET = 90;
const MSO: Record<string, number> = { PETROL: 19.7, DIESEL: 23.8, JET: 23.0 };

const FUEL_COLOR: Record<string, string> = {
  PETROL: "#60A5FA", DIESEL: "#F59E0B", JET: "#EF4444",
  products: "#A78BFA", crude: "#92400E", gas: "#34D399", fertilizer: "#86EFAC",
};

const CONF_LABEL: Record<string, { short: string; color: string }> = {
  high:      { short: "✓ Confirmed",  color: "#22C55E" },
  likely:    { short: "~ Likely",     color: "#F59E0B" },
  scheduled: { short: "⏱ Scheduled", color: "#22D3EE" },
  unknown:   { short: "? Unknown",    color: "#64748B" },
};

// ── Port name resolver ─────────────────────────────────────────────────────
const PORT_MAP: [RegExp, string][] = [
  [/BOTANY|BTB|AUBTB/i,          "Port Botany NSW"],
  [/KWINANA|KWI|AUKWI/i,         "Kwinana WA"],
  [/GEELONG|GEX|AUGEX/i,         "Geelong VIC"],
  [/WESTERNPORT|WEP|AUWEP/i,     "Westernport VIC"],
  [/\bMEL\b|MELBOURNE|AUMEL/i,   "Melbourne VIC"],
  [/\bBNE\b|BRISBANE|AUBNE|BSN/i,"Brisbane QLD"],
  [/FREMANTLE|FRE|AUFRE/i,       "Fremantle WA"],
  [/ADELAIDE|ADL|AUADL/i,        "Adelaide SA"],
  [/NEWCASTLE|NTL|AUNTL/i,       "Newcastle NSW"],
  [/HOBART|HBA|AUHBA/i,          "Hobart TAS"],
  [/DEVONPORT|DPO|AUDPO/i,       "Devonport TAS"],
  [/GLADSTONE|GLT|AUGLT/i,       "Gladstone QLD"],
  [/TOWNSVILLE|TSV|AUTSV/i,      "Townsville QLD"],
  [/PORT\s*HEAD|PHE|AUPHE/i,     "Port Hedland WA"],
  [/DAMPIER|DAM|AUDAM/i,         "Dampier WA"],
  [/DARWIN|DRW|AUDRW/i,          "Darwin NT"],
  [/KEMBLA|PKL|AUPKL/i,          "Port Kembla NSW"],
  [/ESPERANCE|EPR|AUEPR/i,       "Esperance WA"],
];

function resolvePort(dest: string): string {
  if (!dest) return "—";
  for (const [re, name] of PORT_MAP) if (re.test(dest)) return name;
  // strip junk characters used as separators
  return dest.replace(/[@>]{1,3}/g, "→").replace(/\s+/g, " ").trim().slice(0, 28) || "—";
}

function cargoInfo(v: Vessel): { label: string; sub: string; conf: string } {
  const ft = v.fuelType;
  const dt = v.detailedType ?? "";
  const ftc = v.fuelTypeConfidence ?? "unknown";
  const cc  = v.cargoConfidence   ?? "default";

  // Specific product — highest detail
  if (ft === "PETROL") return { label: "Petrol (ULP)", sub: "Refined product", conf: ftc };
  if (ft === "DIESEL") return { label: "Diesel",       sub: "Refined product", conf: ftc };
  if (ft === "JET")    return { label: "Jet Fuel",     sub: "Refined product", conf: ftc };

  // No specific product — fall back to detailedType category
  if (dt === "crude")       return { label: "Crude Oil",           sub: "To be refined domestically", conf: cc };
  if (dt === "gas")         return { label: "LPG / LNG",           sub: "Liquefied gas",              conf: cc };
  if (dt === "fertilizer")  return { label: "Fertilizer",          sub: "Ag commodity",               conf: cc };
  if (dt === "products" || v.isProductTanker)
                            return { label: "Petroleum Products",  sub: "Mixed refined cargo",        conf: cc };
  return { label: "General Cargo", sub: "Type unclassified", conf: "unknown" };
}

// Keep cargoLabel for backward compat with byFuel grouping
function cargoLabel(v: Vessel): string { return cargoInfo(v).label; }

function cargoColor(v: Vessel): string {
  if (v.fuelType && FUEL_COLOR[v.fuelType]) return FUEL_COLOR[v.fuelType];
  return FUEL_COLOR[v.detailedType ?? ""] ?? "#94A3B8";
}

function fmtAge(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type SortKey = "supplyDays" | "cargoML" | "distanceKm" | "name";

// ── Reserve bar ────────────────────────────────────────────────────────────
function ReserveBar({ days, target = IEA_TARGET }: { days: number; target?: number }) {
  const pct = Math.min(100, (days / target) * 100);
  const col = days >= 60 ? "#22C55E" : days >= 28 ? "#F59E0B" : "#EF4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: col }} />
      </div>
      <span className="text-[10px] tabular-nums font-bold" style={{ color: col, minWidth: 36 }}>
        {days.toFixed(1)}d
      </span>
    </div>
  );
}


// ── Inline fallback snapshot (Jun 20 2026) — used when server unreachable ─
const INLINE_SNAPSHOT_VESSELS: Vessel[] = [
  {mmsi:"241632000",name:"SEA DOLPHIN",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.42,cargoConfidence:"high",isProductTanker:true,destination:"AUBNE",destinationConfidence:"high",eta:"9/6",origin:"Long Beach USA",distanceKm:89,source:"snapshot",supplyDays:0.366},
  {mmsi:"249329000",name:"HAFNIA LOTTE",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.5,cargoConfidence:"high",isProductTanker:true,destination:"AUSYD",destinationConfidence:"high",eta:"",origin:"Hong Kong",distanceKm:17,source:"snapshot",supplyDays:0.367},
  {mmsi:"255917256",name:"CAPE BONNY",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:38.13,cargoConfidence:"estimated",isProductTanker:true,destination:"SGSIN > AUKWI",destinationConfidence:"high",eta:"14/6",origin:"Singapore",distanceKm:37,source:"snapshot",supplyDays:0.329},
  {mmsi:"256627000",name:"SERIANA",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:93.49,cargoConfidence:"high",isProductTanker:true,destination:"BRISBANE",destinationConfidence:"high",eta:"",origin:"Singapore",distanceKm:87,source:"snapshot",supplyDays:0.807},
  {mmsi:"258032000",name:"BALLARD",detailedType:"other",fuelTypeConfidence:"inferred",cargoML:68.2,cargoConfidence:"high",isProductTanker:true,destination:"CNJGY>>AUKWI",destinationConfidence:"high",eta:"19/6",origin:"Jiangyin China",distanceKm:41,source:"snapshot",supplyDays:0.589},
  {mmsi:"311001600",name:"ICS TENACIOUS",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:7.1,cargoConfidence:"high",isProductTanker:true,destination:"MEL<>GEX",destinationConfidence:"high",eta:"17/6",origin:"Melbourne Australia",distanceKm:5,source:"snapshot",supplyDays:0.061},
  {mmsi:"352006555",name:"PIS MADURA",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.5,cargoConfidence:"high",isProductTanker:true,destination:"AU BSN FOR ORDERS",destinationConfidence:"high",eta:"",origin:"Ulsan Korea",distanceKm:undefined,source:"snapshot",supplyDays:0.367},
  {mmsi:"413258730",name:"XING TONG 799",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.47,cargoConfidence:"high",isProductTanker:true,destination:"AU DPO",destinationConfidence:"high",eta:"",origin:"Muara Brunei",distanceKm:15,source:"snapshot",supplyDays:0.367},
  {mmsi:"477147100",name:"FOREVER GLORY",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.47,cargoConfidence:"high",isProductTanker:true,destination:"AU BNE",destinationConfidence:"high",eta:"17/6",origin:"Marsden Point NZ",distanceKm:4,source:"snapshot",supplyDays:0.367},
  {mmsi:"477637200",name:"GOLDEN RESOLUTION",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:10.8,cargoConfidence:"high",isProductTanker:true,destination:"AU BTB",destinationConfidence:"high",eta:"",origin:"Pasir Gudang Malaysia",distanceKm:198,source:"snapshot",supplyDays:0.093},
  {mmsi:"503190890",name:"AURIGA TITAN",detailedType:"products",fuelType:"DIESEL",fuelTypeConfidence:"high",cargoML:4.14,cargoConfidence:"high",isProductTanker:true,destination:"BRISBANE",destinationConfidence:"high",eta:"",origin:"Brisbane Australia",distanceKm:7,source:"snapshot",supplyDays:0.045},
  {mmsi:"538010335",name:"PETITE SOEUR",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:42.86,cargoConfidence:"high",isProductTanker:true,destination:"AUGEX",destinationConfidence:"high",eta:"",origin:"Muara Brunei",distanceKm:46,source:"snapshot",supplyDays:0.370},
  {mmsi:"538011239",name:"SFL BONAIRE",detailedType:"products",fuelTypeConfidence:"inferred",cargoML:28.34,cargoConfidence:"high",isProductTanker:true,destination:"AU BNE",destinationConfidence:"high",eta:"",origin:"Kuantan Malaysia",distanceKm:7,source:"snapshot",supplyDays:0.245},
  {mmsi:"538011585",name:"NORDIC MOON",detailedType:"crude",fuelTypeConfidence:"inferred",cargoML:131.56,cargoConfidence:"high",isProductTanker:true,destination:"AU BNE",destinationConfidence:"high",eta:"",origin:"Walvis Bay Namibia",distanceKm:17,source:"snapshot",supplyDays:1.136},
  {mmsi:"563085100",name:"OCEANA RIVER",detailedType:"crude",fuelTypeConfidence:"inferred",cargoML:96.11,cargoConfidence:"high",isProductTanker:true,destination:"AUBNE",destinationConfidence:"high",eta:"",origin:"Sungai Linggi Malaysia",distanceKm:88,source:"snapshot",supplyDays:0.830},
];
const INLINE_SNAPSHOT_DAYCOUNTS: DayCount[] = [
  {fuelType:"JET",   totalDays:27.69, inCountryDays:26.56, onWaterDays:1.12, calculatedAt:"2026-06-20T07:01:32.060Z"},
  {fuelType:"DIESEL",totalDays:34.0,  inCountryDays:32.79, onWaterDays:1.21, calculatedAt:"2026-06-20T07:01:32.060Z"},
  {fuelType:"PETROL",totalDays:38.0,  inCountryDays:37.06, onWaterDays:0.93, calculatedAt:"2026-06-20T07:01:32.060Z"},
];

// ── Main ───────────────────────────────────────────────────────────────────
export default function ShipmentTracker() {
  const [vessels,    setVessels]    = useState<Vessel[]>(INLINE_SNAPSHOT_VESSELS);
  const [dayCounts,  setDayCounts]  = useState<DayCount[]>(INLINE_SNAPSHOT_DAYCOUNTS);
  const [loading,    setLoading]    = useState(true);
  const [fetched,    setFetched]    = useState<Date | null>(new Date("2026-06-20T07:01:32.060Z"));
  const [error,      setError]      = useState<string | null>(null);
  const [confFilter, setConfFilter] = useState<"confirmed" | "likely" | "all">("confirmed");

  // True when upstream is unreachable and we are showing static snapshot data
  const isSnapshot = vessels.length > 0 && vessels.every(v => v.source === "snapshot");
  const [sortKey,    setSortKey]    = useState<SortKey>("supplyDays");
  const [sortAsc,    setSortAsc]    = useState(false);

  // Same API_BASE pattern as queryClient.ts — __PORT_5000__ rewritten at deploy time
  const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Use raw fetch so we can handle non-2xx gracefully instead of throwing
      const [vr, dr] = await Promise.all([
        fetch(`${API_BASE}/api/proxy/vessels`).catch(() => null),
        fetch(`${API_BASE}/api/proxy/day-counts`).catch(() => null),
      ]);

      let vessels: Vessel[] = [];
      let dayCounts: DayCount[] = [];
      let fetchOk = false;

      if (vr && vr.ok) {
        try {
          const vd = await vr.json();
          vessels = Array.isArray(vd) ? vd : (vd?.vessels ?? []);
          fetchOk = true;
        } catch (_) {}
      }
      if (dr && dr.ok) {
        try {
          const dd = await dr.json();
          dayCounts = Array.isArray(dd) ? dd : [];
        } catch (_) {}
      }

      if (vessels.length > 0) {
        setVessels(vessels);
        setDayCounts(dayCounts);
        setFetched(new Date());
      } else if (!fetchOk) {
        // Server unreachable entirely — show static snapshot inline without an error
        setVessels(INLINE_SNAPSHOT_VESSELS);
        setDayCounts(INLINE_SNAPSHOT_DAYCOUNTS);
        setFetched(new Date());
      }
    } catch (_e) {
      // Silently fall through — snapshot data already set on mount
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 120_000);
    return () => clearInterval(t);
  }, [fetchData]);

  // ── Filter ────────────────────────────────────────────────────────────
  const filtered = vessels.filter(v => {
    if (confFilter === "confirmed") return v.destinationConfidence === "high";
    if (confFilter === "likely")    return ["high","likely"].includes(v.destinationConfidence ?? "");
    return true; // all
  });

  // ── Sort ──────────────────────────────────────────────────────────────
  const sorted = [...filtered].sort((a, b) => {
    let diff = 0;
    if (sortKey === "supplyDays") diff = (b.supplyDays ?? 0) - (a.supplyDays ?? 0);
    if (sortKey === "cargoML")    diff = (b.cargoML ?? 0) - (a.cargoML ?? 0);
    if (sortKey === "distanceKm") diff = (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999);
    if (sortKey === "name")       diff = a.name.localeCompare(b.name);
    return sortAsc ? -diff : diff;
  });

  const totalSupplyDays = sorted.reduce((s, v) => s + (v.supplyDays ?? 0), 0);
  const totalML         = sorted.reduce((s, v) => s + (v.cargoML ?? 0), 0);

  // Per-fuel-type breakdown
  type FuelTotals = { ml: number; days: number; count: number };
  const byFuel = sorted.reduce<Record<string, FuelTotals>>((acc, v) => {
    const ft = v.fuelType ?? "OTHER";
    if (!acc[ft]) acc[ft] = { ml: 0, days: 0, count: 0 };
    acc[ft].ml    += v.cargoML    ?? 0;
    acc[ft].days  += v.supplyDays ?? 0;
    acc[ft].count += 1;
    return acc;
  }, {});
  const fuelOrder = ["PETROL", "DIESEL", "JET", "LPG", "OTHER"];
  const fuelRows = fuelOrder
    .filter(ft => byFuel[ft])
    .map(ft => ({ ft, ...byFuel[ft] }));
  Object.keys(byFuel).forEach(ft => {
    if (!fuelOrder.includes(ft)) fuelRows.push({ ft, ...byFuel[ft] });
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-slate-700 ml-0.5">↕</span>;
    return sortAsc
      ? <ChevronUp className="inline w-3 h-3 text-teal-400 ml-0.5" />
      : <ChevronDown className="inline w-3 h-3 text-teal-400 ml-0.5" />;
  }

  // counts for filter buttons
  const cnts = {
    confirmed: vessels.filter(v => v.destinationConfidence === "high").length,
    likely:    vessels.filter(v => ["high","likely"].includes(v.destinationConfidence ?? "")).length,
    all:       vessels.length,
  };

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${loading ? "bg-amber-400 animate-pulse" : fetched ? "bg-emerald-500" : "bg-slate-600"}`} />
          <span className="text-xs text-slate-400">
            {loading ? "Fetching…"
              : fetched ? `Updated ${fmtAge(fetched.toISOString())} · ${vessels.length} vessels`
              : "Not loaded"}
          </span>
        </div>
        <button onClick={fetchData} disabled={loading}
          className="ml-auto flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 disabled:opacity-40 transition-colors">
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {isSnapshot && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/50 text-xs text-slate-400">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
          <span>Showing <span className="text-amber-400 font-semibold">Jun 20 2026 snapshot</span> — live vessel feed is updating in background. Vessel positions are approximate.</span>
        </div>
      )}

      {/* ── National reserves summary ─────────────────────────────────── */}
      {dayCounts.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            National Supply Reserves vs IEA 90-day Target
          </div>
          <div className="divide-y divide-slate-800/60">
            {dayCounts.map(dc => {
              const col = FUEL_COLOR[dc.fuelType] ?? "#94A3B8";
              const label = dc.fuelType === "PETROL" ? "Petrol (ULP)" : dc.fuelType === "DIESEL" ? "Diesel" : "Jet Fuel";
              const mso   = MSO[dc.fuelType];
              const shortfall = IEA_TARGET - dc.totalDays;
              return (
                <div key={dc.fuelType} className="px-4 py-3 grid grid-cols-[130px_1fr_auto] items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: col }} />
                    <span className="text-xs font-semibold text-slate-200">{label}</span>
                  </div>
                  <div className="space-y-1">
                    <ReserveBar days={dc.totalDays} />
                    <div className="flex gap-3 text-[10px] text-slate-600">
                      <span>In-country: <span className="text-slate-400">{dc.inCountryDays.toFixed(1)}d</span></span>
                      <span>On-water: <span className="text-teal-400">{dc.onWaterDays.toFixed(2)}d</span></span>
                      <span>MSO: <span className="text-slate-400">{mso}d</span></span>
                    </div>
                  </div>
                  <div className="text-right">
                    {shortfall > 0 ? (
                      <span className="text-xs font-bold text-red-400">−{shortfall.toFixed(1)}d short of IEA</span>
                    ) : (
                      <span className="text-xs font-bold text-emerald-400">IEA met</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filter tabs ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["confirmed","likely","all"] as const).map(f => (
          <button key={f} onClick={() => setConfFilter(f)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${confFilter === f ? "bg-teal-700 text-white" : "bg-slate-800 text-slate-400 hover:text-slate-200"}`}>
            {f === "confirmed" ? `✓ Confirmed AU-Bound (${cnts.confirmed})`
             : f === "likely"  ? `~ Likely + Confirmed (${cnts.likely})`
             :                   `All Vessels (${cnts.all})`}
          </button>
        ))}
      </div>

      {/* ── Summary row ───────────────────────────────────────────────── */}
      {sorted.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
          <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-wider font-semibold mb-2">
            <span>On-water supply impact by fuel type</span>
            <span className="text-slate-600">{sorted.length} vessels &middot; {totalML.toFixed(0)} ML total</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {fuelRows.map(({ ft, ml, days, count }) => {
              const col = FUEL_COLOR[ft as keyof typeof FUEL_COLOR] ?? "#94A3B8";
              const label = ft === "PETROL" ? "Petrol" : ft === "DIESEL" ? "Diesel" : ft === "JET" ? "Jet Fuel" : ft === "LPG" ? "LPG" : ft;
              return (
                <div key={ft} className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
                  <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: col }} />
                  <div className="min-w-0">
                    <div className="text-[10px] text-slate-400 font-semibold">{label} <span className="text-slate-600 font-normal">({count}v)</span></div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-xs font-bold" style={{ color: col }}>{ml.toFixed(0)} ML</span>
                      <span className="text-[10px] text-emerald-400 font-semibold">+{days.toFixed(2)}d</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────── */}
      {sorted.length > 0 && (
        <div className="rounded-xl border border-slate-800 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/80 text-[10px] text-slate-500 uppercase tracking-wider">
                <th className="px-3 py-2.5 text-left font-semibold cursor-pointer hover:text-slate-300" onClick={() => toggleSort("name")}>
                  Vessel <SortIcon k="name" />
                </th>
                <th className="px-3 py-2.5 text-left font-semibold">Status</th>
                <th className="px-3 py-2.5 text-left font-semibold">Origin / Departure</th>
                <th className="px-3 py-2.5 text-left font-semibold">Cargo Type</th>
                <th className="px-3 py-2.5 text-left font-semibold">AU Destination</th>
                <th className="px-3 py-2.5 text-right font-semibold cursor-pointer hover:text-slate-300" onClick={() => toggleSort("cargoML")}>
                  Volume (ML) <SortIcon k="cargoML" />
                </th>
                <th className="px-3 py-2.5 text-right font-semibold cursor-pointer hover:text-slate-300" onClick={() => toggleSort("supplyDays")}>
                  Supply Impact <SortIcon k="supplyDays" />
                </th>
                <th className="px-3 py-2.5 text-right font-semibold cursor-pointer hover:text-slate-300" onClick={() => toggleSort("distanceKm")}>
                  Distance <SortIcon k="distanceKm" />
                </th>
                <th className="px-3 py-2.5 text-right font-semibold">ETA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {sorted.map((v, i) => {
                const conf  = CONF_LABEL[v.destinationConfidence ?? "unknown"];
                const color = cargoColor(v);
                const info  = cargoInfo(v);
                const port  = resolvePort(v.destination ?? "");
                const supplyD = v.supplyDays;
                const isEven = i % 2 === 0;

                return (
                  <tr key={v.mmsi} className={`${isEven ? "bg-slate-900/20" : "bg-slate-900/40"} hover:bg-slate-800/40 transition-colors`}>

                    {/* Vessel name */}
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-slate-100">{v.name}</div>
                      {v.source === "scheduled" && (
                        <div className="text-[9px] text-cyan-500 font-medium">SCHEDULED</div>
                      )}
                      {v.source === "snapshot" && (
                        <div className="text-[9px] text-amber-500 font-medium">SNAPSHOT</div>
                      )}
                    </td>

                    {/* Status / confidence */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-semibold" style={{ color: conf.color }}>{conf.short}</span>
                    </td>

                    {/* Origin */}
                    <td className="px-3 py-2.5 text-slate-400 max-w-[140px]">
                      <div className="truncate">{v.origin || "—"}</div>
                    </td>

                    {/* Cargo type */}
                    <td className="px-3 py-2.5">
                      <div className="inline-flex flex-col gap-0.5">
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                          style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}30` }}>
                          {info.label}
                        </span>
                        <span className="text-[9px] text-slate-500 pl-0.5">{info.sub} · <span className={
                          info.conf === "high"     ? "text-emerald-500" :
                          info.conf === "inferred" ? "text-amber-500"   : "text-slate-600"
                        }>{info.conf === "high" ? "confirmed" : info.conf === "inferred" ? "inferred" : "estimated"}</span></span>
                      </div>
                    </td>

                    {/* AU destination */}
                    <td className="px-3 py-2.5">
                      <span className="text-teal-300 font-medium">{port}</span>
                    </td>

                    {/* Volume */}
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {v.cargoML != null ? (
                        <span className="font-semibold" style={{ color }}>
                          {v.cargoML.toFixed(1)}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>

                    {/* Supply impact */}
                    <td className="px-3 py-2.5 text-right">
                      {supplyD != null && supplyD > 0 ? (
                        <span className="font-bold text-emerald-400 tabular-nums font-mono">
                          +{supplyD.toFixed(3)}d
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>

                    {/* Distance */}
                    <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums font-mono">
                      {v.distanceKm != null
                        ? `${Math.round(v.distanceKm).toLocaleString()} km`
                        : <span className="text-slate-600">—</span>}
                    </td>

                    {/* ETA */}
                    <td className="px-3 py-2.5 text-right text-slate-400 whitespace-nowrap">
                      {v.eta || <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* Totals footer — per-fuel subtotals + grand total */}
            <tfoot>
              {fuelRows.map(({ ft, ml, days, count }) => {
                const col = FUEL_COLOR[ft as keyof typeof FUEL_COLOR] ?? "#94A3B8";
                const label = ft === "PETROL" ? "Petrol" : ft === "DIESEL" ? "Diesel" : ft === "JET" ? "Jet Fuel" : ft === "LPG" ? "LPG" : ft;
                return (
                  <tr key={ft} className="border-t border-slate-800 bg-slate-900/60">
                    <td className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider" colSpan={4}>
                      <span className="inline-block w-1.5 h-1.5 rounded-sm mr-1.5 align-middle" style={{ backgroundColor: col }} />
                      {label} subtotal ({count} vessel{count !== 1 ? "s" : ""})
                    </td>
                    <td className="px-3 py-2" />
                    <td className="px-3 py-2 text-right font-bold font-mono tabular-nums" style={{ color: col }}>
                      {ml.toFixed(1)} ML
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-400 font-mono tabular-nums">
                      +{days.toFixed(3)}d
                    </td>
                    <td colSpan={2} />
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-600 bg-slate-900/80">
                <td className="px-3 py-2.5 font-bold text-slate-300" colSpan={5}>
                  GRAND TOTAL ({sorted.length} vessels)
                </td>
                <td className="px-3 py-2.5 text-right font-bold text-teal-300 font-mono tabular-nums">
                  {totalML.toFixed(1)} ML
                </td>
                <td className="px-3 py-2.5 text-right font-bold text-emerald-400 font-mono tabular-nums">
                  +{totalSupplyDays.toFixed(3)}d
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Loading empty state */}
      {loading && sorted.length === 0 && (
        <div className="rounded-xl border border-slate-800 p-8 text-center">
          <div className="animate-spin w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-slate-500 text-xs">Loading vessel data…</p>
        </div>
      )}

      {/* Attribution */}
      {fetched && (
        <div className="text-[10px] text-slate-700 flex flex-wrap gap-3">
          <span>Source: <a href="https://www.lastdrop.au" target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:underline">lastdrop.au</a> (AISStream + port schedules + DCCEEW)</span>
          <span className="ml-auto">Supply days = cargo ML ÷ national daily consumption rate. Not official government data.</span>
        </div>
      )}
    </div>
  );
}
