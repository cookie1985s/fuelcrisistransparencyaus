// Australian Import Trade Data — Fertilizer & Petroleum Products
// Monthly volume: LIVE from ABS MERCH_IMP API (fetched server-side, cached in SQLite)
// Origin shares, descriptions, risk notes: curated static reference data

export type CommodityCategory = "fertilizer" | "petroleum";

export interface MonthlyDataPoint {
  month: string;   // "YYYY-MM"
  label: string;   // "Jan 2024"
  actual: number;  // AUD thousands
  forecast: number; // projected AUD thousands (seasonal rolling avg)
  gapPct: number;  // (actual - forecast) / forecast * 100
  momPct: number;  // month-over-month % change
  isAlert: boolean; // actual < forecast * (1 - alertThreshold/100)
}

export interface OriginCountry {
  country: string;
  flag: string;
  share: number;       // % of total (live from latest period)
  volume: number;      // latest month AUD thousands
  prevVolume: number;  // same month last year
  trend: "up" | "down" | "stable";
  yoyChange: number;
  countryCode: string;
}

export interface AnomalyScore {
  level: "critical" | "warning" | "normal";
  label: string;
  momPct: number;
  yoyPct: number;
  vsAvgPct: number; // vs 6-month rolling avg
  latestPeriod: string;
  latestValue: number;
}

export interface SubcategoryData {
  id: string;
  name: string;
  unit: string;
  commodity: CommodityCategory;
  monthlyData: MonthlyDataPoint[];
  origins: OriginCountry[];
  description: string;
  supplyRisk: "low" | "medium" | "high";
  riskNote: string;
  sitcCodes: string[];
  anomaly: AnomalyScore;
}

// ─── ABS DATA ROW (snake_case — raw from SQLite) ──────────────────────────────
export interface ImportDataRow {
  id: number;
  sitc_code: string;
  country_code: string;
  time_period: string;
  aud_value: number;
  fetched_at: string;
}

// Drizzle ORM returns camelCase for sync logs
export interface SyncLog {
  id: number;
  sitcCode: string;
  lastSyncAt: string;
  latestPeriod: string;
  status: string;
  errorMsg?: string | null;
}

// ─── MONTH LABEL HELPER ───────────────────────────────────────────────────────
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function periodToLabel(period: string): string {
  if (!period) return "";
  const [year, month] = period.split("-");
  const idx = parseInt(month, 10) - 1;
  return `${MONTH_NAMES[idx] ?? month} ${year}`;
}

function prevMonthPeriod(p: string): string {
  const [y, m] = p.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

function prevYearPeriod(p: string): string {
  return `${parseInt(p) - 1}${p.slice(4)}`;
}

// ─── SEASONAL FORECAST ────────────────────────────────────────────────────────
// Uses same-month-last-year scaled by 12-month trend
function buildForecast(sorted: { month: string; value: number }[]): number[] {
  const vals = sorted.map(s => s.value);
  return vals.map((v, i) => {
    if (i < 13) {
      // Insufficient history — use 3-month trailing avg
      const w = vals.slice(Math.max(0, i - 2), i + 1);
      return Math.round(w.reduce((s, x) => s + x, 0) / w.length);
    }
    // Same month last year
    const sameLastYear = vals[i - 12];
    // 12-month trend: avg of last 12 vs avg of 12 before that
    const recent12 = vals.slice(i - 12, i);
    const prior12 = vals.slice(Math.max(0, i - 24), i - 12);
    const r12avg = recent12.reduce((s, x) => s + x, 0) / recent12.length;
    const p12avg = prior12.length > 0
      ? prior12.reduce((s, x) => s + x, 0) / prior12.length
      : r12avg;
    const trend = p12avg > 0 ? r12avg / p12avg : 1;
    return Math.round(sameLastYear * trend);
  });
}

// ─── BUILD MONTHLY DATA FROM ABS ROWS ────────────────────────────────────────
export function buildMonthlyData(
  rows: ImportDataRow[],
  sitcCodes: string[],
  alertThresholdPct = 15
): MonthlyDataPoint[] {
  const filtered = rows.filter(
    r => r.country_code === "TOT" && sitcCodes.includes(r.sitc_code)
  );

  const byPeriod = new Map<string, number>();
  for (const row of filtered) {
    byPeriod.set(row.time_period, (byPeriod.get(row.time_period) ?? 0) + row.aud_value);
  }

  const sorted = [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, value]) => ({ month, value }));

  if (sorted.length === 0) return [];

  const forecasts = buildForecast(sorted);

  return sorted.map(({ month, value }, i) => {
    const forecast = forecasts[i] ?? value;
    const gapPct = forecast > 0 ? Math.round(((value - forecast) / forecast) * 10 * 100) / 1000 : 0;
    const prevVal = i > 0 ? sorted[i - 1].value : value;
    const momPct = prevVal > 0 ? Math.round(((value - prevVal) / prevVal) * 1000) / 10 : 0;
    return {
      month,
      label: periodToLabel(month),
      actual: Math.round(value),
      forecast: Math.round(forecast),
      gapPct,
      momPct,
      isAlert: forecast > 0 && value < forecast * (1 - alertThresholdPct / 100),
    };
  });
}

// ─── ANOMALY SCORE ────────────────────────────────────────────────────────────
export function computeAnomaly(monthlyData: MonthlyDataPoint[]): AnomalyScore {
  if (monthlyData.length === 0) {
    return { level: "normal", label: "No data", momPct: 0, yoyPct: 0, vsAvgPct: 0, latestPeriod: "", latestValue: 0 };
  }
  const latest = monthlyData[monthlyData.length - 1];
  const yago = monthlyData.length >= 13 ? monthlyData[monthlyData.length - 13] : null;
  const last6 = monthlyData.slice(Math.max(0, monthlyData.length - 7), monthlyData.length - 1);
  const avg6 = last6.length > 0 ? last6.reduce((s, d) => s + d.actual, 0) / last6.length : latest.actual;

  const momPct = latest.momPct;
  const yoyPct = yago ? Math.round(((latest.actual - yago.actual) / yago.actual) * 1000) / 10 : 0;
  const vsAvgPct = avg6 > 0 ? Math.round(((latest.actual - avg6) / avg6) * 1000) / 10 : 0;

  // Score: most recent month vs its forecast is the primary signal
  const gapPct = latest.gapPct;
  let level: "critical" | "warning" | "normal" = "normal";
  let label = "On track";

  if (gapPct <= -25 || (vsAvgPct <= -20 && yoyPct <= -15)) {
    level = "critical";
    label = `${Math.abs(gapPct).toFixed(0)}% below forecast`;
  } else if (gapPct <= -15 || vsAvgPct <= -15 || yoyPct <= -20) {
    level = "warning";
    label = gapPct <= -15
      ? `${Math.abs(gapPct).toFixed(0)}% below forecast`
      : yoyPct <= -20
      ? `${Math.abs(yoyPct).toFixed(0)}% drop YoY`
      : `${Math.abs(vsAvgPct).toFixed(0)}% below 6mo avg`;
  } else if (gapPct >= 20 || vsAvgPct >= 30) {
    level = "normal";
    label = `Surge +${gapPct.toFixed(0)}% vs forecast`;
  }

  return { level, label, momPct, yoyPct, vsAvgPct, latestPeriod: latest.month, latestValue: latest.actual };
}

// ─── ENRICH ORIGINS WITH LIVE DATA ───────────────────────────────────────────
export function enrichOrigins(
  origins: OriginCountry[],
  rows: ImportDataRow[],
  sitcCodes: string[]
): OriginCountry[] {
  const totRows = rows
    .filter(r => r.country_code === "TOT" && sitcCodes.includes(r.sitc_code))
    .sort((a, b) => a.time_period.localeCompare(b.time_period));

  if (totRows.length === 0) return origins;

  const latestPeriod = totRows[totRows.length - 1].time_period;
  const prevYear = prevYearPeriod(latestPeriod);

  // Total value at latest period
  const totLatest = totRows
    .filter(r => r.time_period === latestPeriod)
    .reduce((s, r) => s + r.aud_value, 0);

  return origins.map(o => {
    if (o.countryCode === "TOT") return { ...o, volume: 0, prevVolume: 0 };

    const latestVol = rows
      .filter(r => r.country_code === o.countryCode && sitcCodes.includes(r.sitc_code) && r.time_period === latestPeriod)
      .reduce((s, r) => s + r.aud_value, 0);

    const prevVol = rows
      .filter(r => r.country_code === o.countryCode && sitcCodes.includes(r.sitc_code) && r.time_period === prevYear)
      .reduce((s, r) => s + r.aud_value, 0);

    const yoyChange = prevVol > 0 ? Math.round(((latestVol - prevVol) / prevVol) * 1000) / 10 : o.yoyChange;
    const liveShare = totLatest > 0 ? Math.round((latestVol / totLatest) * 1000) / 10 : o.share;
    const trend: "up" | "down" | "stable" =
      yoyChange > 8 ? "up" : yoyChange < -8 ? "down" : "stable";

    return {
      ...o,
      share: latestVol > 0 ? liveShare : o.share,
      volume: Math.round(latestVol),
      prevVolume: Math.round(prevVol),
      yoyChange: prevVol > 0 || latestVol > 0 ? yoyChange : o.yoyChange,
      trend: prevVol > 0 || latestVol > 0 ? trend : o.trend,
    };
  }).filter(o => o.countryCode === "TOT" || o.volume > 0 || o.share > 0);
}

// ─── SUBCATEGORY STATIC DEFINITIONS ──────────────────────────────────────────
export const subcategoryDefs: Omit<SubcategoryData, "monthlyData" | "anomaly">[] = [
  {
    id: "urea",
    name: "Urea (Nitrogen)",
    unit: "A$K",
    commodity: "fertilizer",
    sitcCodes: ["562"],
    description: "Australia's primary nitrogen fertilizer. Critical for winter-sowing (Apr–Jun). Sourced primarily from the Middle East following China's export restrictions.",
    supplyRisk: "high",
    riskNote: "China's 2025–26 export quota ~2Mt vs historic 5.5Mt. Middle East (Saudi, Qatar, Oman) and Egypt now absorbing ~73% of AU demand. Logistics costs remain elevated.",
    origins: [
      { country: "Saudi Arabia", flag: "🇸🇦", share: 28, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 18,  countryCode: "SAUD" },
      { country: "Qatar",        flag: "🇶🇦", share: 19, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 12,  countryCode: "QATA" },
      { country: "Oman",         flag: "🇴🇲", share: 14, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 22,  countryCode: "OMAN" },
      { country: "Egypt",        flag: "🇪🇬", share: 12, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 35,  countryCode: "EGYP" },
      { country: "Indonesia",    flag: "🇮🇩", share: 10, volume: 0, prevVolume: 0, trend: "stable",yoyChange: 3,   countryCode: "INDO" },
      { country: "China",        flag: "🇨🇳", share: 9,  volume: 0, prevVolume: 0, trend: "down",  yoyChange: -72, countryCode: "CHIN" },
      { country: "Malaysia",     flag: "🇲🇾", share: 5,  volume: 0, prevVolume: 0, trend: "up",    yoyChange: 8,   countryCode: "MLAY" },
      { country: "Other",        flag: "🌏",  share: 3,  volume: 0, prevVolume: 0, trend: "stable",yoyChange: -2,  countryCode: "TOT"  },
    ],
  },
  {
    id: "dap-map",
    name: "DAP / MAP (Phosphate)",
    unit: "A$K",
    commodity: "fertilizer",
    sitcCodes: ["562"],
    description: "Diammonium & monoammonium phosphate. Key for cereals and canola. No domestic production — 100% import dependent.",
    supplyRisk: "high",
    riskNote: "Chinese DAP/MAP quota ~2Mt for 2026 vs ~6Mt normal. Saudi (Maaden) and Morocco (OCP) filling the gap but with higher freight costs and longer lead times.",
    origins: [
      { country: "Saudi Arabia", flag: "🇸🇦", share: 34, volume: 0, prevVolume: 0, trend: "up",   yoyChange: 24,  countryCode: "SAUD" },
      { country: "Morocco",      flag: "🇲🇦", share: 25, volume: 0, prevVolume: 0, trend: "up",   yoyChange: 19,  countryCode: "MORO" },
      { country: "China",        flag: "🇨🇳", share: 18, volume: 0, prevVolume: 0, trend: "down", yoyChange: -58, countryCode: "CHIN" },
      { country: "Russia",       flag: "🇷🇺", share: 10, volume: 0, prevVolume: 0, trend: "stable",yoyChange: 5,  countryCode: "RUSS" },
      { country: "Other",        flag: "🌏",  share: 13, volume: 0, prevVolume: 0, trend: "stable",yoyChange: -1, countryCode: "TOT"  },
    ],
  },
  {
    id: "potash",
    name: "Potash / MOP",
    unit: "A$K",
    commodity: "fertilizer",
    sitcCodes: ["272"],
    description: "Muriate of potash (MOP) for tropical/subtropical crops. No domestic production. Canada and Russia dominate global supply.",
    supplyRisk: "medium",
    riskNote: "Canadian supply (Nutrien/Mosaic) stable. Belarus constrained by sanctions. Monitor Russia supply corridor — any disruption flows through to AU within 2–3 months.",
    origins: [
      { country: "Canada",    flag: "🇨🇦", share: 48, volume: 0, prevVolume: 0, trend: "stable", yoyChange: 2,  countryCode: "CAN"  },
      { country: "Russia",    flag: "🇷🇺", share: 22, volume: 0, prevVolume: 0, trend: "stable", yoyChange: -3, countryCode: "RUSS" },
      { country: "Belarus",   flag: "🇧🇾", share: 15, volume: 0, prevVolume: 0, trend: "down",   yoyChange: -8, countryCode: "BELA" },
      { country: "Germany",   flag: "🇩🇪", share: 8,  volume: 0, prevVolume: 0, trend: "stable", yoyChange: 1,  countryCode: "FGMY" },
      { country: "Indonesia", flag: "🇮🇩", share: 4,  volume: 0, prevVolume: 0, trend: "up",     yoyChange: 12, countryCode: "INDO" },
      { country: "Other",     flag: "🌏",  share: 3,  volume: 0, prevVolume: 0, trend: "stable", yoyChange: 4,  countryCode: "TOT"  },
    ],
  },
  {
    id: "diesel",
    name: "Diesel / Gas Oil",
    unit: "A$K",
    commodity: "petroleum",
    sitcCodes: ["334"],
    description: "Australia's most critical transport fuel. Mining, agriculture, heavy freight, and defence all depend on uninterrupted diesel supply.",
    supplyRisk: "high",
    riskNote: "South Korea (~29%) and Malaysia (~25%) now primary suppliers. Taiwan Strait tensions remain tail risk for East Asian supply chains. Strategic stockpile ~66 days.",
    origins: [
      { country: "South Korea", flag: "🇰🇷", share: 30, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 15,  countryCode: "RKOR" },
      { country: "Singapore",   flag: "🇸🇬", share: 23, volume: 0, prevVolume: 0, trend: "stable",yoyChange: -2,  countryCode: "SING" },
      { country: "Malaysia",    flag: "🇲🇾", share: 14, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 22,  countryCode: "MLAY" },
      { country: "China",       flag: "🇨🇳", share: 10, volume: 0, prevVolume: 0, trend: "down",  yoyChange: -8,  countryCode: "CHIN" },
      { country: "Japan",       flag: "🇯🇵", share: 8,  volume: 0, prevVolume: 0, trend: "down",  yoyChange: -11, countryCode: "JAP"  },
      { country: "India",       flag: "🇮🇳", share: 7,  volume: 0, prevVolume: 0, trend: "up",    yoyChange: 28,  countryCode: "INIA" },
      { country: "Taiwan",      flag: "🇹🇼", share: 5,  volume: 0, prevVolume: 0, trend: "stable",yoyChange: 3,   countryCode: "TAIW" },
      { country: "Other",       flag: "🌏",  share: 3,  volume: 0, prevVolume: 0, trend: "stable",yoyChange: 2,   countryCode: "TOT"  },
    ],
  },
  {
    id: "petrol",
    name: "Petrol (ULP/Premium)",
    unit: "A$K",
    commodity: "petroleum",
    sitcCodes: ["334"],
    description: "Unleaded petrol for passenger and light commercial vehicles. Two domestic refineries (Ampol Lytton, Viva Geelong) cover <15% of demand.",
    supplyRisk: "medium",
    riskNote: "Supply resilient across multiple Asian refiners. EV transition gradually reducing demand growth. Singapore and Korea remain primary and reliable sources.",
    origins: [
      { country: "South Korea", flag: "🇰🇷", share: 45, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 8,   countryCode: "RKOR" },
      { country: "Singapore",   flag: "🇸🇬", share: 34, volume: 0, prevVolume: 0, trend: "stable",yoyChange: -1,  countryCode: "SING" },
      { country: "Japan",       flag: "🇯🇵", share: 9,  volume: 0, prevVolume: 0, trend: "down",  yoyChange: -14, countryCode: "JAP"  },
      { country: "China",       flag: "🇨🇳", share: 6,  volume: 0, prevVolume: 0, trend: "stable",yoyChange: 3,   countryCode: "CHIN" },
      { country: "Other",       flag: "🌏",  share: 6,  volume: 0, prevVolume: 0, trend: "stable",yoyChange: 2,   countryCode: "TOT"  },
    ],
  },
  {
    id: "jet-fuel",
    name: "Jet Fuel (Avtur)",
    unit: "A$K",
    commodity: "petroleum",
    sitcCodes: ["335"],
    description: "Aviation turbine fuel for domestic and international airlines. Demand recovering post-COVID. Sydney and Melbourne account for ~60% of consumption.",
    supplyRisk: "low",
    riskNote: "Diversified supply base. Singapore buffer capacity intact. India's growing refinery share adds resilience. No current supply alerts.",
    origins: [
      { country: "Singapore",   flag: "🇸🇬", share: 26, volume: 0, prevVolume: 0, trend: "stable",yoyChange: 2,   countryCode: "SING" },
      { country: "Malaysia",    flag: "🇲🇾", share: 20, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 15,  countryCode: "MLAY" },
      { country: "China",       flag: "🇨🇳", share: 18, volume: 0, prevVolume: 0, trend: "stable",yoyChange: 4,   countryCode: "CHIN" },
      { country: "South Korea", flag: "🇰🇷", share: 18, volume: 0, prevVolume: 0, trend: "up",    yoyChange: 11,  countryCode: "RKOR" },
      { country: "Japan",       flag: "🇯🇵", share: 10, volume: 0, prevVolume: 0, trend: "down",  yoyChange: -9,  countryCode: "JAP"  },
      { country: "Other",       flag: "🌏",  share: 8,  volume: 0, prevVolume: 0, trend: "up",    yoyChange: 6,   countryCode: "TOT"  },
    ],
  },
];

// ─── BUILD FULL SUBCATEGORY ───────────────────────────────────────────────────
export function buildSubcategory(
  def: Omit<SubcategoryData, "monthlyData" | "anomaly">,
  allRows: ImportDataRow[],
  alertThresholdPct = 15
): SubcategoryData {
  const monthlyData = buildMonthlyData(allRows, def.sitcCodes, alertThresholdPct);
  const origins = enrichOrigins(def.origins, allRows, def.sitcCodes);
  const anomaly = computeAnomaly(monthlyData);
  return { ...def, monthlyData, origins, anomaly };
}

// ─── STATIC FALLBACK ──────────────────────────────────────────────────────────
const FALLBACK_MONTHS = [
  "2024-01","2024-02","2024-03","2024-04","2024-05","2024-06",
  "2024-07","2024-08","2024-09","2024-10","2024-11","2024-12",
  "2025-01","2025-02","2025-03","2025-04","2025-05","2025-06",
  "2025-07","2025-08","2025-09","2025-10","2025-11","2025-12",
];
const FALLBACK_VALUES: Record<string, number[]> = {
  urea:     [446917,495217,625882,590178,411299,356233,329606,311065,146516,231107,185457,464255,530559,597970,596910,636655,443388,434806,275584,311065,429448,421025,422482,482514],
  "dap-map":[446917,495217,625882,590178,411299,356233,329606,311065,146516,231107,185457,464255,530559,597970,596910,636655,443388,434806,275584,311065,429448,421025,422482,482514],
  potash:   [1801,2100,1950,2200,1600,1400,1200,1800,2000,2300,2100,1640,1508,6361,9883,2538,2200,1900,1700,1800,2000,2100,1900,1750],
  diesel:   [2800000,2600000,3100000,2900000,3000000,2800000,2700000,2900000,3000000,3100000,2900000,2700000,2800000,2600000,3000000,2800000,3100000,3000000,3200000,3300000,3440000,3820000,3648000,3810000],
  petrol:   [2200000,2100000,2400000,2300000,2350000,2250000,2100000,2200000,2300000,2400000,2250000,2150000,2200000,2100000,2300000,2250000,2350000,2300000,2400000,2450000,2500000,2600000,2650000,2700000],
  "jet-fuel":[80000,75000,90000,95000,100000,95000,105000,100000,98000,92000,88000,95000,85000,80000,92000,95000,100000,98000,105000,102000,120209,92787,77175,78103],
};

export function buildFallbackSubcategory(def: Omit<SubcategoryData, "monthlyData" | "anomaly">): SubcategoryData {
  const vals = FALLBACK_VALUES[def.id] ?? FALLBACK_VALUES["potash"];
  const monthlyData: MonthlyDataPoint[] = FALLBACK_MONTHS.map((month, i) => {
    const actual = vals[i] ?? vals[vals.length - 1];
    const forecast = Math.round(actual * 1.03);
    return { month, label: periodToLabel(month), actual, forecast, gapPct: -3, momPct: 0, isAlert: false };
  });
  const anomaly: AnomalyScore = { level: "normal", label: "Fallback data", momPct: 0, yoyPct: 0, vsAvgPct: 0, latestPeriod: "2025-12", latestValue: 0 };
  return { ...def, monthlyData, origins: def.origins, anomaly };
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
export function getSubcategoryById(subs: SubcategoryData[], id: string) {
  return subs.find(s => s.id === id);
}
export function getSubcategoriesByCommodity(subs: SubcategoryData[], c: CommodityCategory) {
  return subs.filter(s => s.commodity === c);
}
export function getLatestActual(sub: SubcategoryData) {
  return sub.monthlyData[sub.monthlyData.length - 1]?.actual ?? 0;
}
export function getLatestPeriod(sub: SubcategoryData) {
  return sub.monthlyData[sub.monthlyData.length - 1]?.month ?? "";
}
export function getMoMChange(sub: SubcategoryData) {
  return sub.monthlyData[sub.monthlyData.length - 1]?.momPct ?? 0;
}
export function getYoYChange(sub: SubcategoryData) {
  return sub.anomaly.yoyPct;
}

// AUD thousands formatter
export function fmtAud(val: number): string {
  if (val >= 1_000_000) return `A$${(val / 1_000_000).toFixed(2)}B`;
  if (val >= 1_000) return `A$${(val / 1_000).toFixed(0)}M`;
  return `A$${val.toLocaleString()}K`;
}

// Alert system (quarterly, configurable threshold)
export interface QuarterlyAlert {
  subcategoryId: string;
  subcategoryName: string;
  commodity: CommodityCategory;
  quarter: string;
  actualAvg: number;
  forecastAvg: number;
  deviationPct: number;
  unit: string;
  triggered: boolean;
}

export function computeQuarterlyAlerts(subcategories: SubcategoryData[], thresholdPct = 15): QuarterlyAlert[] {
  const alerts: QuarterlyAlert[] = [];
  for (const sub of subcategories) {
    const quarters = new Map<string, MonthlyDataPoint[]>();
    for (const dp of sub.monthlyData) {
      const [year, month] = dp.month.split("-").map(Number);
      const q = `Q${Math.ceil(month / 3)} ${year}`;
      if (!quarters.has(q)) quarters.set(q, []);
      quarters.get(q)!.push(dp);
    }
    const sortedQs = [...quarters.keys()].sort();
    for (const qKey of sortedQs.slice(-4)) {
      const pts = quarters.get(qKey)!;
      if (pts.length < 2) continue;
      const actualAvg = pts.reduce((s, p) => s + p.actual, 0) / pts.length;
      const forecastAvg = pts.reduce((s, p) => s + p.forecast, 0) / pts.length;
      const deviationPct = ((actualAvg - forecastAvg) / forecastAvg) * 100;
      if (deviationPct <= -thresholdPct) {
        alerts.push({
          subcategoryId: sub.id,
          subcategoryName: sub.name,
          commodity: sub.commodity,
          quarter: qKey,
          actualAvg: Math.round(actualAvg),
          forecastAvg: Math.round(forecastAvg),
          deviationPct: Math.round(deviationPct * 10) / 10,
          unit: sub.unit,
          triggered: true,
        });
      }
    }
  }
  return alerts;
}
