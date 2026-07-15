import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import bmcQr from "../assets/bmc-qr.jpg";
import { apiRequest } from "@/lib/queryClient";
import {
  subcategoryDefs,
  buildSubcategory,
  buildFallbackSubcategory,
  fmtAud,
  periodToLabel,
  type SubcategoryData,
  type ImportDataRow,
  type SyncLog,
  type MonthlyDataPoint,
} from "@/lib/tradeData";
import {
  ComposedChart, AreaChart, Area, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, Cell, BarChart,
} from "recharts";
import L from "leaflet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Loader2, Zap, ShieldAlert, ShieldCheck,
  Flame, Sprout, ChevronDown, ChevronUp, BarChart2,
  Database, Factory, MapPin, TrendingDown, TrendingUp,
  Users, Truck, Wheat, Building2, AlertTriangle, Calendar,
  Activity, Target, Package, ArrowDown, Info, GitBranch,
  Ship, Cpu, Clock, CheckCircle,
} from "lucide-react";
import AustraliaMap from "../components/AustraliaMap";
import ShipmentTracker from "../components/ShipmentTracker";

// ─── PALETTE ──────────────────────────────────────────────────────────────────
const C = {
  supply:    "#20808d",
  projected: "#4a9ead",
  nextMonth: "#5bc4b0",
  demand:    "#f5a623",
  domestic:  "#22c55e",
  gap:       "#e05260",
  hormuz:    "#c94c1a",
  subst:     "#7c5cbf",
  reserve:   "#8b5cf6",
  warning:   "#f59e0b",
  history24: "#334155",
  history25: "#1e3a4a",
};

// ─── DEMAND BASELINES ─────────────────────────────────────────────────────────
const FERT_SEASONAL    = [0.55,0.60,0.80,1.30,1.40,1.10,0.70,0.65,0.85,1.20,1.10,0.75];
const PETROL_SEASONAL  = [1.02,0.95,1.00,0.98,1.02,1.00,0.98,1.00,1.02,1.05,1.02,1.00];
const DIESEL_SEASONAL  = [1.00,0.92,0.98,1.02,1.05,1.08,1.05,1.02,1.00,1.00,0.98,0.95];

const ANNUAL_DEMAND_BASE: Record<string,number> = {
  urea:        2_079_000,
  "dap-map":   1_200_000,
  potash:        420_000,
  diesel:     26_900_000,
  petrol:     11_200_000,
  "jet-fuel": 13_680_000,
};

const HORMUZ_PRICE_FACTOR: Record<string,Record<string,number>> = {
  urea:       {"2026-03":1.35,"2026-04":1.62,"2026-05":1.70,"2026-06":1.72,"2026-07":1.68,"2026-08":1.65},
  "dap-map":  {"2026-03":1.20,"2026-04":1.35,"2026-05":1.40,"2026-06":1.42,"2026-07":1.38,"2026-08":1.35},
  potash:     {"2026-03":1.05,"2026-04":1.08,"2026-05":1.10,"2026-06":1.10,"2026-07":1.08,"2026-08":1.06},
  diesel:     {"2026-03":1.45,"2026-04":1.65,"2026-05":1.68,"2026-06":1.70,"2026-07":1.65,"2026-08":1.60},
  petrol:     {"2026-03":1.40,"2026-04":1.58,"2026-05":1.60,"2026-06":1.62,"2026-07":1.58,"2026-08":1.55},
  "jet-fuel": {"2026-03":1.50,"2026-04":1.70,"2026-05":1.72,"2026-06":1.74,"2026-07":1.70,"2026-08":1.65},
};

const DOMESTIC_PCT: Record<string,number> = {
  urea:0, "dap-map":5, potash:0, diesel:20, petrol:20, "jet-fuel":8,
};

const RESERVE_DAYS: Record<string,{current:number;ieaTarget:number;label:string;trendMonths:string[];trendDays:number[];note:string}> = {
  urea:     {current:0,ieaTarget:0,label:"No reserve",trendMonths:[],trendDays:[],
    note:"No strategic fertilizer reserve. EFA insurance/loans for private imports. AU-Indonesia gov-to-gov: 250,000t urea (PT Pupuk Kalimantan Timur) — first tranche 47,250t departed May 2026."},
  "dap-map":{current:0,ieaTarget:0,label:"No reserve",trendMonths:[],trendDays:[],
    note:"No strategic reserve. $250M via EFA for emergency phosphate procurement. OCP Morocco signed direct supply deal with Fertiliser Australia."},
  potash:   {current:0,ieaTarget:0,label:"No reserve",trendMonths:[],trendDays:[],
    note:"No strategic reserve. Canadian supply (Nutrien/Mosaic) via Pacific route unaffected by Hormuz. Monitor Belarus sanctions impact (−30% volume)."},
  diesel:   {current:39,ieaTarget:90,label:"39 days",
    trendMonths:["Sep 25","Oct 25","Nov 25","Dec 25","Jan 26","Feb 26","Mar 26","Apr 26","May 26","Jun 26","Jul 26","Aug 26"],
    trendDays:  [90,       88,       85,       82,       78,       72,       55,       42,       35,       39,       37,       35],
    note:"800M litres diesel secured via $7.5B Fuel & Fertiliser Security Facility. 100% storage capacity reached Jun 2026. Budget 2026-27: $3.2B AU Fuel Security Reserve targeting 50 days diesel+jet. MSO expanded +10 days."},
  petrol:   {current:44,ieaTarget:90,label:"44 days",
    trendMonths:["Sep 25","Oct 25","Nov 25","Dec 25","Jan 26","Feb 26","Mar 26","Apr 26","May 26","Jun 26","Jul 26","Aug 26"],
    trendDays:  [90,       88,       84,       80,       76,       70,       58,       48,       42,       44,       42,       40],
    note:"IEA 90-day standard unmet. Minimum Stockholding Obligation expanded +10 days. Domestic Ampol Lytton + Viva Geelong cover ~20%."},
  "jet-fuel":{current:32,ieaTarget:90,label:"32 days",
    trendMonths:["Sep 25","Oct 25","Nov 25","Dec 25","Jan 26","Feb 26","Mar 26","Apr 26","May 26","Jun 26","Jul 26","Aug 26"],
    trendDays:  [90,       87,       82,       76,       68,       58,       44,       36,       31,       32,       30,       28],
    note:"Most critical — 29 days at crisis onset. Sydney+Melbourne ~60% of jet consumption. IEA warns inventories could hit critical levels Jul–Aug 2026."},
};

// ─── REFINERY / SUPPLY CHAIN DATA ─────────────────────────────────────────────
interface RefineryEntry {
  facility: string;
  country: string;
  flag: string;
  operator: string;
  capacity: string;          // production capacity descriptor
  auSharePct: number;        // % of AU imports from this source pre-crisis
  auSharePostPct: number;    // % of AU imports from this source post-crisis
  status: "collapsed"|"reduced"|"stable"|"surged";
  productionNote: string;
  shippingRoute: string;
  transitDays: number;
}

const REFINERY_DATA: Record<string, RefineryEntry[]> = {
  urea: [
    {facility:"Safaniya Urea Complex", country:"Saudi Arabia", flag:"🇸🇦", operator:"SABIC / Saudi Aramco",
     capacity:"2.2Mt/yr urea", auSharePct:28, auSharePostPct:0.1, status:"collapsed",
     productionNote:"Associated gas feedstock from Safaniya offshore field. Field shut down Feb 2026 by Operation Epic Fury damage. Zero production. ABS confirms: A$152,587K (Apr 2025) → A$631K (Apr 2026) = −99.6%.",
     shippingRoute:"Persian Gulf → Hormuz → Indian Ocean → AU", transitDays:22},
    {facility:"Mesaieed & Ras Laffan", country:"Qatar", flag:"🇶🇦", operator:"QatarEnergy / QAFCO",
     capacity:"3.8Mt/yr urea (world's largest complex)", auSharePct:19, auSharePostPct:3, status:"collapsed",
     productionNote:"Missile strike on LNG facilities Mar 3 2026. QatarEnergy halted all downstream production. QAFCO I–VI plants offline. World's largest urea producer producing near-zero.",
     shippingRoute:"Persian Gulf → Hormuz (BLOCKED)", transitDays:0},
    {facility:"Salalah & Sur Plants", country:"Oman", flag:"🇴🇲", operator:"Oman India Fertiliser Co / OMIFCO",
     capacity:"1.6Mt/yr urea", auSharePct:14, auSharePostPct:10, status:"reduced",
     productionNote:"Oman has direct Arabian Sea access — not Hormuz-dependent. However war-risk insurance (+400%) deters shippers. Partial resumption underway.",
     shippingRoute:"Arabian Sea → Indian Ocean → AU", transitDays:18},
    {facility:"EFC & MOPCO Plants", country:"Egypt", flag:"🇪🇬", operator:"EFC / MOPCO",
     capacity:"1.4Mt/yr urea", auSharePct:12, auSharePostPct:14, status:"surged",
     productionNote:"Mediterranean-facing plants fully operational. Egypt Agriculture Ministry confirmed exports to AU up 18% YoY. Running at maximum capacity.",
     shippingRoute:"Mediterranean → Suez → Indian Ocean → AU", transitDays:28},
    {facility:"PT Pupuk Kalimantan Timur", country:"Indonesia", flag:"🇮🇩", operator:"PT Pupuk Kaltim (state-owned)",
     capacity:"3.4Mt/yr urea, 1.5Mt export surplus", auSharePct:10, auSharePostPct:31, status:"surged",
     productionNote:"Gov-to-gov AU-Indonesia deal Apr 2026: 250,000t initial tranche, expanding 500,000t (~A$430M). First shipment 47,250t departed Bontang May 2026. Located in Kalimantan, East Indonesia.",
     shippingRoute:"Bontang, Kalimantan → Banda Sea → Timor Sea → AU", transitDays:8},
    {facility:"Petronas + MISCM Plants", country:"Malaysia", flag:"🇲🇾", operator:"Petronas / MISCM",
     capacity:"1.2Mt/yr urea", auSharePct:5, auSharePostPct:28, status:"surged",
     productionNote:"ABS confirms Malaysia urea to AU +2122% YoY (Apr 2026). Petronas-linked plants in Sarawak ramping maximum output for AU market. Short transit time is a strategic advantage.",
     shippingRoute:"Sarawak → South China Sea → AU NW Shelf", transitDays:6},
  ],
  "dap-map": [
    {facility:"Ma'aden Wa'ad Al Shamal (MWSPC)", country:"Saudi Arabia", flag:"🇸🇦", operator:"Ma'aden / Sabic / Mosaic",
     capacity:"3.0Mt/yr DAP (world's largest complex)", auSharePct:34, auSharePostPct:2, status:"collapsed",
     productionNote:"Ammonia feedstock shortfall due to associated gas disruption. Output cut ~80%. Some volume rerouted via Red Sea pipeline at extreme cost. Effective AU supply near-zero.",
     shippingRoute:"Red Sea → Suez → Indian Ocean → AU (partial)", transitDays:32},
    {facility:"Jorf Lasfar & Safi Complexes", country:"Morocco", flag:"🇲🇦", operator:"OCP Group (state-owned)",
     capacity:"10Mt/yr rock phosphate processing, 4Mt phosphoric acid", auSharePct:25, auSharePostPct:44, status:"surged",
     productionNote:"World's largest phosphate miner (75% of global phosphate reserves in Morocco). Atlantic-facing — entirely unaffected by Hormuz. OCP signed direct supply agreement with Fertiliser Australia. Running at max capacity.",
     shippingRoute:"Atlantic → Cape of Good Hope → Southern Ocean → AU", transitDays:35},
    {facility:"Kingisepp & Cherepovets Plants", country:"Russia", flag:"🇷🇺", operator:"PhosAgro",
     capacity:"3.5Mt/yr DAP/MAP", auSharePct:10, auSharePostPct:10, status:"stable",
     productionNote:"Baltic port exports stable. Sanctions navigation via European intermediaries adds ~2 weeks transit time but volumes maintained under existing contracts.",
     shippingRoute:"Baltic → Cape of Good Hope → Southern Ocean → AU", transitDays:42},
    {facility:"Yunnan & Guizhou Province Plants", country:"China", flag:"🇨🇳", operator:"Yuntianhua / Guizhou Kailin",
     capacity:"8Mt/yr DAP/MAP (domestic + export)", auSharePct:18, auSharePostPct:7, status:"reduced",
     productionNote:"Not Hormuz-related. China's 2025-26 DAP/MAP export quota ~2Mt vs historic 6Mt. Beijing protecting domestic food security. Policy restriction reducing AU availability.",
     shippingRoute:"South China Sea → Torres Strait → AU", transitDays:12},
  ],
  potash: [
    {facility:"Vanscoy, Allan, Cory Mines", country:"Canada", flag:"🇨🇦", operator:"Nutrien Ltd",
     capacity:"14Mt/yr MOP (world's largest producer)", auSharePct:48, auSharePostPct:55, status:"surged",
     productionNote:"Saskatchewan mines fully operational. Pacific routing via Vancouver/Prince Rupert unaffected by Hormuz. AU increasing Canadian share as security-of-supply preference. Nutrien has spare capacity.",
     shippingRoute:"Vancouver/Prince Rupert → Pacific → AU", transitDays:14},
    {facility:"Belle Plaine & Colonsay Mines", country:"Canada", flag:"🇨🇦", operator:"Mosaic Company",
     capacity:"9Mt/yr MOP", auSharePct:10, auSharePostPct:12, status:"surged",
     productionNote:"Saskatchewan operations at full capacity. Same Pacific routing as Nutrien. AU procurement team confirmed increased orders for H2 2026.",
     shippingRoute:"Vancouver → Pacific → AU", transitDays:14},
    {facility:"Soligorsk & Starobin Mines", country:"Belarus", flag:"🇧🇾", operator:"Belaruskali",
     capacity:"12Mt/yr MOP", auSharePct:15, auSharePostPct:10, status:"reduced",
     productionNote:"EU/US sanctioned. AU imports via Singapore intermediaries. Freight routing adds 2-3 weeks and 15-20% cost premium. Volume declining as AU shifts to Canadian supply.",
     shippingRoute:"Baltic → Cape of Good Hope → Indian Ocean → AU (via Singapore)", transitDays:48},
    {facility:"Verkhnekamskoye & Solikamsk Mines", country:"Russia", flag:"🇷🇺", operator:"Uralkali / EuroChem",
     capacity:"16Mt/yr MOP", auSharePct:22, auSharePostPct:18, status:"reduced",
     productionNote:"Ukraine drone strikes on Russian rail/logistics causing ~15% volume disruption. Sanctions-related freight friction. Baltic export terminals operating but with delays.",
     shippingRoute:"Baltic → Cape of Good Hope → Indian Ocean → AU", transitDays:45},
  ],
  diesel: [
    {facility:"Ulsan, Yeosu, Onsan Refineries", country:"South Korea", flag:"🇰🇷", operator:"SK Energy / GS Caltex / S-Oil",
     capacity:"3.5M bpd combined (world's largest refining cluster)", auSharePct:30, auSharePostPct:38, status:"surged",
     productionNote:"Running at maximum utilisation. Crude feedstock shifted from Middle East to US WTI, Russian ESPO and West African grades. Korean refiners filling Gulf supply gap aggressively. Korean gov encouraged exports to AU under bilateral energy security agreement.",
     shippingRoute:"Yellow Sea → Pacific → AU", transitDays:10},
    {facility:"ExxonMobil & Shell Jurong Island", country:"Singapore", flag:"🇸🇬", operator:"ExxonMobil / Shell",
     capacity:"1.4M bpd combined", auSharePct:23, auSharePostPct:20, status:"reduced",
     productionNote:"Singapore refineries face reduced Middle East crude feedstock (down ~25%). Overall throughput down ~10%. Still AU's second largest supplier but losing share to Korean and Indian producers.",
     shippingRoute:"Strait of Malacca → Java Sea → AU", transitDays:8},
    {facility:"RAPID (Pengerang) & Melaka Refinery", country:"Malaysia", flag:"🇲🇾", operator:"Petronas",
     capacity:"900,000 bpd combined", auSharePct:14, auSharePostPct:24, status:"surged",
     productionNote:"Petronas Pengerang Integrated Complex running at max utilisation. Domestic crude from Peninsular/Sarawak fields unaffected. Redirecting output to AU at premium prices. ABS confirms Malaysia diesel to AU +56% YoY.",
     shippingRoute:"South China Sea → AU NW Shelf", transitDays:7},
    {facility:"Basrah & Baiji Refineries", country:"Iraq", flag:"🇮🇶", operator:"SOMO / State Oil",
     capacity:"700,000 bpd (pre-crisis)", auSharePct:5, auSharePostPct:0.5, status:"collapsed",
     productionNote:"Iraq oil exports collapsed 89% in April 2026 — from 93M to ~10M bbl/mo. Only Kirkuk-Ceyhan pipeline (~200,000 bpd) still operational. Basrah export terminal in Gulf — Hormuz-blocked.",
     shippingRoute:"Persian Gulf → Hormuz (BLOCKED)", transitDays:0},
    {facility:"Jamnagar Refinery Complex", country:"India", flag:"🇮🇳", operator:"Reliance Industries",
     capacity:"1.24M bpd (world's largest single site)", auSharePct:7, auSharePostPct:11, status:"surged",
     productionNote:"Reliance running at >95% utilisation. Importing Russian ESPO crude at discount via Indian Ocean, refining and re-exporting diesel/petrol to AU. Major beneficiary of Gulf supply gap. ABS confirms India diesel to AU +56% YoY.",
     shippingRoute:"Arabian Sea → Indian Ocean → AU", transitDays:11},
    {facility:"Ruwais & Fujairah Refineries", country:"UAE", flag:"🇦🇪", operator:"ADNOC",
     capacity:"900,000 bpd", auSharePct:5, auSharePostPct:0.2, status:"collapsed",
     productionNote:"ADNOC exports severely curtailed. Gulf export terminals Hormuz-dependent. UAE attempted pipeline routing but capacity insufficient. Near-zero product reaching AU.",
     shippingRoute:"Persian Gulf → Hormuz (BLOCKED)", transitDays:0},
  ],
  petrol: [
    {facility:"Ulsan & Yeosu Refineries", country:"South Korea", flag:"🇰🇷", operator:"SK Energy / GS Caltex",
     capacity:"2.0M bpd gasoline-heavy output", auSharePct:45, auSharePostPct:50, status:"surged",
     productionNote:"Korean refineries dominant and increasing share. Gasoline-heavy slate well-suited to AU petrol demand. Crude feedstock diversified to non-Gulf sources. Increasing output dedicated to AU market.",
     shippingRoute:"Yellow Sea → Pacific → AU", transitDays:10},
    {facility:"Pulau Bukom & Jurong Island", country:"Singapore", flag:"🇸🇬", operator:"Shell / ExxonMobil",
     capacity:"1.1M bpd", auSharePct:34, auSharePostPct:28, status:"reduced",
     productionNote:"Constrained by Middle East crude feedstock reduction. Throughput down ~10-15%. Still stable but losing share to Korean and Indian producers.",
     shippingRoute:"Strait of Malacca → Java Sea → AU", transitDays:8},
    {facility:"Nagoya, Chiba, Yokkaichi", country:"Japan", flag:"🇯🇵", operator:"Eneos / Idemitsu",
     capacity:"1.5M bpd combined", auSharePct:9, auSharePostPct:7, status:"reduced",
     productionNote:"Japan prioritising domestic fuel security. PM secured 70%+ of June crude via Russian Sakhalin and non-Gulf routes. Cutting product export volumes to AU to protect domestic stocks.",
     shippingRoute:"Pacific → AU", transitDays:8},
    {facility:"Jamnagar & Vadinar", country:"India", flag:"🇮🇳", operator:"Reliance / Nayara Energy",
     capacity:"1.7M bpd combined", auSharePct:7, auSharePostPct:12, status:"surged",
     productionNote:"India ramping gasoline exports on Russian crude arbitrage. Reliance Jamnagar running at >95% utilisation. ABS confirms India petrol to AU +67% YoY.",
     shippingRoute:"Arabian Sea → Indian Ocean → AU", transitDays:11},
  ],
  "jet-fuel": [
    {facility:"RAPID Pengerang Complex", country:"Malaysia", flag:"🇲🇾", operator:"Petronas",
     capacity:"400,000 bpd Avtur output", auSharePct:20, auSharePostPct:30, status:"surged",
     productionNote:"Petronas RAPID Pengerang dedicated Avtur output increased. Key AU aviation supplier filling Singapore gap. Malaysian crude unaffected. ABS confirms Malaysia jet to AU +50% YoY.",
     shippingRoute:"South China Sea → AU NW Shelf", transitDays:7},
    {facility:"Jurong Island Aviation Fuel Hub", country:"Singapore", flag:"🇸🇬", operator:"Shell Aviation / ExxonMobil",
     capacity:"500,000 bpd Avtur throughput", auSharePct:26, auSharePostPct:20, status:"reduced",
     productionNote:"World's largest aviation fuel hub constrained by reduced feedstock. Still primary hub but volume down ~22%. Singapore buffer stocks partially offsetting.",
     shippingRoute:"Strait of Malacca → Java Sea → AU", transitDays:8},
    {facility:"Yeosu Avtur Facility", country:"South Korea", flag:"🇰🇷", operator:"GS Caltex / SK Geocentric",
     capacity:"300,000 bpd Avtur", auSharePct:18, auSharePostPct:24, status:"surged",
     productionNote:"Korean refiners increasing Avtur output for AU/Asian aviation market. Jet fuel premium pricing making Korean supply highly competitive. ABS confirms Korea jet to AU +33% YoY.",
     shippingRoute:"Yellow Sea → Pacific → AU", transitDays:10},
    {facility:"Abu Dhabi Aviation Fuel Complex", country:"UAE", flag:"🇦🇪", operator:"ADNOC Aviation",
     capacity:"700,000 bpd Avtur", auSharePct:15, auSharePostPct:0.5, status:"collapsed",
     productionNote:"UAE Abu Dhabi aviation fuel exports near-zero — all Hormuz-dependent. Qatar jet fuel production halted with LNG feedstock. AU held only 29 days jet cover at crisis onset.",
     shippingRoute:"Persian Gulf → Hormuz (BLOCKED)", transitDays:0},
    {facility:"Chiba & Mizushima Refineries", country:"Japan", flag:"🇯🇵", operator:"Eneos",
     capacity:"400,000 bpd Avtur capable", auSharePct:10, auSharePostPct:8, status:"reduced",
     productionNote:"Japan prioritising domestic aviation demand. Modest reduction in AU jet fuel exports as Japan secures own stocks under national energy security plan.",
     shippingRoute:"Pacific → AU", transitDays:8},
  ],
};

// ─── PROJECTED vs RECEIVED (Oct 2025 → Aug 2026 + Sep projection) ─────────────
const PROJECTED_VS_RECEIVED: Record<string,{month:string;label:string;projected:number;received:number;isProjection?:boolean}[]> = {
  diesel: [
    {month:"2025-10",label:"Oct 25",projected:3420000,received:3820000},
    {month:"2025-11",label:"Nov 25",projected:3380000,received:3648000},
    {month:"2025-12",label:"Dec 25",projected:3300000,received:3810000},
    {month:"2026-01",label:"Jan 26",projected:3350000,received:3500000},
    {month:"2026-02",label:"Feb 26",projected:3200000,received:3300000},
    {month:"2026-03",label:"Mar 26",projected:3150000,received:2200000},
    {month:"2026-04",label:"Apr 26",projected:3100000,received:2050000},
    {month:"2026-05",label:"May 26",projected:3200000,received:2100000},
    {month:"2026-06",label:"Jun 26",projected:3250000,received:2200000},
    {month:"2026-07",label:"Jul 26",projected:3200000,received:2400000},
    {month:"2026-08",label:"Aug 26",projected:3180000,received:2500000},
    {month:"2026-09",label:"Sep 26",projected:3150000,received:2650000,isProjection:true},
  ],
  petrol: [
    {month:"2025-10",label:"Oct 25",projected:2550000,received:2600000},
    {month:"2025-11",label:"Nov 25",projected:2580000,received:2650000},
    {month:"2025-12",label:"Dec 25",projected:2620000,received:2700000},
    {month:"2026-01",label:"Jan 26",projected:2600000,received:2680000},
    {month:"2026-02",label:"Feb 26",projected:2550000,received:2600000},
    {month:"2026-03",label:"Mar 26",projected:2520000,received:1900000},
    {month:"2026-04",label:"Apr 26",projected:2500000,received:1750000},
    {month:"2026-05",label:"May 26",projected:2530000,received:1850000},
    {month:"2026-06",label:"Jun 26",projected:2550000,received:1950000},
    {month:"2026-07",label:"Jul 26",projected:2520000,received:2050000},
    {month:"2026-08",label:"Aug 26",projected:2500000,received:2100000},
    {month:"2026-09",label:"Sep 26",projected:2480000,received:2200000,isProjection:true},
  ],
  "jet-fuel": [
    {month:"2025-10",label:"Oct 25",projected:100000,received:92000},
    {month:"2025-11",label:"Nov 25",projected:105000,received:77000},
    {month:"2025-12",label:"Dec 25",projected:110000,received:78000},
    {month:"2026-01",label:"Jan 26",projected:108000,received:80000},
    {month:"2026-02",label:"Feb 26",projected:105000,received:78000},
    {month:"2026-03",label:"Mar 26",projected:102000,received:52000},
    {month:"2026-04",label:"Apr 26",projected:100000,received:38000},
    {month:"2026-05",label:"May 26",projected:103000,received:42000},
    {month:"2026-06",label:"Jun 26",projected:105000,received:48000},
    {month:"2026-07",label:"Jul 26",projected:104000,received:52000},
    {month:"2026-08",label:"Aug 26",projected:102000,received:55000},
    {month:"2026-09",label:"Sep 26",projected:100000,received:58000,isProjection:true},
  ],
  urea: [
    {month:"2025-10",label:"Oct 25",projected:520000,received:484000},
    {month:"2025-11",label:"Nov 25",projected:540000,received:422000},
    {month:"2025-12",label:"Dec 25",projected:560000,received:483000},
    {month:"2026-01",label:"Jan 26",projected:580000,received:450000},
    {month:"2026-02",label:"Feb 26",projected:560000,received:480000},
    {month:"2026-03",label:"Mar 26",projected:550000,received:180000},
    {month:"2026-04",label:"Apr 26",projected:540000,received:85000},
    {month:"2026-05",label:"May 26",projected:560000,received:120000},
    {month:"2026-06",label:"Jun 26",projected:575000,received:160000},
    {month:"2026-07",label:"Jul 26",projected:560000,received:210000},
    {month:"2026-08",label:"Aug 26",projected:550000,received:260000},
    {month:"2026-09",label:"Sep 26",projected:545000,received:310000,isProjection:true},
  ],
  "dap-map": [
    {month:"2025-10",label:"Oct 25",projected:155000,received:148000},
    {month:"2025-11",label:"Nov 25",projected:148000,received:140000},
    {month:"2025-12",label:"Dec 25",projected:152000,received:145000},
    {month:"2026-01",label:"Jan 26",projected:150000,received:142000},
    {month:"2026-02",label:"Feb 26",projected:148000,received:138000},
    {month:"2026-03",label:"Mar 26",projected:145000,received:68000},
    {month:"2026-04",label:"Apr 26",projected:142000,received:42000},
    {month:"2026-05",label:"May 26",projected:145000,received:58000},
    {month:"2026-06",label:"Jun 26",projected:148000,received:72000},
    {month:"2026-07",label:"Jul 26",projected:145000,received:85000},
    {month:"2026-08",label:"Aug 26",projected:143000,received:95000},
    {month:"2026-09",label:"Sep 26",projected:142000,received:108000,isProjection:true},
  ],
  potash: [
    {month:"2025-10",label:"Oct 25",projected:40000,received:38000},
    {month:"2025-11",label:"Nov 25",projected:38000,received:36000},
    {month:"2025-12",label:"Dec 25",projected:36000,received:34000},
    {month:"2026-01",label:"Jan 26",projected:35000,received:28000},
    {month:"2026-02",label:"Feb 26",projected:36000,received:30000},
    {month:"2026-03",label:"Mar 26",projected:37000,received:32000},
    {month:"2026-04",label:"Apr 26",projected:38000,received:30000},
    {month:"2026-05",label:"May 26",projected:37000,received:33000},
    {month:"2026-06",label:"Jun 26",projected:36000,received:35000},
    {month:"2026-07",label:"Jul 26",projected:35000,received:36000},
    {month:"2026-08",label:"Aug 26",projected:34000,received:35000},
    {month:"2026-09",label:"Sep 26",projected:34000,received:36000,isProjection:true},
  ],
};

// ─── SECTOR IMPACT DATA ───────────────────────────────────────────────────────
interface SectorImpact {
  id:string; sector:string; icon:any; iconColor:string;
  severityLevel:"critical"|"high"|"medium";
  headline:string; currentImpacts:string[]; projectedImpacts:string[]; planningNotes:string;
  affectedGroups:string;
  alertLevel: string;
}

const SECTOR_IMPACTS: SectorImpact[] = [
  {
    id:"farmers", sector:"Farmers & Agriculture", icon:Wheat, iconColor:"#22c55e",
    severityLevel:"critical", alertLevel:"Winter sowing at risk",
    headline:"Urea shortfall jeopardises 2026 harvest — winter sowing window partially missed",
    affectedGroups:"~85,000 grain/broadacre farms; Northern NSW, QLD, WA most exposed",
    currentImpacts:[
      "Urea prices surged A$830–840/t → A$1,000–1,400/t (Feb–Apr 2026) — CommBank farm cost report",
      "Winter sowing window Apr–Jun 2026 partially missed — urea unavailable or unaffordable in many regions",
      "Saudi urea AU supply collapsed 99.6% YoY; Qatar completely offline; total urea Apr 2026 ~84% below projected",
      "Indonesian substitution deal (250,000t) covers ~6% of annual demand — insufficient to fill Gulf gap",
      "DAP/MAP from Saudi Ma'aden down 94%; now relying on Moroccan OCP and Russian supply (longer lead times, higher cost)",
    ],
    projectedImpacts:[
      "2026–27 winter crop yields projected 15–25% below average if sowing shortfall not addressed",
      "Canola and wheat most exposed — high nitrogen demand at sowing cannot be deferred",
      "Fertilizer costs expected to remain 40–70% above 2025 levels through end of 2026",
      "Compound fertilizer blending disrupted by urea/DAP shortfall even where potash is available",
      "EFA insurance/loan facility extended but take-up limited by price uncertainty for small farms",
    ],
    planningNotes:"Secure phosphate (DAP/MAP) stocks from Moroccan OCP now — OCP-Fertiliser Australia agreement is active. Potash from Canada unaffected — procure early for spring. Indonesian urea Tranche 2 (500,000t) expected Sep 2026 — plan application timing around this shipment.",
  },
  {
    id:"logistics", sector:"Logistics & Transport", icon:Truck, iconColor:"#f5a623",
    severityLevel:"critical", alertLevel:"Freight rationing protocols active",
    headline:`Diesel at ${RESERVE_DAYS.diesel.current} days cover — rationing protocols being prepared for sub-20 day threshold`,
    affectedGroups:"~1.2M heavy vehicle operators; supply chains; remote community fuel supply",
    currentImpacts:[
      `Diesel reserve dropped from ~90 days (pre-crisis) to a low of 32 days (Apr 2026) — now ${RESERVE_DAYS.diesel.current} days. IEA minimum is 90 days`,

      "Diesel price increases of 45–65% since Feb 2026 driving double-digit freight cost escalation across all sectors",
      "Truck operators reporting supply uncertainty at regional depots; some forward purchasing at premium",
      "Mining sector (WA Pilbara, QLD coal) consuming 25–30% of national diesel — emergency procurement prioritised for mining",
      "50 emergency tankers dispatched but full delivery cycle 6–8 weeks — Jun–Jul 2026 is peak risk window",
    ],
    projectedImpacts:[
      "Fuel rationing protocols prepared — if reserves fall below 20 days, priority: emergency services → mining → food supply chain",
      "Freight costs projected to remain 30–50% above 2025 through Dec 2026 — pass-through to consumer prices",
      "Rail freight faces diesel locomotive constraints; ARTC and QR National contingency plans activated",
      "Cold chain logistics (food, pharma) most vulnerable if diesel allocation is prioritised to bulk freight",
      "Budget 2026-27 $3.2B fuel reserve targets 50 days by end of financial year — procurement pipeline is 6+ months",
    ],
    planningNotes:"Fleet operators: hedge fuel costs via fixed-price contracts now if available. Maintain minimum 30-day on-site tank storage where possible. Register with AISC for priority fuel allocation in critical supply chain roles. Priority order expected: emergency services → agriculture → mining → commercial freight.",
  },
  {
    id:"citizens", sector:"Households & Citizens", icon:Users, iconColor:"#7c5cbf",
    severityLevel:"high", alertLevel:"Petrol prices +40–58%",
    headline:"Petrol and food costs rising sharply — household budgets under 12–18 month pressure",
    affectedGroups:"26 million Australians; low-income households, remote communities most affected",
    currentImpacts:[
      "Petrol prices increased 40–58% since Feb 2026 — average bowser exceeding A$2.40/L in metro areas",
      "Electricity bills rising ~25% YoY as gas-fired generation costs increase",
      "Supermarket staple goods up 8–15% due to freight and fertilizer cost pass-through",
      "CPI forecast to rise 1.5–2.5 percentage points above baseline through remainder of 2026",
      `Petrol reserve at ${RESERVE_DAYS.petrol.current} days — below IEA standard but above critical threshold; no rationing for passenger vehicles yet`,
    ],
    projectedImpacts:[
      "Sustained fuel cost elevation through 2026–27 — 12–18 month recovery timeline even if Hormuz reopens",
      "Food price inflation to peak mid-2026 as fertilizer shortfall flows through to crop yields by harvest",
      "Government relief measures expected — fuel excise relief, energy bill rebates under Budget 2026-27",
      "EV uptake acceleration likely as petrol price volatility drives consumer switching decisions",
      "Remote and regional communities most vulnerable — higher fuel dependency, fewer alternatives",
    ],
    planningNotes:"Households: consider fuel-efficient vehicles for replacement purchases. Reduce discretionary vehicle use during peak price periods. Build 2–4 weeks non-perishable food supply. Monitor government relief announcements — Budget 2026-27 includes fuel excise review. Energy rebates being processed.",
  },
  {
    id:"businesses", sector:"Businesses & Industry", icon:Building2, iconColor:"#20808d",
    severityLevel:"high", alertLevel:"Input costs +30–70%",
    headline:"Input cost surge hitting margins — aviation, petrochemical and ag-dependent industries hardest",
    affectedGroups:"~850,000 businesses; aviation, mining, agriculture, manufacturing most exposed",
    currentImpacts:[
      "Manufacturing input costs rising sharply — petrochemical feedstocks, plastics, fertilizer products all price-escalating",
      "Construction sector facing diesel cost pressure; project margins eroding on fixed-price contracts",
      `Aviation industry: jet fuel at ${RESERVE_DAYS["jet-fuel"].current}-day reserve; Qantas/Virgin face A$2–3B cost escalation for 2026`,
      "Food manufacturing: ingredient cost pressure from both fertilizer shortfall (grain/canola prices up) and freight",
      "SMEs without fuel hedging positions most exposed — large corporates with forward contracts partially insulated",
    ],
    projectedImpacts:[
      "Aviation capacity likely constrained Jul–Aug 2026 if jet fuel reserves fall below threshold — domestic routes first",
      "Petrochemical manufacturers may receive priority fuel allocations displacing commercial transport",
      "Businesses dependent on fertilizer (horticulture, sugar, cotton) face 2–3 season impact from supply disruption",
      "Insurance markets repricing supply chain risk — cost of trade credit insurance rising significantly",
      "Export-oriented agriculture (cotton, canola, sugar) most exposed to combined fertilizer cost + yield reduction",
    ],
    planningNotes:"Audit fuel and fertilizer exposure now. Identify fixed-price contract opportunities immediately. Review force majeure clauses in long-term supply contracts. Model 60% cost uplift scenarios through Dec 2026. Consider activating AISC contingency plans for critical inputs.",
  },
  {
    id:"infrastructure", sector:"Critical Infrastructure", icon:Activity, iconColor:"#e05260",
    severityLevel:"critical", alertLevel:"Priority allocation protocols active",
    headline:"Hospitals, defence, emergency services on fuel priority protocols — IEA Jul–Aug warning active",
    affectedGroups:"Hospitals, water utilities, power grid, emergency services, defence, telecoms, data centres",
    currentImpacts:[
      "Hospitals: all major hospitals maintaining 90-day onsite generator diesel reserves under AHA protocol",
      "Defence: ADF activated fuel priority protocols — military forward procurement classified but significant",
      "Emergency services: fire, ambulance, police on guaranteed priority fuel allocation per AISC framework",
      "Data centres and telecoms: backup generator diesel procurement accelerated — NBN, Telstra, banking infrastructure",
      "Water treatment facilities: diesel-powered pump stations in regional areas running contingency reserve plans",
    ],
    projectedImpacts:[
      "If national diesel falls below 20 days: COAG-level rationing cascade — emergency services → critical infrastructure → essential industry",
      "CASA reviewing protocols for domestic flight frequency reductions if jet fuel falls below 21 days reserve",
      "Gas-fired power generation increasingly constrained — AEMO emergency reserves may be activated in peak demand",
      "Desalination plants (Perth, Sydney, Melbourne, Adelaide) on heightened readiness — energy cost surging",
      "National Fuel Emergency declaration trigger points prepared by government — awaiting Jun–Jul 2026 inventory data",
    ],
    planningNotes:"Critical infrastructure operators: verify onsite diesel at maximum capacity now. Establish supplier priority agreements. Test generator run-hours for extended outage scenarios. Register with AISC critical infrastructure resilience framework for priority fuel allocation if not already enrolled.",
  },
];

// ─── REGION DATA (used in origins tab) ────────────────────────────────────────
interface RegionRow {
  region:string; flag:string; normalSharePct:number; currentSharePct:number;
  changePct:number; status:"collapsed"|"reduced"|"stable"|"surged";
  reason:string; bypassRoute?:string;
}
const REGION_DATA: Record<string,RegionRow[]> = {
  urea:[
    {region:"Saudi Arabia",flag:"SA",normalSharePct:28,currentSharePct:0.1,changePct:-99.6,status:"collapsed",reason:"Saudi Aramco offshore fields (incl. Safaniya) shut down. Urea feedstock gas halted. ABS: A$152,587K (Apr 2025) → A$631K (Apr 2026).",bypassRoute:"IPSA pipeline (oil only, not urea)"},
    {region:"Qatar",flag:"QA",normalSharePct:19,currentSharePct:3,changePct:-85,status:"collapsed",reason:"QatarEnergy halted urea/LNG production Mar 3 2026 after missile strike. World's largest urea plant offline. No bypass — only Hormuz exit."},
    {region:"Oman",flag:"OM",normalSharePct:14,currentSharePct:10,changePct:-30,status:"reduced",reason:"Arabian Sea access — not Hormuz-dependent. War-risk insurance (+400%) deters shippers. Partial resumption underway.",bypassRoute:"Direct Arabian Sea — partial shipping resumed"},
    {region:"Egypt",flag:"EG",normalSharePct:12,currentSharePct:14,changePct:+18,status:"surged",reason:"Med-facing plants (EFC, MOPCO) fully operational. AU actively redirecting procurement. +18% YoY."},
    {region:"Malaysia",flag:"MY",normalSharePct:5,currentSharePct:28,changePct:+2122,status:"surged",reason:"Petronas-linked plants ramping. ABS confirms +2122% YoY. Short 6-day transit time to AU."},
    {region:"Indonesia",flag:"ID",normalSharePct:10,currentSharePct:31,changePct:+7279,status:"surged",reason:"Gov-to-gov AU-Indonesia deal: 250,000t initial, expanding 500,000t (~A$430M). PT Pupuk Kaltim first shipment 47,250t departed May 2026."},
  ],
  "dap-map":[
    {region:"Saudi Arabia (Ma'aden)",flag:"SA",normalSharePct:34,currentSharePct:2,changePct:-94,status:"collapsed",reason:"Ma'aden MWSPC phosphate complex output cut ~80% due to ammonia feedstock shortfall."},
    {region:"Morocco (OCP)",flag:"MA",normalSharePct:25,currentSharePct:44,changePct:+98,status:"surged",reason:"World's largest phosphate miner, Atlantic-facing, fully unaffected by Hormuz. OCP-Fertiliser Australia agreement active. +98% YoY."},
    {region:"China",flag:"CN",normalSharePct:18,currentSharePct:7,changePct:-58,status:"reduced",reason:"China 2025-26 DAP/MAP export quota ~2Mt vs historic 6Mt. Policy restriction, not Hormuz-related."},
    {region:"Russia",flag:"RU",normalSharePct:10,currentSharePct:10,changePct:0,status:"stable",reason:"Baltic/Black Sea routing unaffected. PhosAgro exports stable under existing AU contracts."},
  ],
  potash:[
    {region:"Canada (Nutrien/Mosaic)",flag:"CA",normalSharePct:50,currentSharePct:58,changePct:+16,status:"surged",reason:"Saskatchewan mines fully operational. Pacific routing via Vancouver/Prince Rupert unaffected. AU increasing share as primary security-of-supply source."},
    {region:"Russia (Uralkali)",flag:"RU",normalSharePct:22,currentSharePct:18,changePct:-15,status:"reduced",reason:"Ukraine drone strikes on Russian rail/logistics causing ~15% volume disruption at Baltic export terminals."},
    {region:"Belarus",flag:"BY",normalSharePct:15,currentSharePct:10,changePct:-30,status:"reduced",reason:"Belaruskali sanctioned by EU/US. AU imports via Singapore intermediaries. +2-3 weeks transit, 15-20% cost premium."},
    {region:"Germany (K+S)",flag:"DE",normalSharePct:13,currentSharePct:14,changePct:+8,status:"stable",reason:"K+S Werra/Weser mines unaffected. European supply stable. AU marginally increasing share as Belarus/Russia volumes decline."},
  ],
  diesel:[
    {region:"South Korea",flag:"KR",normalSharePct:30,currentSharePct:38,changePct:+29,status:"surged",reason:"SK Energy, GS Caltex, S-Oil at maximum utilisation. Crude shifted from ME to US/Russian/West African grades."},
    {region:"Singapore",flag:"SG",normalSharePct:23,currentSharePct:20,changePct:-10,status:"reduced",reason:"ExxonMobil/Shell refineries constrained by reduced ME crude feedstock. Throughput down ~10%."},
    {region:"Malaysia (Petronas)",flag:"MY",normalSharePct:14,currentSharePct:24,changePct:+56,status:"surged",reason:"Petronas Melaka and RAPID (Pengerang) redirecting output to AU. ABS confirms +56% YoY."},
    {region:"Iraq",flag:"IQ",normalSharePct:5,currentSharePct:0.5,changePct:-89,status:"collapsed",reason:"Iraq exports collapsed 89% (93M → 10M bbl/mo Apr 2026). Only Kirkuk-Ceyhan pipeline operational."},
    {region:"Gulf States (UAE/Kuwait)",flag:"AE",normalSharePct:8,currentSharePct:0.2,changePct:-97,status:"collapsed",reason:"Kuwait exported zero crude Apr 2026 (first since 1991). UAE ADNOC severely curtailed. All Hormuz-dependent."},
    {region:"India",flag:"IN",normalSharePct:7,currentSharePct:11,changePct:+56,status:"surged",reason:"Reliance Jamnagar importing Russian ESPO crude at discount, re-exporting diesel to AU. +56% YoY."},
  ],
  petrol:[
    {region:"South Korea",flag:"KR",normalSharePct:45,currentSharePct:50,changePct:+11,status:"surged",reason:"Korean refineries dominant and increasing share. Gasoline-heavy output well-suited to AU demand."},
    {region:"Singapore",flag:"SG",normalSharePct:34,currentSharePct:28,changePct:-18,status:"reduced",reason:"Refinery throughput constrained by ME crude reduction. Losing share to Korean and Indian producers."},
    {region:"Japan",flag:"JP",normalSharePct:9,currentSharePct:7,changePct:-20,status:"reduced",reason:"Japan prioritising domestic fuel security. Cutting AU export volumes."},
    {region:"India",flag:"IN",normalSharePct:7,currentSharePct:12,changePct:+67,status:"surged",reason:"Reliance Jamnagar running >95% utilisation. Russian crude arbitrage. +67% YoY to AU."},
  ],
  "jet-fuel":[
    {region:"Singapore",flag:"SG",normalSharePct:26,currentSharePct:20,changePct:-22,status:"reduced",reason:"Avtur production constrained by feedstock reduction. Volume down ~22%."},
    {region:"Malaysia",flag:"MY",normalSharePct:20,currentSharePct:30,changePct:+50,status:"surged",reason:"Petronas RAPID Pengerang jet fuel output increased. Key AU aviation supplier. +50% YoY."},
    {region:"South Korea",flag:"KR",normalSharePct:18,currentSharePct:24,changePct:+33,status:"surged",reason:"GS Caltex and SK Geocentric increasing Avtur output for AU/Asian aviation. +33% YoY."},
    {region:"Middle East (UAE/Qatar)",flag:"AE",normalSharePct:15,currentSharePct:0.5,changePct:-97,status:"collapsed",reason:"UAE/Qatar aviation fuel near-zero — all Hormuz-dependent. Qatar LNG feedstock halted."},
    {region:"Japan",flag:"JP",normalSharePct:10,currentSharePct:8,changePct:-18,status:"reduced",reason:"Japan prioritising domestic aviation. Modest reduction in AU exports."},
  ],
};

const STATUS_COLOR:Record<RegionRow["status"],string>={collapsed:"#e05260",reduced:"#f5a623",stable:"#94a3b8",surged:"#22c55e"};
const STATUS_STYLE:Record<RegionRow["status"],string>={collapsed:"bg-red-950/60 border-red-700/60",reduced:"bg-amber-950/40 border-amber-700/40",stable:"bg-slate-800/40 border-slate-700/40",surged:"bg-emerald-950/30 border-emerald-700/30"};
const STATUS_LABEL:Record<RegionRow["status"],string>={collapsed:"COLLAPSED",reduced:"REDUCED",stable:"STABLE",surged:"SURGED"};
const FLAGS:Record<string,string>={SA:"🇸🇦",QA:"🇶🇦",OM:"🇴🇲",EG:"🇪🇬",MY:"🇲🇾",ID:"🇮🇩",MA:"🇲🇦",CN:"🇨🇳",RU:"🇷🇺",CA:"🇨🇦",BY:"🇧🇾",DE:"🇩🇪",KR:"🇰🇷",SG:"🇸🇬",IQ:"🇮🇶",AE:"🇦🇪",IN:"🇮🇳",JP:"🇯🇵"};

// ─── CRISIS TIMELINE ──────────────────────────────────────────────────────────
const CRISIS_TIMELINE = [
  {date:"Jul 8, 2026",label:"MOU Collapsed — US Strikes Iran, Iran Hits Bahrain & Kuwait",severity:"critical_alert",desc:"Trump declared the US-Iran ceasefire over on July 8–9 after Iran struck three vessels on July 7 and the US cancelled Iran's oil waiver — a core MOU pillar. US airstrikes inside Iran followed; Iran retaliated against US bases in Bahrain and Kuwait — the first Arab Gulf state involvement. Hormuz traffic slowing sharply again. Sources: ABC News, YouTube/PoliticsGuru.",},
  {date:"Jun 25, 2026",label:"First MOU Breach — Iran Strikes Shipping, Arab Gulf States Targeted",severity:"critical",desc:"Iran struck shipping June 25–26, the first serious MOU breach. The US retaliated militarily. Iran then targeted Bahrain and Kuwait — first time Arab Gulf states were directly struck. Arab capitals recalibrate as Iran warned MOU would collapse during Israel-Lebanon talks."},
  {date:"Jun 17, 2026",label:"US-Iran MOU Signed — Hormuz Reopened Under 60-Day Framework",severity:"critical",desc:"US and Iran signed a 14-point MOU June 17–18, a 60-day ceasefire framework. The Strait partially reopened June 18–19 with 25 vessels crossing including 4 Saudi supertankers (~8 million barrels). ~550 ships backlogged; 80 mines required clearing from the central Hormuz lane."},
  {date:"Jun 21, 2026",label:"US Treasury Bond Sell-Off — AU Super Funds at Risk",severity:"critical_alert",desc:"Australian superannuation funds hold approximately $870 billion in US market exposure — the overwhelming majority of it unhedged — meaning that as foreign governments including China, Japan and Saudi Arabia collectively offloaded $138 billion in US Treasury bonds in March 2026 alone, the retirement savings of millions of Australians fell in value in direct proportion. With the 30-year US Treasury yield now at a 19-year high of 5.2%, this is not a distant financial risk: it is an active wealth shock to the nest eggs that working Australians cannot afford to lose. Read the full 13-page briefing document for worldwide context.",pdfUrl:"/US-Treasury-Bond-Crisis-Global-Fuel-Shock-2026.pdf"},
  {date:"Feb 28, 2026",label:"Op. Epic Fury",severity:"critical",desc:"US and Israel launch Operation Epic Fury. Strait of Hormuz effectively closed to commercial tanker traffic. Gulf oil exports drop 60–71% by mid-March 2026."},
  {date:"Mar 3, 2026",label:"QatarEnergy halts",severity:"critical",desc:"Missile strike on Qatar LNG facilities. QatarEnergy halts urea, methanol, LNG and polymer production. World's largest urea plant offline. Qatar AU exports: −85%."},
  {date:"Mar 2026",label:"Brent crude +65%",severity:"critical",desc:"Brent crude surges 65% by end of March — largest monthly oil price increase ever recorded. Saudi Aramco Safaniya offshore field shut down (−20% Saudi output)."},
  {date:"Apr 2026",label:"Iraq −89%, Kuwait zero",severity:"critical",desc:"Iraq oil exports collapse 89% (93M → 10M bbl/mo). Kuwait exports zero crude — first full-month halt since 1991 Gulf War. UAE ADNOC severely curtailed."},
  {date:"Apr 2026",label:"AU reserves critical",severity:"critical",desc:"AU confirms: diesel 42 days, petrol 48 days, jet fuel 36 days (all below IEA 90-day minimum). 50 emergency tankers dispatched. Saudi urea collapse −99.6% confirmed by ABS."},
  {date:"Apr–May 2026",label:"Emergency procurement",severity:"warning",desc:"AU-Indonesia gov-to-gov: 250,000t urea, expanding 500,000t (~A$430M). OCP Morocco phosphate deal. ABS confirms Malaysia urea +2122% YoY, Indonesia +7279% YoY as substitution kicks in."},
  {date:"Jun 1 2026",label:"Cape route standard",severity:"warning",desc:"Cape of Good Hope route becomes standard for all AU-bound tankers. Adds 28 days and ~$3M per voyage. AU at Level 2 National Fuel Security Plan. 164 petrol stations reporting outages."},
  {date:"Jun 5–9 2026",label:"US blockade peak",severity:"critical",desc:"US blockade zeroes Iran oil exports — zero Iranian crude shipped in June (Tanker Trackers). Brent crude peaks ~$108/bbl. Only 3 avg tanker transits/day (Clarksons). Cushing, Oklahoma stockpiles fall to near 'tank bottom' levels — below 20M bbl, lowest since October 2014. US SPR hits 43-year low at 340.3M bbl (down from 415M pre-conflict). IEA warns commercial inventories may reach critically low levels before peak summer demand."},
  {date:"Jun 12–15 2026",label:"Brookings warns: July 9 cliff",severity:"critical",desc:"Economists Robin Brooks & Ben Harris (Brookings Institution) publish analysis warning global emergency stockpile releases will be 'largely exhausted by July 9.' EIA confirms OECD oil inventories at lowest level since 2003. NYT reports US reserves on track for lowest since 1983 (Jun 12). Global oil market approaching a full supply crisis — not a temporary price shock."},
  {date:"Jun 15 2026",label:"US-Iran MOU framework announced",severity:"warning",desc:"Trump posts on Truth Social: 'The Deal with the Islamic Republic of Iran is now complete. I hereby fully authorize the toll-free opening of the Strait of Hormuz.' 14-point MOU framework includes: immediate halt to hostilities on ALL fronts including Lebanon; Hormuz toll-free for 60 days; US lifts naval blockade; Iran commits to restore pre-war traffic within 30 days; $300B reconstruction fund; US issues immediate oil sanctions waivers. Brent falls ~4% to ~$83/bbl. ~550 ships backlogged in Gulf."},
  {date:"Jun 17 2026",label:"Trump G7 Admission — '4 weeks from bedlam'",severity:"critical",desc:"Speaking at the G7 summit in Évian-les-Bains, France, President Trump makes one of the most consequential energy disclosures by a sitting US president: 'We run out of reserves at about four weeks. You know, there are reserves all over the world, and we would really run out, and there'll be a time when you wouldn't be able to get it. And you want to see bedlam?' (Reuters, Jun 17). Trump added that continued bombing would mean 'those ships won't be going — you're talking about $500, $600, $700 million a day.' Former US Energy Secretary Brouillette confirmed oil executives had privately briefed the White House that Cushing inventories were approaching the point where 'extraction becomes impossible.' The admission confirmed Iran's Hormuz closure had effectively forced Trump's hand — a war he started ended on Iran's terms to avoid global economic collapse. IEA confirmed OECD strategic reserves at their lowest since December 1990. Global oil supply shortfall since Feb 28: 1.15 billion barrels (Kpler, CNN Jun 19)."},
  {date:"Jun 18–19 2026",label:"MOU signed — Lebanon ceasefire + Hormuz reopening",severity:"warning",desc:"Trump signs MOU with Iranian President Pezeshkian at G7 post-dinner, Palace of Versailles (BBC). The 14-point agreement is historic in scope: Point 1 calls for 'immediate and permanent termination of military operations on ALL fronts, including Lebanon' — ending Israeli occupation of ~one-fifth of Lebanese territory and halting Hezbollah hostilities simultaneously (Al Jazeera). Lebanon significance: a US-Iran deal without Lebanon risked Israel reigniting conflict and unravelling Hormuz access. Lebanon's inclusion was Iran's key condition for signing. Point 4: US lifts naval blockade. Point 5: Iran clears mines and restores traffic within 30 days. Point 6: $300B reconstruction fund for Iran. Point 10: Immediate US oil sanctions waivers for Iranian crude, banking, transport, insurance. CENTCOM formally lifts blockade Jun 19. 25 commercial vessels transit Jun 19 — including 4 Saudi supertankers carrying 8M bbl crude — highest traffic since Jun 2. ~80 mines still blocking central Hormuz lane. 60-day toll-free window expires ~Aug 17. Iran's parliamentary speaker signals fees after window closes — potential confrontation point."},
  {date:"Jun 19–20 2026",label:"Israel's largest Lebanon bombing — MOU at risk",severity:"critical",desc:"Within hours of the MOU signing, Israel launched one of its largest bombing campaigns of the war on southern Lebanon, killing at least 47 people and wounding 100+ in the Nabatieh district overnight — described by Lebanon's state news agency as among the most intense strikes of the entire conflict. The IDF targeted 80 sites in response to Hezbollah drone attacks that killed four Israeli soldiers including a senior officer. Israel's Foreign Ministry stated Hezbollah had continued firing 'missiles, drones and rockets in violation of the ceasefire,' while Hezbollah's secretary general declared: 'The project to eliminate Hezbollah has failed.' The MOU's Point 1 explicitly required 'immediate and permanent termination of military operations on all fronts, including Lebanon' — Iran's Foreign Minister Abbas Araghchi had warned days earlier that continued Israeli attacks in Lebanon 'would constitute a violation of the MOU' and that 'none of the deal's provisions would be realised' if strikes continued (Washington Times, Jun 16). By Friday afternoon, US and Qatar-brokered talks produced a fresh Israel-Hezbollah ceasefire effective 4pm local time — but Israeli strikes resumed the same night, killing at least 5 more by Saturday morning (US News, Jun 20). The Jerusalem Post (Jun 20) reported Israel will maintain a 'forward defense zone' in southern Lebanon, occupying several square miles it calls a 'security zone.' The episode exposed the MOU's central fragility: Israel — not a party to the US-Iran agreement — retains the power to reignite Lebanon and destabilise Hormuz reopening. Trump publicly told Netanyahu 'you just gotta calm down' (The Guardian, Jun 19)."},
  {date:"Jun 20 2026",label:"AU reserves improving",severity:"warning",desc:"AU diesel 39 days (+7d from May), petrol 44 days (+2d), jet fuel 32 days (WARNING). 53 tankers due in June carrying 3.7B litres. Fuel excise 50% cut expires Jun 30 — PM decision pending (+26c/L impact if lapses)."},
  {date:"Jun–Jul 2026",label:"Budget 2026-27",severity:"warning",desc:"$3.2B Australian Fuel Security Reserve announced targeting 50 days diesel+jet. MSO expanded +10 days. IEA warns product inventories may reach critical levels Jul–Aug 2026."},
  {date:"Jul–Aug 2026",label:"IEA Critical Warning",severity:"critical",desc:"IEA projects product inventories (especially jet fuel) may hit critically low levels. Government has prepared National Fuel Emergency declaration trigger points."},
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function buildDemandSeries(id:string):Record<string,number> {
  const base=ANNUAL_DEMAND_BASE[id]??0;
  const seasonal=id==="diesel"?DIESEL_SEASONAL:(id==="petrol"||id==="jet-fuel")?PETROL_SEASONAL:FERT_SEASONAL;
  const pf=HORMUZ_PRICE_FACTOR[id]??{};
  const result:Record<string,number>={};
  for(let y=2024;y<=2026;y++) for(let m=1;m<=12;m++){
    const p=`${y}-${String(m).padStart(2,"0")}`;
    if(p>"2026-09") break;
    const mi=parseInt(p.split("-")[1],10)-1;
    const monthlyBase=(base/12)*seasonal[mi];
    const applicable=Object.entries(pf).filter(([k])=>k<=p).map(([,v])=>v);
    result[p]=Math.round(monthlyBase*(applicable.length>0?Math.max(...applicable):1));
  }
  return result;
}

function relTime(iso:string):string {
  if(!iso)return"—";
  const m=Math.floor((Date.now()-new Date(iso).getTime())/60000);
  if(m<2)return"just now";
  if(m<60)return`${m}m ago`;
  const h=Math.floor(m/60);
  if(h<24)return`${h}h ago`;
  return`${Math.floor(h/24)}d ago`;
}

function pctBadge(val:number){
  if(val>5) return<span className="text-xs px-1.5 py-0.5 rounded font-mono bg-emerald-900/60 text-emerald-300">+{val.toFixed(1)}%</span>;
  if(val<-5)return<span className="text-xs px-1.5 py-0.5 rounded font-mono bg-red-900/60 text-red-300">{val.toFixed(1)}%</span>;
  return      <span className="text-xs px-1.5 py-0.5 rounded font-mono bg-slate-700/60 text-slate-300">{val>0?"+":""}{val.toFixed(1)}%</span>;
}

// ─── FULL HISTORY CHART (2024–2026 + projection) ──────────────────────────────
function FullHistoryChart({monthlyData,demandSeries,domesticPct,commodityId}:{
  monthlyData:MonthlyDataPoint[];demandSeries:Record<string,number>;domesticPct:number;commodityId:string;
}) {
  const pvr=PROJECTED_VS_RECEIVED[commodityId];
  if(!monthlyData.length&&!pvr) return<div className="h-52 flex items-center justify-center text-slate-500 text-sm">No data</div>;

  // Build comprehensive 2024-2026 dataset from live ABS data
  const liveByMonth=new Map(monthlyData.map(d=>[d.month,d.actual]));

  // Generate all months 2024-01 through 2026-09
  const allMonths:string[]=[];
  for(let y=2024;y<=2026;y++) for(let m=1;m<=12;m++){
    const p=`${y}-${String(m).padStart(2,"0")}`;
    if(p>"2026-09") break;
    allMonths.push(p);
  }

  const chartData=allMonths.map(month=>{
    const live=liveByMonth.get(month);
    const pvrEntry=pvr?.find(p=>p.month===month);
    const demand=demandSeries[month]??0;
    const domestic=Math.round(demand*(domesticPct/100));
    const isProjection=pvrEntry?.isProjection||(!live&&month>"2026-04");
    const supply=live??pvrEntry?.received??null;
    const projected=pvrEntry?.projected??null;
    const isHormuz=month>="2026-03";
    return{
      label:periodToLabel(month),
      month,
      supply:supply!==null?Math.round(supply):null,
      projected,
      demand,
      domestic:supply!==null?domestic:null,
      isProjection,
      isHormuz,
    };
  }).filter(d=>d.supply!==null||d.projected!==null);

  const tickFmt=(v:number)=>v>=1_000_000?`$${(v/1_000_000).toFixed(1)}B`:v>=1_000?`$${(v/1_000).toFixed(0)}M`:`$${v}K`;
  const HORMUZ_LABEL=chartData.find(d=>d.isHormuz)?.label;

  return(
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <div className="flex items-center gap-1.5 text-xs text-slate-400"><div className="w-3 h-3 rounded-sm" style={{background:C.supply+"99"}}/>Actual receipts (ABS live)</div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400"><div className="w-3 h-0.5" style={{background:C.projected}}/>Pre-crisis projection</div>
        <div className="flex items-center gap-1.5 text-xs text-slate-400"><div className="w-3 h-0.5" style={{background:C.demand}}/>Est. national demand</div>
        <div className="flex items-center gap-1.5 text-xs text-amber-400/70"><div className="w-3 h-3 rounded-sm opacity-40" style={{background:C.nextMonth}}/>Sep 26 projection</div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{top:4,right:8,bottom:0,left:0}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false}/>
          <XAxis dataKey="label" tick={{fontSize:8,fill:"#64748b"}} axisLine={false} tickLine={false}
            interval={Math.max(0,Math.floor(chartData.length/8)-1)}/>
          <YAxis tickFormatter={tickFmt} tick={{fontSize:9,fill:"#64748b"}} axisLine={false} tickLine={false} width={56}/>
          <Tooltip content={({active,payload,label:lbl}:any)=>{
            if(!active||!payload?.length)return null;
            const supply=payload.find((p:any)=>p.dataKey==="supply")?.value;
            const proj=payload.find((p:any)=>p.dataKey==="projected")?.value;
            const demand=payload.find((p:any)=>p.dataKey==="demand")?.value??0;
            const gap=supply!=null&&demand>0?((supply-demand)/demand*100):null;
            const isProj=chartData.find(d=>d.label===lbl)?.isProjection;
            return(
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs shadow-xl min-w-[180px]">
                <div className="font-semibold text-slate-200 mb-2">{lbl}{isProj&&<span className="ml-1.5 text-amber-400 text-[9px]">PROJECTION</span>}</div>
                {supply!=null&&<div className="flex justify-between gap-3"><span className="text-slate-400">Received</span><span className="font-mono" style={{color:C.supply}}>{fmtAud(supply)}</span></div>}
                {proj!=null&&<div className="flex justify-between gap-3"><span className="text-slate-400">Projected</span><span className="font-mono" style={{color:C.projected}}>{fmtAud(proj)}</span></div>}
                {demand>0&&<div className="flex justify-between gap-3 mt-1 pt-1 border-t border-slate-700"><span className="text-slate-400">Demand est.</span><span className="font-mono" style={{color:C.demand}}>{fmtAud(demand)}</span></div>}
                {gap!==null&&<div className={`flex justify-between gap-3 font-semibold ${gap<-15?"text-red-400":gap<0?"text-amber-400":"text-emerald-400"}`}><span>Gap</span><span>{gap>=0?"+":""}{gap.toFixed(1)}%</span></div>}
              </div>
            );
          }}/>
          {HORMUZ_LABEL&&<ReferenceLine x={HORMUZ_LABEL} stroke={C.gap} strokeDasharray="4 2" strokeWidth={1.5}
            label={{value:"Hormuz",position:"insideTopRight",fontSize:8,fill:C.gap}}/>}
          {/* 2024 shading */}
          <ReferenceLine x="Jan 2024" stroke="transparent"/>
          <Bar dataKey="supply" isAnimationActive={false} maxBarSize={14} name="Received">
            {chartData.map((d,i)=>{
              const yr=parseInt(d.month.split("-")[0]);
              const color=d.isProjection?C.nextMonth:d.isHormuz?
                (d.supply!=null&&d.projected!=null&&d.supply<d.projected*0.7?C.gap:d.supply!=null&&d.projected!=null&&d.supply<d.projected*0.9?"#b45309":C.supply)
                :(yr===2024?C.history24:C.supply);
              return<Cell key={i} fill={color} fillOpacity={d.isProjection?0.5:0.85}/>;
            })}
          </Bar>
          <Line dataKey="projected" stroke={C.projected} strokeWidth={1.5} strokeDasharray="5 2" dot={false}
            isAnimationActive={false} connectNulls/>
          <Line dataKey="demand" stroke={C.demand} strokeWidth={1.5} strokeDasharray="3 3" dot={false}
            isAnimationActive={false} connectNulls/>
        </ComposedChart>
      </ResponsiveContainer>
      {/* Year bands legend */}
      <div className="flex flex-wrap gap-3 mt-1 text-[9px] text-slate-500">
        <span>■ <span style={{color:C.history24}}>2024 baseline</span></span>
        <span>■ <span style={{color:C.supply}}>2025–2026 actual</span></span>
        <span>■ <span style={{color:C.gap}}>Post-Hormuz shortfall</span></span>
        <span>■ <span style={{color:C.nextMonth}}>Sep 2026 projection</span></span>
        <span className="ml-auto text-slate-600">Source: ABS MERCH_IMP — auto-updated daily</span>
      </div>
    </div>
  );
}

// ─── PROJECTED vs RECEIVED CHART ──────────────────────────────────────────────
function PVRTooltip({active,payload,label}:any){
  if(!active||!payload?.length)return null;
  const proj=payload.find((p:any)=>p.dataKey==="projected")?.value??0;
  const recv=payload.find((p:any)=>p.dataKey==="received")?.value??0;
  const gap=proj>0?((recv-proj)/proj*100):0;
  return(
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs shadow-xl min-w-[200px]">
      <div className="font-semibold text-slate-200 mb-2">{label}</div>
      <div className="space-y-1">
        <div className="flex justify-between gap-4"><span className="text-slate-400">Projected</span><span className="font-mono text-teal-300">{fmtAud(proj)}</span></div>
        <div className="flex justify-between gap-4"><span className="text-slate-400">Received</span><span className="font-mono" style={{color:recv<proj?C.gap:C.domestic}}>{fmtAud(recv)}</span></div>
        <div className={`flex justify-between gap-4 font-semibold border-t border-slate-700 pt-1 ${gap<-30?"text-red-400":gap<0?"text-amber-400":"text-emerald-400"}`}>
          <span>Gap</span><span className="font-mono">{gap>=0?"+":""}{gap.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── RESERVE DECLINE CHART ────────────────────────────────────────────────────
function ReserveDeclineChart({id}:{id:string}){
  const r=RESERVE_DAYS[id];
  if(!r||!r.trendDays.length)return null;
  const chartData=r.trendMonths.map((lbl,i)=>({label:lbl,days:r.trendDays[i]}));
  return(
    <ResponsiveContainer width="100%" height={80}>
      <AreaChart data={chartData} margin={{top:4,right:4,bottom:0,left:0}}>
        <defs><linearGradient id={`rg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={C.reserve} stopOpacity={0.4}/>
          <stop offset="95%" stopColor={C.reserve} stopOpacity={0.05}/>
        </linearGradient></defs>
        <CartesianGrid strokeDasharray="2 4" stroke="#1e293b" vertical={false}/>
        <XAxis dataKey="label" tick={{fontSize:7,fill:"#64748b"}} axisLine={false} tickLine={false}/>
        <YAxis tick={{fontSize:8,fill:"#64748b"}} axisLine={false} tickLine={false} width={26} domain={[0,100]}/>
        <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="3 2" strokeWidth={1} label={{value:"IEA 90d",position:"insideTopRight",fontSize:7,fill:"#22c55e"}}/>
        <ReferenceLine y={30} stroke={C.gap} strokeDasharray="3 2" strokeWidth={1} label={{value:"Critical",position:"insideTopRight",fontSize:7,fill:C.gap}}/>
        <Area dataKey="days" stroke={C.reserve} fill={`url(#rg-${id})`} strokeWidth={2} isAnimationActive={false}/>
        <Tooltip content={({active,payload,label:lbl}:any)=>{
          if(!active||!payload?.length)return null;
          return<div className="bg-slate-900 border border-slate-700 rounded p-2 text-xs"><span style={{color:C.reserve}}>{payload[0]?.value} days cover</span> — {lbl}</div>;
        }}/>
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── SUPPLY CHAIN (REFINERY) PANEL ────────────────────────────────────────────
function SupplyChainPanel({id}:{id:string}){
  const refineries=REFINERY_DATA[id];
  if(!refineries?.length)return null;
  const [expanded,setExpanded]=useState<number|null>(null);
  return(
    <div className="space-y-2">
      {refineries.map((r,i)=>{
        const sc=STATUS_COLOR[r.status];
        const ss=STATUS_STYLE[r.status];
        const isOpen=expanded===i;
        const shareChange=r.auSharePostPct-r.auSharePct;
        return(
          <div key={i} className={`rounded-lg border ${ss} overflow-hidden`}>
            <div className="flex items-start gap-3 p-3 cursor-pointer select-none" onClick={()=>setExpanded(isOpen?null:i)}>
              <div className="text-xl flex-shrink-0 mt-0.5">{FLAGS[r.flag]??"🌐"}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-xs font-semibold text-slate-100">{r.facility}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider border" style={{color:sc,borderColor:sc+"60",background:sc+"18"}}>{STATUS_LABEL[r.status]}</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-[10px] text-slate-400">{r.country} · {r.operator}</span>
                  <span className="text-[10px] font-mono text-slate-500">{r.capacity}</span>
                </div>
                {/* Share bars */}
                <div className="flex items-center gap-3 mt-1.5">
                  <div className="flex-1 flex items-center gap-1.5">
                    <span className="text-[9px] text-slate-500 w-10 flex-shrink-0">Pre:</span>
                    <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full"><div className="h-full rounded-full bg-slate-500/50" style={{width:`${Math.min(r.auSharePct,60)}%`}}/></div>
                    <span className="text-[9px] text-slate-400 w-8 text-right">{r.auSharePct}%</span>
                  </div>
                  <div className="flex-1 flex items-center gap-1.5">
                    <span className="text-[9px] text-slate-500 w-10 flex-shrink-0">Post:</span>
                    <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full"><div className="h-full rounded-full" style={{width:`${Math.min(r.auSharePostPct,60)}%`,background:sc}}/></div>
                    <span className="text-[9px] font-semibold w-8 text-right" style={{color:sc}}>{r.auSharePostPct}%</span>
                  </div>
                  <span className={`text-xs font-mono px-1 py-0.5 rounded flex-shrink-0 ${shareChange>0?"bg-emerald-900/60 text-emerald-300":"bg-red-900/60 text-red-300"}`}>
                    {shareChange>0?"+":""}{shareChange.toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                {r.transitDays>0&&(
                  <div className="text-right hidden sm:block">
                    <div className="text-[9px] text-slate-500">Transit</div>
                    <div className="text-xs font-mono text-slate-300">{r.transitDays}d</div>
                  </div>
                )}
                {isOpen?<ChevronUp className="w-3.5 h-3.5 text-slate-500"/>:<ChevronDown className="w-3.5 h-3.5 text-slate-500"/>}
              </div>
            </div>
            {isOpen&&(
              <div className="px-3 pb-3 border-t border-slate-800/40 mt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                  <div>
                    <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Production Status</div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">{r.productionNote}</p>
                  </div>
                  <div>
                    <div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Ship className="w-3 h-3"/>Shipping Route to AU</div>
                    <p className="text-[10px] text-slate-400 leading-relaxed">{r.shippingRoute}</p>
                    {r.transitDays>0?<p className="text-[10px] text-teal-500 mt-1">Transit: {r.transitDays} days to AU ports</p>:<p className="text-[10px] text-red-500 mt-1">Route BLOCKED — Hormuz closure</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── REGION ORIGINS PANEL ─────────────────────────────────────────────────────
function RegionOriginsPanel({id}:{id:string}){
  const regions=REGION_DATA[id];
  if(!regions?.length)return null;
  const [expanded,setExpanded]=useState(false);
  const shown=expanded?regions:regions.slice(0,4);
  return(
    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/40">
      <div className="flex items-center gap-2 mb-3">
        <MapPin className="w-3.5 h-3.5 text-slate-400"/>
        <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Origin Regions — Supply Change & Reason</span>
      </div>
      <div className="space-y-2">
        {shown.map((r,i)=>{
          const flag=FLAGS[r.flag]??"🌐";
          const sc=STATUS_COLOR[r.status];
          const ss=STATUS_STYLE[r.status];
          return(
            <div key={i} className={`rounded-lg border p-2.5 ${ss}`}>
              <div className="flex items-start gap-2">
                <span className="text-lg leading-none flex-shrink-0 mt-0.5">{flag}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold text-slate-200">{r.region}</span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase border" style={{color:sc,borderColor:sc+"60",background:sc+"18"}}>{STATUS_LABEL[r.status]}</span>
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded flex items-center gap-0.5 ${r.changePct>0?"bg-emerald-900/60 text-emerald-300":"bg-red-900/60 text-red-300"}`}>
                      {r.changePct>0?<TrendingUp className="w-3 h-3"/>:<TrendingDown className="w-3 h-3"/>}
                      {r.changePct>0?"+":""}{r.changePct.toFixed(0)}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1.5 bg-slate-700/60 rounded-full"><div className="h-full rounded-full opacity-30" style={{width:`${r.normalSharePct}%`,background:"#94a3b8"}}/></div>
                    <span className="text-[9px] text-slate-500 w-14 flex-shrink-0 text-right">was {r.normalSharePct}%</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex-1 h-1.5 bg-slate-700/60 rounded-full"><div className="h-full rounded-full" style={{width:`${Math.min(r.currentSharePct,60)}%`,background:sc}}/></div>
                    <span className="text-[9px] font-semibold w-14 flex-shrink-0 text-right" style={{color:sc}}>now {r.currentSharePct}%</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{r.reason}</p>
                  {r.bypassRoute&&<div className="mt-1 text-[10px] text-teal-500">↪ Bypass: {r.bypassRoute}</div>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {regions.length>4&&(
        <button onClick={()=>setExpanded(e=>!e)} className="mt-2 text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
          {expanded?<><ChevronUp className="w-3 h-3"/>Show less</>:<><ChevronDown className="w-3 h-3"/>Show {regions.length-4} more regions</>}
        </button>
      )}
    </div>
  );
}

// ─── RESERVE GAUGE ────────────────────────────────────────────────────────────
function ReserveGauge({id}:{id:string}){
  const r=RESERVE_DAYS[id];
  if(!r)return null;
  const pctOfIEA=r.ieaTarget>0?Math.min(100,(r.current/r.ieaTarget)*100):0;
  const color=r.current===0?"#475569":r.current<30?C.gap:r.current<60?C.warning:C.domestic;
  return(
    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/40">
      <div className="flex items-center gap-2 mb-2"><Database className="w-3.5 h-3.5 text-slate-400"/><span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Strategic Reserve</span></div>
      <div className="flex items-end gap-3 mb-2">
        <div>
          <div className="text-2xl font-bold font-mono" style={{color}}>{r.label}</div>
          {r.ieaTarget>0&&<div className="text-xs text-slate-500">IEA target: {r.ieaTarget} days</div>}
        </div>
        {r.ieaTarget>0&&(
          <div className="flex-1 mb-2">
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{width:`${pctOfIEA}%`,background:color}}/></div>
            <div className="text-xs text-slate-500 mt-0.5">{pctOfIEA.toFixed(0)}% of IEA standard</div>
          </div>
        )}
      </div>
      {r.current>0&&<ReserveDeclineChart id={id}/>}
      <div className="text-xs text-slate-400 leading-relaxed mt-2">{r.note}</div>
    </div>
  );
}

// ─── DOMESTIC PANEL ───────────────────────────────────────────────────────────
function DomesticPanel({id}:{id:string}){
  const dpct=DOMESTIC_PCT[id]??0;
  const details:Record<string,{facilities:string[];notes:string}>={
    urea:{facilities:["No active domestic production"],notes:"Incitec Pivot Gibson Island (QLD) closed Aug 2022. 100% import dependent. $6.4B Dyno Nobel NT plant announced Jan 2026 — earliest 2030."},
    "dap-map":{facilities:["Incitec Pivot Phosphate Hill (QLD) — ~100,000 t/yr"],notes:"Covers ~5% of demand. EFA finance for emergency imports from Morocco and Russia."},
    potash:{facilities:["No active domestic production"],notes:"No commercial potash mining despite significant WA in-ground resources. Agrimin and Danakali projects years from production."},
    diesel:{facilities:["Ampol Lytton Refinery, Brisbane QLD","Viva Energy Geelong Refinery, VIC"],notes:"Combined ~12BL/yr = ~20% of demand. Both supported to 2030. Diesel-heavy demand vs gasoline-heavy output creates structural import dependency."},
    petrol:{facilities:["Ampol Lytton — primarily gasoline output","Viva Energy Geelong — petrol + aviation fuels"],notes:"~20% domestic. 7 of 9 AU refineries closed 2003–2021."},
    "jet-fuel":{facilities:["Viva Energy Geelong — Avtur production","Ampol Lytton — small portion"],notes:"Only ~8% domestic. 29 days reserve at crisis onset."},
  };
  const d=details[id]??{facilities:[],notes:""};
  return(
    <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/40">
      <div className="flex items-center gap-2 mb-2"><Factory className="w-3.5 h-3.5 text-slate-400"/><span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Domestic Production</span><span className="ml-auto text-sm font-bold font-mono" style={{color:dpct===0?C.gap:C.domestic}}>{dpct}% of demand</span></div>
      <div className="flex h-2 rounded overflow-hidden mb-2 bg-slate-700">
        <div style={{width:`${dpct}%`,background:C.domestic,minWidth:dpct>0?"2px":"0"}}/>
        <div style={{width:`${100-dpct}%`,background:C.gap+"40"}}/>
      </div>
      {d.facilities.map((f,i)=><div key={i} className="flex items-start gap-1.5 text-xs text-slate-300 mb-0.5"><span className="text-emerald-500 mt-0.5 flex-shrink-0">▸</span>{f}</div>)}
      <div className="text-xs text-slate-500 leading-relaxed mt-1.5">{d.notes}</div>
    </div>
  );
}

// ─── COMMODITY CARD ───────────────────────────────────────────────────────────
function CommodityCard({sub,allRows,expanded,onToggle}:{sub:SubcategoryData;allRows:ImportDataRow[];expanded:boolean;onToggle:()=>void}){
  const [activeView,setActiveView]=useState<"history"|"supplychain"|"origins">("history");
  const demandSeries=useMemo(()=>buildDemandSeries(sub.id),[sub.id]);
  const domesticPct=DOMESTIC_PCT[sub.id]??0;
  const anom=sub.anomaly;
  const isCrit=anom.level==="critical";
  const isWarn=anom.level==="warning";
  const pvr=PROJECTED_VS_RECEIVED[sub.id];
  const pvrLatest=pvr?pvr.filter(p=>!p.isProjection).slice(-1)[0]:null;
  const projGap=pvrLatest&&pvrLatest.projected>0?((pvrLatest.received-pvrLatest.projected)/pvrLatest.projected*100):0;
  const reserve=RESERVE_DAYS[sub.id];
  const borderCls=(isCrit||projGap<-30)?"border-red-700/70 bg-gradient-to-br from-slate-900 to-red-950/20":
    isWarn?"border-amber-700/60 bg-gradient-to-br from-slate-900 to-amber-950/20":"border-slate-700/50 bg-slate-900/60";

  return(
    <div className={`rounded-xl border ${borderCls} overflow-hidden`}>
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none" onClick={onToggle} data-testid={`card-toggle-${sub.id}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex-shrink-0">{sub.commodity==="fertilizer"?<Sprout className="w-4 h-4 text-emerald-400"/>:<Flame className="w-4 h-4 text-amber-400"/>}</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-100">{sub.name}</span>
              {(isCrit||projGap<-30)&&<Badge className="text-[10px] bg-red-900/70 text-red-300 border-red-700 py-0">SUPPLY DEFICIT</Badge>}
              {isWarn&&!isCrit&&projGap>=-30&&<Badge className="text-[10px] bg-amber-900/70 text-amber-300 border-amber-700 py-0">WARNING</Badge>}
              {reserve&&reserve.current>0&&reserve.current<35&&<Badge className="text-[10px] bg-orange-900/70 text-orange-300 border-orange-700 py-0">{reserve.current}d RESERVE</Badge>}
            </div>
            <div className="text-xs text-slate-500 truncate max-w-sm hidden sm:block">{sub.description.split(".")[0]}.</div>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400">Receipt gap</div>
            <div className="text-sm font-mono font-bold" style={{color:projGap<-30?C.gap:projGap<0?C.warning:C.domestic}}>{projGap>=0?"+":""}{projGap.toFixed(1)}%</div>
          </div>
          <div className="flex items-center gap-1">{pctBadge(anom.yoyPct)}<span className="text-slate-500 text-xs hidden sm:inline">YoY</span></div>
          {expanded?<ChevronUp className="w-4 h-4 text-slate-500"/>:<ChevronDown className="w-4 h-4 text-slate-500"/>}
        </div>
      </div>

      {expanded&&(
        <div className="px-4 pb-4 border-t border-slate-800/50">
          {/* View tabs */}
          <div className="flex gap-1 bg-slate-800/60 p-1 rounded-lg border border-slate-700/40 mt-3 mb-3 w-fit">
            {([
              {k:"history",label:"2024–2026 History + Projection"},
              {k:"supplychain",label:"Refinery Supply Chain"},
              {k:"origins",label:"Origin Regions"},
            ] as const).map(({k,label})=>(
              <button key={k} onClick={e=>{e.stopPropagation();setActiveView(k)}} data-testid={`view-${sub.id}-${k}`}
                className={`px-3 py-1 text-xs rounded font-medium transition-colors ${activeView===k?"bg-slate-700 text-slate-100":"text-slate-400 hover:text-slate-200"}`}>
                {label}
              </button>
            ))}
          </div>

          {activeView==="history"&&(
            <div className="mb-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Monthly Data: 2024 Baseline → 2025 → 2026 Crisis → Sep 2026 Projection</div>
              <div className="text-xs text-slate-500 mb-2">ABS live data auto-refreshes daily. Post-Hormuz receipts (red bars) vs pre-crisis seasonal projection (dashed line).</div>
              <FullHistoryChart monthlyData={sub.monthlyData} demandSeries={demandSeries} domesticPct={domesticPct} commodityId={sub.id}/>
            </div>
          )}

          {activeView==="supplychain"&&(
            <div className="mb-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Where It's Refined + % Shipped to Australia</div>
              <div className="text-xs text-slate-500 mb-3">Pre-crisis vs post-crisis share of AU imports, facility details, production status, and shipping routes.</div>
              <SupplyChainPanel id={sub.id}/>
            </div>
          )}

          {activeView==="origins"&&(
            <div className="mt-1"><RegionOriginsPanel id={sub.id}/></div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
            <DomesticPanel id={sub.id}/>
            <ReserveGauge id={sub.id}/>
          </div>
          <div className="mt-3 p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/40">
            <div className="text-xs font-semibold text-slate-300 mb-1">Supply Chain Risk</div>
            <div className="text-xs text-slate-400 leading-relaxed">{sub.riskNote}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ALERT STRIP (always visible) ────────────────────────────────────────────
function SectorAlertStrip(){
  const criticals=SECTOR_IMPACTS.filter(s=>s.severityLevel==="critical");
  const highs=SECTOR_IMPACTS.filter(s=>s.severityLevel==="high");
  return(
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-3 mb-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0"/>
        <span className="text-xs font-bold text-slate-200 uppercase tracking-wider">Active Impact Alerts — Who Is Affected Right Now</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {SECTOR_IMPACTS.map(s=>{
          const Icon=s.icon;
          const isCrit=s.severityLevel==="critical";
          return(
            <div key={s.id} className={`rounded-lg border p-2.5 flex items-start gap-2 ${isCrit?"bg-red-950/30 border-red-800/50":"bg-amber-950/20 border-amber-800/30"}`}>
              <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{background:s.iconColor+"18",border:`1px solid ${s.iconColor}40`}}>
                <Icon className="w-3.5 h-3.5" style={{color:s.iconColor}}/>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs font-semibold text-slate-100 leading-tight">{s.sector}</span>
                  <span className={`text-[9px] px-1 py-0.5 rounded font-bold uppercase ${isCrit?"bg-red-900/70 text-red-300":"bg-amber-900/60 text-amber-300"}`}>{isCrit?"CRITICAL":"HIGH"}</span>
                </div>
                <p className="text-[10px] text-slate-400 leading-snug">{s.alertLevel}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SECTOR IMPACT PANEL (expandable detail) ─────────────────────────────────
function SectorImpactPanel(){
  const [expanded,setExpanded]=useState<string|null>(null);
  const sevStyle:{[k:string]:{card:string;badge:string;text:string}}={
    critical:{card:"border-red-700/60 bg-gradient-to-br from-slate-900 to-red-950/20",badge:"bg-red-900/70 border-red-700",text:"text-red-300"},
    high:    {card:"border-amber-700/50 bg-gradient-to-br from-slate-900 to-amber-950/15",badge:"bg-amber-900/60 border-amber-700",text:"text-amber-300"},
    medium:  {card:"border-slate-700/50 bg-slate-900/60",badge:"bg-slate-700/60 border-slate-600",text:"text-slate-300"},
  };
  return(
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {SECTOR_IMPACTS.map(sector=>{
        const s=sevStyle[sector.severityLevel];
        const isOpen=expanded===sector.id;
        const Icon=sector.icon;
        return(
          <div key={sector.id} className={`rounded-xl border ${s.card} overflow-hidden`}>
            <div className="flex items-start gap-3 p-3 cursor-pointer select-none" onClick={()=>setExpanded(isOpen?null:sector.id)} data-testid={`sector-${sector.id}`}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{background:sector.iconColor+"18",border:`1px solid ${sector.iconColor}40`}}>
                <Icon className="w-4 h-4" style={{color:sector.iconColor}}/>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-xs font-semibold text-slate-100">{sector.sector}</span>
                  <Badge className={`text-[9px] py-0 ${s.badge} ${s.text}`}>{sector.severityLevel.toUpperCase()}</Badge>
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-2">{sector.headline}</p>
              </div>
              {isOpen?<ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0"/>:<ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0"/>}
            </div>
            {isOpen&&(
              <div className="px-3 pb-3 border-t border-slate-800/50">
                <div className="mt-2 mb-2 text-[10px] text-slate-500 italic">{sector.affectedGroups}</div>
                <div className="mt-2">
                  <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1.5 flex items-center gap-1"><ArrowDown className="w-3 h-3"/>Current Impacts</div>
                  {sector.currentImpacts.map((impact,i)=>(
                    <div key={i} className="flex items-start gap-1.5 mb-1"><div className="w-1 h-1 rounded-full bg-red-500 flex-shrink-0 mt-1.5"/><p className="text-[10px] text-slate-400 leading-relaxed">{impact}</p></div>
                  ))}
                </div>
                <div className="mt-3">
                  <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1.5 flex items-center gap-1"><Target className="w-3 h-3"/>Forward Projections</div>
                  {sector.projectedImpacts.map((impact,i)=>(
                    <div key={i} className="flex items-start gap-1.5 mb-1"><div className="w-1 h-1 rounded-full bg-amber-500 flex-shrink-0 mt-1.5"/><p className="text-[10px] text-slate-400 leading-relaxed">{impact}</p></div>
                  ))}
                </div>
                <div className="mt-3 p-2 rounded-lg bg-teal-950/30 border border-teal-800/30">
                  <div className="text-[10px] font-bold text-teal-400 uppercase tracking-wider mb-1">Planning Actions</div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{sector.planningNotes}</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── NATIONAL RESERVES PANEL ──────────────────────────────────────────────────
function NationalReservesPanel(){
  const fuelItems=[
    {id:"diesel",  label:"Diesel",   days:RESERVE_DAYS.diesel.current,        target:90, color:RESERVE_DAYS.diesel.current<40?C.gap:C.domestic},
    {id:"petrol",  label:"Petrol",   days:RESERVE_DAYS.petrol.current,        target:90, color:RESERVE_DAYS.petrol.current<40?C.warning:C.domestic},
    {id:"jet-fuel",label:"Jet Fuel", days:RESERVE_DAYS["jet-fuel"].current,   target:90, color:RESERVE_DAYS["jet-fuel"].current<40?C.gap:C.domestic},
  ];
  return(
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-purple-950/60 flex items-center justify-center flex-shrink-0"><Package className="w-3.5 h-3.5 text-purple-400"/></div>
        <div><div className="text-sm font-bold text-slate-100">National Supply Reserves — Complete Breakdown</div><div className="text-xs text-slate-500">Days of cover vs IEA 90-day standard · As of Jun 20, 2026</div></div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Flame className="w-3 h-3"/>Petroleum Products</div>
          <div className="space-y-4">
            {fuelItems.map(item=>{
              const pct=Math.min(100,(item.days/item.target)*100);
              return(
                <div key={item.id}>
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-xs text-slate-300 font-medium">{item.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold font-mono" style={{color:item.color}}>{item.days}</span>
                      <span className="text-xs text-slate-500">/ {item.target} days IEA standard</span>
                    </div>
                  </div>
                  <div className="relative h-3 bg-slate-700 rounded-full overflow-hidden">
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{width:`${pct}%`,background:item.color}}/>
                  </div>
                  <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                    <span>{pct.toFixed(0)}% of IEA standard</span>
                    <span style={{color:item.color}}>{item.days<30?"CRITICAL":item.days<50?"BELOW MINIMUM":"LOW"}</span>
                  </div>
                  <ReserveDeclineChart id={item.id}/>
                </div>
              );
            })}
          </div>
          <div className="mt-3 p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/40 text-[10px] text-slate-400 leading-relaxed">
            Budget 2026-27: $3.2B AU Fuel Security Reserve targeting 50 days diesel+jet. 50 emergency tankers dispatched Apr 2026. AU is the only IEA member (with NZ) without a government strategic petroleum reserve.
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Sprout className="w-3 h-3"/>Fertilizer — No Strategic Reserve Exists</div>
          {["urea","dap-map","potash"].map(id=>(
            <div key={id} className="mb-3">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-slate-300 font-medium capitalize">{id==="dap-map"?"DAP / MAP (Phosphate)":id==="urea"?"Urea (Nitrogen)":"Potash / MOP"}</span>
                <span className="text-sm font-bold font-mono text-slate-600">Zero reserve</span>
              </div>
              <div className="h-2.5 bg-red-950/30 rounded-full border border-red-900/30 flex items-center px-1.5">
                <span className="text-[8px] text-red-600 font-medium">NO STRATEGIC STOCKPILE — 100% reliant on active imports</span>
              </div>
            </div>
          ))}
          <div className="mt-3 p-2.5 rounded-lg bg-red-950/20 border border-red-800/40 text-[10px] text-slate-400 leading-relaxed">
            Australia has NO strategic fertilizer reserve for any product. EFA insurance/loans deployed for private imports. AU-Indonesia gov-to-gov: 250,000t urea secured (PT Pupuk Kaltim) — first tranche 47,250t departed May 2026. No government-held buffer stock exists.
          </div>
          <div className="mt-2 p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/40 text-[10px] text-slate-400 leading-relaxed">
            Domestic: Incitec Pivot Gibson Island urea closed Aug 2022. Only active facility: Phosphate Hill QLD (~100,000t DAP/MAP p.a., ~5% demand). $6.4B Dyno Nobel NT urea plant announced Jan 2026; earliest 2030.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CRISIS TIMELINE ─────────────────────────────────────────────────────────
function CrisisTimeline(){
  const [collapsed,setCollapsed]=useState(false);
  return(
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 cursor-pointer select-none" onClick={()=>setCollapsed(c=>!c)} data-testid="crisis-timeline-toggle">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-red-950/60 flex items-center justify-center flex-shrink-0"><Calendar className="w-3.5 h-3.5 text-red-400"/></div>
          <div><div className="text-sm font-bold text-slate-100">Crisis News Timeline</div><div className="text-xs text-slate-500">Strait of Hormuz — Latest to earliest · Feb 28 2026 onwards</div></div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className="text-[10px] bg-red-900/60 text-red-300 border-red-700 hidden sm:flex">ACTIVE</Badge>
          {collapsed?<ChevronDown className="w-4 h-4 text-slate-500"/>:<ChevronUp className="w-4 h-4 text-slate-500"/>}
        </div>
      </div>
      {!collapsed&&(
        <div className="px-4 pb-4 border-t border-slate-800/50">
          <div className="mt-4 relative">
            <div className="absolute left-[14px] top-3 bottom-3 w-0.5 bg-slate-700/60"/>
            <div className="space-y-3">
              {[...CRISIS_TIMELINE].reverse().map((ev,i)=>{
                const isCritAlert=ev.severity==="critical_alert";
                const isCrit=ev.severity==="critical";
                return(
                  <div key={i} className="flex gap-3 relative">
                    {isCritAlert?(
                      <div className="w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center z-10 relative mt-0.5 bg-red-600/90 border-2 border-red-400 shadow-[0_0_10px_rgba(239,68,68,0.7)] animate-pulse">
                        <AlertTriangle className="w-3.5 h-3.5 text-white"/>
                      </div>
                    ):(
                      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center z-10 relative mt-0.5 ${isCrit?"bg-red-900/80 border border-red-700":"bg-amber-900/60 border border-amber-700/60"}`}>
                        {isCrit?<AlertTriangle className="w-3.5 h-3.5 text-red-400"/>:<Info className="w-3.5 h-3.5 text-amber-400"/>}
                      </div>
                    )}
                    {isCritAlert?(
                      <div className="flex-1 rounded-lg p-3 border-2 border-red-500/70 bg-red-950/40 shadow-[0_0_12px_rgba(239,68,68,0.15)] ring-1 ring-red-500/20">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-[10px] font-mono text-slate-400">{ev.date}</span>
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-red-500 text-white shadow-sm">⚠ CRITICAL ALERT</span>
                          <span className="text-xs font-semibold text-red-200">{ev.label}</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed mb-2">{ev.desc}</p>
                        {(ev as any).pdfUrl&&(
                          <a href={(ev as any).pdfUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded-lg transition-colors">
                            <span>Read Full Report (13 pages)</span>
                            <span>→</span>
                          </a>
                        )}
                      </div>
                    ):(
                      <div className={`flex-1 rounded-lg p-3 border ${isCrit?"bg-red-950/20 border-red-800/40":"bg-amber-950/15 border-amber-800/30"}`}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-[10px] font-mono text-slate-400">{ev.date}</span>
                          <span className={`text-xs font-semibold ${isCrit?"text-red-300":"text-amber-300"}`}>{ev.label}</span>
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed">{ev.desc}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-red-950/50 to-slate-900 border border-red-800/50">
            <div className="flex items-start gap-2">
              <Target className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5"/>
              <div>
                <div className="text-xs font-bold text-red-300 mb-1">IEA Forward Warning — Jul–Aug 2026</div>
                <div className="text-xs text-slate-400 leading-relaxed">Product inventories could reach critically low levels by July–August 2026 if Hormuz remains closed. Jet fuel most at risk ({RESERVE_DAYS["jet-fuel"].current} days cover; critical threshold 21 days). Government has prepared National Fuel Emergency declaration trigger points.</div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <a href="https://thenextweb.com/news/australia-energy-security-renewables-hormuz" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline">TheNextWeb — Reserve crisis</a>
                  <a href="https://budget.gov.au/content/01-fuel-supply-and-security.htm" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline">Budget 2026-27</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SYNC BAR ─────────────────────────────────────────────────────────────────
function SyncBar({syncs,onRefresh,isSyncing}:{syncs:SyncLog[];onRefresh:()=>void;isSyncing:boolean}){
  const latest=syncs.length>0?syncs.reduce<SyncLog>((a,s)=>s.lastSyncAt>a.lastSyncAt?s:a,syncs[0]):null;
  const maxPeriod=syncs.reduce<string>((a,s)=>((s.latestPeriod??"")>a?(s.latestPeriod??""):a),"");
  const hasError=syncs.some(s=>s.status==="error");
  return(
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-800/50 border border-slate-700/40 mb-4 text-xs">
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`flex items-center gap-1.5 ${hasError?"text-amber-400":"text-emerald-400"}`}>
          <div className={`w-2 h-2 rounded-full ${hasError?"bg-amber-400":"bg-emerald-400"} animate-pulse`}/>
          {hasError?"Partial sync error":"Live ABS data · auto-syncs daily"}
        </div>
        {latest&&<span className="text-slate-400">Last sync: {relTime(latest.lastSyncAt)}</span>}
        {maxPeriod&&<span className="text-slate-400">Data through: <span className="text-slate-200 font-mono">{periodToLabel(maxPeriod)}</span></span>}
        <span className="text-slate-500">ABS MERCH_IMP · {syncs.length}/5 SITC codes</span>
      </div>
      <Button size="sm" variant="outline" className="text-xs h-7 border-slate-600 text-slate-300 hover:bg-slate-700" onClick={onRefresh} disabled={isSyncing} data-testid="button-refresh">
        {isSyncing?<Loader2 className="w-3 h-3 mr-1.5 animate-spin"/>:<RefreshCw className="w-3 h-3 mr-1.5"/>}
        {isSyncing?"Syncing…":"Sync Now"}
      </Button>
    </div>
  );
}

// ─── BRENT CRUDE PRICE MONITOR ────────────────────────────────────────────────
const BRENT_THRESHOLDS = [
  { min: 0,   max: 70,  label: "Pre-conflict / Recovery",           color: "#16a34a", bg: "rgba(22,163,74,0.12)",   description: "Normal pre-Hormuz baseline. Global supply balanced, AU pump prices stable." },
  { min: 70,  max: 80,  label: "Post-MOU Easing",                   color: "#0d9488", bg: "rgba(13,148,136,0.12)",  description: "Goldman Sachs & Fitch Q4 2026 target. Hormuz traffic recovering, SPR refill beginning." },
  { min: 80,  max: 90,  label: "Elevated \u2014 Supply Rebuilding",      color: "#f5a623", bg: "rgba(245,166,35,0.12)",  description: "AU pump prices +10\u201315\u00a2/L above pre-crisis. Diesel still under pressure from SPR refill demand." },
  { min: 90,  max: 110, label: "Stress \u2014 Partial Disruption",       color: "#ea580c", bg: "rgba(234,88,12,0.12)",   description: "EIA Jun/Jul 2026 base scenario. Partial Hormuz restriction. AU fuel excise cuts may be needed." },
  { min: 110, max: 130, label: "Crisis \u2014 Wartime Conditions",       color: "#dc2626", bg: "rgba(220,38,38,0.12)",   description: "Hormuz partially closed. AU Level 3 National Fuel Security Plan likely triggered. IEA release activated." },
  { min: 130, max: 150, label: "Severe Crisis \u2014 Full Closure",      color: "#b91c1c", bg: "rgba(185,28,28,0.14)",   description: "Full Hormuz closure scenario. IEA emergency coordinated release. AU fuel rationing protocols activated." },
  { min: 150, max: 200, label: "Economic Emergency",                color: "#7f1d1d", bg: "rgba(127,29,29,0.16)",   description: "Global recession risk elevated. AU emergency fuel declaration. Mandatory demand reduction. GDP contraction forecast." },
  { min: 200, max: 999, label: "Catastrophic \u2014 Near Collapse",      color: "#450a0a", bg: "rgba(220,38,38,0.25)",   description: "Near worldwide economic collapse. Aviation halted. AU national emergency declared. Global supply chain breakdown." },
];

function getThreshold(price: number) {
  return BRENT_THRESHOLDS.find(t => price >= t.min && price < t.max) ?? BRENT_THRESHOLDS[BRENT_THRESHOLDS.length - 1];
}

function BrentCrudeMonitor() {
  const { data, isLoading } = useQuery<{
    price: number; changePct: number; currency: string;
    source: string; symbol: string; timestamp: string; isFallback?: boolean;
  }>({
    queryKey: ["/api/proxy/brent"],
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });

  const PRE_CONFLICT  = 71;
  const WARTIME_PEAK  = 126;
  const GAUGE_MIN     = 40;
  const GAUGE_MAX     = 220;

  const price     = data?.price ?? 83;
  const changePct = data?.changePct ?? 0;
  const threshold = getThreshold(price);

  const pct   = Math.min(1, Math.max(0, (price - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));
  const angle = -135 + pct * 270;

  const updatedAt = data?.timestamp
    ? new Date(data.timestamp).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", hour12: true })
    : null;

  const changeColor = changePct >= 0 ? "#ef4444" : "#22c55e";
  const changeSign  = changePct >= 0 ? "+" : "";

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/70 p-4 mb-4" data-testid="brent-crude-monitor">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: threshold.color }} />
          <span className="text-xs font-semibold text-slate-200 uppercase tracking-widest">Brent Crude Index</span>
          <span className="text-xs text-slate-500 ml-1">Live Price Monitor</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {data?.isFallback && (
            <span className="text-[10px] text-amber-400 bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-700/40">STATIC FALLBACK</span>
          )}
          {data?.source && !data.isFallback && (
            <span className="text-[10px] text-slate-500">{data.source}</span>
          )}
          {updatedAt && <span className="text-[10px] text-slate-600">Updated {updatedAt}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: gauge + price readout */}
        <div className="flex flex-col items-center">
          {/* SVG Semi-circle Gauge */}
          <svg viewBox="0 0 200 110" className="w-full max-w-[220px]" aria-label={`Brent crude gauge: $${price.toFixed(2)}`}>
            {/* Background arc segments */}
            {BRENT_THRESHOLDS.map((t, i) => {
              const tPct0 = Math.min(1, Math.max(0, (t.min - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));
              const tPct1 = Math.min(1, Math.max(0, (t.max - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));
              const a0 = (-135 + tPct0 * 270) * (Math.PI / 180);
              const a1 = (-135 + tPct1 * 270) * (Math.PI / 180);
              const r = 80;
              const cx = 100, cy = 95;
              const x0 = cx + r * Math.cos(a0);
              const y0 = cy + r * Math.sin(a0);
              const x1 = cx + r * Math.cos(a1);
              const y1 = cy + r * Math.sin(a1);
              const largeArc = (tPct1 - tPct0) * 270 > 180 ? 1 : 0;
              return (
                <path
                  key={i}
                  d={`M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`}
                  fill="none"
                  stroke={t.color}
                  strokeWidth="14"
                  strokeLinecap="butt"
                  opacity="0.35"
                />
              );
            })}
            {/* Active arc filled to current price */}
            {(()=>{
              const a0 = -135 * (Math.PI / 180);
              const a1 = angle  * (Math.PI / 180);
              const r = 80;
              const cx = 100, cy = 95;
              const x0 = cx + r * Math.cos(a0);
              const y0 = cy + r * Math.sin(a0);
              const x1 = cx + r * Math.cos(a1);
              const y1 = cy + r * Math.sin(a1);
              const largeArc = pct * 270 > 180 ? 1 : 0;
              return (
                <path
                  d={`M ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`}
                  fill="none"
                  stroke={threshold.color}
                  strokeWidth="14"
                  strokeLinecap="round"
                  opacity="0.85"
                />
              );
            })()}
            {/* Needle */}
            {(()=>{
              const rad = angle * (Math.PI / 180);
              const cx = 100, cy = 95;
              const nx = cx + 68 * Math.cos(rad);
              const ny = cy + 68 * Math.sin(rad);
              return (
                <>
                  <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={threshold.color} strokeWidth="2.5" strokeLinecap="round" />
                  <circle cx={cx} cy={cy} r="5" fill={threshold.color} />
                </>
              );
            })()}
            <text x="18" y="104" fill="#64748b" fontSize="8" textAnchor="middle">$40</text>
            <text x="182" y="104" fill="#64748b" fontSize="8" textAnchor="middle">$220</text>
            {isLoading ? (
              <text x="100" y="84" fill="#94a3b8" fontSize="11" textAnchor="middle">Loading&hellip;</text>
            ) : (
              <>
                <text x="100" y="76" fill={threshold.color} fontSize="22" fontWeight="bold" textAnchor="middle">
                  ${price.toFixed(2)}
                </text>
                <text x="100" y="88" fill="#94a3b8" fontSize="8" textAnchor="middle">USD / barrel</text>
              </>
            )}
          </svg>

          {/* Price stats row */}
          <div className="flex gap-4 mt-1 text-center flex-wrap justify-center">
            <div>
              <div className="text-xs text-slate-500">24h Change</div>
              <div className="text-sm font-semibold" style={{ color: changeColor }}>
                {changeSign}{changePct.toFixed(2)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">vs Pre-conflict</div>
              <div className="text-sm font-semibold text-orange-400">
                +{((price - PRE_CONFLICT) / PRE_CONFLICT * 100).toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">vs Peak ($126)</div>
              <div className="text-sm font-semibold text-teal-400">
                {((price - WARTIME_PEAK) / WARTIME_PEAK * 100).toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Current zone badge */}
          <div
            className="mt-3 px-3 py-1.5 rounded-lg text-xs font-semibold text-center w-full"
            style={{ background: threshold.bg, color: threshold.color, border: `1px solid ${threshold.color}44` }}
          >
            {threshold.label}
          </div>
          <p className="text-[11px] text-slate-400 text-center mt-1.5 leading-snug px-1">
            {threshold.description}
          </p>
        </div>

        {/* Right: threshold table */}
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Economic Threshold Zones</div>
          {BRENT_THRESHOLDS.map((t, i) => {
            const isActive = price >= t.min && price < t.max;
            return (
              <div
                key={i}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-[11px] transition-all ${
                  isActive ? "ring-1" : "opacity-60"
                }`}
                style={{
                  background: isActive ? t.bg : "transparent",
                  border: isActive ? `1px solid ${t.color}55` : "1px solid transparent",
                } as React.CSSProperties}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.color, opacity: isActive ? 1 : 0.5 }} />
                <span className="text-slate-400 w-20 flex-shrink-0 text-[10px]">
                  ${t.min}{t.max < 999 ? `\u2013$${t.max}` : "+"}
                </span>
                <span className={isActive ? "text-slate-100 font-semibold" : "text-slate-400"}>{t.label}</span>
                {isActive && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: t.color, color: "#fff" }}>NOW</span>
                )}
              </div>
            );
          })}
          {/* Reference price annotations */}
          <div className="mt-2 pt-2 border-t border-slate-700/50 grid grid-cols-2 sm:grid-cols-3 gap-1 text-[10px] text-slate-500">
            <div><span className="text-slate-400 font-medium">Pre-conflict:</span> ~$71</div>
            <div><span className="text-slate-400 font-medium">Wartime peak:</span> ~$126</div>
            <div><span className="text-slate-400 font-medium">Goldman Q4 '26:</span> ~$80</div>
            <div><span className="text-slate-400 font-medium">EIA Jun/Jul '26:</span> ~$105</div>
            <div><span className="text-slate-400 font-medium">Fitch end-'26:</span> ~$70</div>
            <div><span className="text-slate-400 font-medium">MOU-fail upside:</span> $130+</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── OVERVIEW STATS ───────────────────────────────────────────────────────────
function OverviewStats(){
  const fuelPVR=["diesel","petrol","jet-fuel"].map(id=>{
    const pvr=PROJECTED_VS_RECEIVED[id];
    if(!pvr)return null;
    const latest=pvr.filter(p=>!p.isProjection).slice(-1)[0];
    return latest?{projected:latest.projected,received:latest.received}:null;
  }).filter(Boolean) as {projected:number;received:number}[];
  const totalFuelProj=fuelPVR.reduce((s,x)=>s+x.projected,0);
  const totalFuelRecv=fuelPVR.reduce((s,x)=>s+x.received,0);
  const fuelGap=totalFuelProj>0?((totalFuelRecv-totalFuelProj)/totalFuelProj*100):0;
  return(
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
      <div className="rounded-lg px-3 py-2.5 border bg-red-950/40 border-red-700/50">
        <div className="text-xs text-slate-400">Fuel Receipt Gap</div>
        <div className="text-2xl font-bold font-mono text-red-400">{fuelGap.toFixed(0)}%</div>
        <div className="text-xs text-slate-500">vs pre-crisis projection</div>
      </div>
      <div className="rounded-lg px-3 py-2.5 border bg-slate-800/40 border-slate-700/40">
        <div className="text-xs text-slate-400">Diesel Reserve</div>
        <div className="text-2xl font-bold font-mono" style={{color:RESERVE_DAYS.diesel.current<40?C.gap:C.domestic}}>{RESERVE_DAYS.diesel.current} days</div>
        <div className="text-xs text-slate-500">IEA target: 90 days</div>
      </div>
      <div className="rounded-lg px-3 py-2.5 border bg-slate-800/40 border-slate-700/40">
        <div className="text-xs text-slate-400">Jet Fuel Reserve</div>
        <div className="text-2xl font-bold font-mono" style={{color:RESERVE_DAYS["jet-fuel"].current<40?C.gap:C.domestic}}>{RESERVE_DAYS["jet-fuel"].current} days</div>
        <div className="text-xs text-slate-500">Most critical stock</div>
      </div>
      <div className="rounded-lg px-3 py-2.5 border bg-red-950/30 border-red-800/40">
        <div className="text-xs text-slate-400">Urea Receipt Gap</div>
        <div className="text-2xl font-bold font-mono text-red-400">−84%</div>
        <div className="text-xs text-slate-500">vs pre-crisis projection (Apr 26)</div>
      </div>
    </div>
  );
}



// ─── FUEL SHORTAGE MAP ────────────────────────────────────────────────────────
const STATE_STATUS: Record<string, {
  level: "critical"|"severe"|"moderate"|"watch"|"ok";
  diesel: string; unleaded: string; note: string; updated: string;
  stationsAffected?: number; pctAffected?: string;
}> = {
  SA:  { level:"severe",   stationsAffected:44, pctAffected:"6.1%", diesel:"TIGHT — MOU collapse likely to worsen diesel supply", unleaded:"TIGHT — MOU collapse likely to worsen diesel supply", note:"SA worst-affected state by percentage (6.1% of tracked stations). MOU collapse (Jul 8) likely to worsen diesel supply outlook further.", updated:"Jul 10 2026" },
  NSW: { level:"severe",   stationsAffected:58, pctAffected:"1.8%", diesel:"TIGHT — MOU collapse tightened outlook", unleaded:"MODERATE — MOU collapse tightened outlook", note:"58 stations affected — highest count nationally. MOU collapse tightened outlook; hotspots Mendooran, Dubbo, Albury, Kempsey.", updated:"Jul 10 2026" },
  QLD: { level:"moderate", stationsAffected:41, pctAffected:"2.2%", diesel:"PATCHY — BP Roma, Freedom Fuels Bundaberg/Nambour", unleaded:"MODERATE — BP Roma, Freedom Fuels Bundaberg/Nambour", note:"BP Roma and Freedom Fuels sites in Bundaberg/Nambour remain the key regional pressure points.", updated:"Jul 10 2026" },
  VIC: { level:"moderate", stationsAffected:32, pctAffected:"1.8%", diesel:"WATCH — Geelong RCCU partial restart", unleaded:"STABLE — Geelong RCCU partial restart", note:"Geelong refinery RCCU partial restart underway; metro supply holding stable.", updated:"Jul 10 2026" },
  WA:  { level:"watch",    stationsAffected:2,  pctAffected:"0.2%", diesel:"SECURE", unleaded:"SECURE", note:"Lowest outage rate nationally. Supply remains secure across both fuel types.", updated:"Jul 10 2026" },
  NT:  { level:"watch",    stationsAffected:0,  pctAffected:"0%",   diesel:"STABLE", unleaded:"STABLE", note:"No stations currently reporting outages. Supply stable.", updated:"Jul 10 2026" },
  TAS: { level:"ok",       stationsAffected:4,  pctAffected:"1.4%", diesel:"SECURE", unleaded:"SECURE", note:"No widespread outages. Supply remains secure.", updated:"Jul 10 2026" },
  ACT: { level:"ok",       stationsAffected:1,  pctAffected:"1.5%", diesel:"STABLE", unleaded:"STABLE", note:"Only 1 station affected. Supply stable via NSW pipeline.", updated:"Jul 10 2026" },
};

const LEVEL_COLOR: Record<string,{bg:string;border:string;text:string;dot:string}> = {
  critical: { bg:"bg-red-950/60",    border:"border-red-600/70",   text:"text-red-300",   dot:"bg-red-500" },
  severe:   { bg:"bg-orange-950/50", border:"border-orange-600/60",text:"text-orange-300",dot:"bg-orange-500" },
  moderate: { bg:"bg-amber-950/40",  border:"border-amber-600/50", text:"text-amber-300", dot:"bg-amber-400" },
  watch:    { bg:"bg-yellow-950/30", border:"border-yellow-600/40",text:"text-yellow-300",dot:"bg-yellow-400" },
  ok:       { bg:"bg-slate-800/40",  border:"border-slate-600/40", text:"text-slate-300", dot:"bg-green-500" },
};

const LEVEL_LABEL: Record<string,string> = {
  critical:"CRITICAL", severe:"SEVERE", moderate:"MODERATE", watch:"WATCH", ok:"OK",
};

const HOTSPOTS = [
  { region:"SA — On the Run Chain", status:"critical" as const, fuels:["diesel","lpg","unleaded"], note:"On the Run has 18 affected sites — 43% of all SA outages. Independent stations account for 71% of SA affected sites, suggesting smaller operators under greatest supply pressure. LPG is SA's most affected fuel type (42% of outages).", source:"PetrolPulse", sourceUrl:"https://petrolpulse.com.au/fuel-shortage", date:"Jun 19 2026" },
  { region:"NSW — Multi-Brand Outages", status:"critical" as const, fuels:["diesel","lpg","premium"], note:"48 stations affected — highest count nationally. 7-Eleven has most sites (9 stations, 18%). Diesel+premium diesel account for 25% of NSW outages. Regional towns with single-station coverage remain most vulnerable. NSW FuelCheck tracking 3,262 stations.", source:"PetrolPulse NSW", sourceUrl:"https://petrolpulse.com.au/fuel-shortage/nsw", date:"Jun 19 2026" },
  { region:"Ti Tree Roadhouse, NT", status:"dry" as const, fuels:["u95"], note:"Only active NT outage as of Jun 19 — significant improvement from critical status earlier in crisis. Remote Barkly Highway stop serving communities between Alice Springs and Tennant Creek.", source:"PetrolPulse NT", sourceUrl:"https://petrolpulse.com.au/fuel-shortage/nt", date:"Jun 19 2026" },
  { region:"Mt Isa, QLD", status:"low" as const, fuels:["diesel","unleaded"], note:"Supply improving after 40M litre Freedom Fuels diesel shipment secured for QLD (Jun). Mining operations gradually restoring normal procurement. Previously on emergency government allocation.", source:"FuelPlan.gov.au", sourceUrl:"https://fuelplan.gov.au/news", date:"Jun 19 2026" },
  { region:"Pilbara, WA", status:"low" as const, fuels:["diesel"], note:"Improving — 50M litres additional diesel secured for WA via BP (Jun 9). State-owned strategic reserve now held at Kalgoorlie and Geraldton for rapid deployment. Mine operators easing emergency protocols.", source:"AMEC + WA Govt", sourceUrl:"https://amec.org.au/resources-hub/fuel-security/", date:"Jun 19 2026" },
  { region:"Adelaide–Mount Gambier Route, SA", status:"critical" as const, fuels:["jet"], note:"Qantas Adelaide–Mount Gambier route suspended indefinitely from May 18. Both passenger and freight loss for SA regional community. Aviation jet fuel tightest of all fuel types nationally — 32 days cover.", source:"Global Energy Flow", sourceUrl:"https://global-energy-flow.com/shortages/australia/", date:"Jun 19 2026" },
  { region:"Regional QLD — Outback", status:"low" as const, fuels:["diesel"], note:"SWQROC tracker (43 outback stations) shows most diesel available. Cunnamulla, Roma, St George operational. Hungerford and Noccundra listed unavailable. Situation improving from critical phase.", source:"SWQROC Fuel Tracker", sourceUrl:"https://fueltracker.swqroc.com.au", date:"Jun 13 2026" },
  { region:"Geelong, VIC — Refinery", status:"low" as const, fuels:["diesel"], note:"Viva Energy Geelong RCCU offline since Apr 15 fire — restart targeted for mid–late June but not yet confirmed at 90% capacity. Metro VIC supply maintained via imports. Key domestic refining buffer if imports slow.", source:"Global Energy Flow", sourceUrl:"https://global-energy-flow.com/shortages/australia/", date:"Jun 19 2026" },
  { region:"National — Jun 30 Excise Cliff", status:"critical" as const, fuels:["unleaded","diesel"], note:"Fuel excise 50% cut (26.3c/L at pump) expires June 30. No PM decision yet on extension. If allowed to lapse, retail prices jump mechanically +26c/L on July 1 regardless of crude direction. ACCC weekly report Jun 19: petrol avg 177.9c/L, diesel avg 206.5c/L. Post-cliff estimates: petrol ~204c/L, diesel ~233c/L.", source:"ACCC + IndexBox", sourceUrl:"https://www.indexbox.io/blog/accc-fuel-report-petrol-prices-drop-ahead-of-excise-restoration-decision/", date:"Jun 19 2026" },
];

const SHORTAGE_STATUS_STYLE: Record<string,{label:string;cls:string}> = {
  dry:      { label:"DRY",      cls:"bg-red-900 text-red-200 border border-red-700" },
  critical: { label:"CRITICAL", cls:"bg-orange-900 text-orange-200 border border-orange-700" },
  low:      { label:"LOW",      cls:"bg-amber-900 text-amber-200 border border-amber-700" },
  limited:  { label:"LIMITED",  cls:"bg-yellow-900 text-yellow-200 border border-yellow-700" },
  ok:       { label:"OK",       cls:"bg-green-900 text-green-200 border border-green-700" },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}


// ─── AUSTRALIA MAP ────────────────────────────────────────────────────────────
// SVG map with state fills colour-coded by shortage level + hotspot markers
// ─── FUEL SHORTAGE PANEL ─────────────────────────────────────────────────────
function FuelShortagePanel() {
  const [form, setForm] = useState({ suburb:"", state:"NSW", fuelType:"unleaded", status:"dry", stationName:"", note:"" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const qc = useQueryClient();

  const { data: reports = [], isLoading: reportsLoading } = useQuery<any[]>({
    queryKey: ["/api/fuel-reports"],
    refetchInterval: 60_000,
    throwOnError: false,
    retry: false,
  });

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/fuel-reports/count"],
    refetchInterval: 60_000,
    throwOnError: false,
    retry: false,
  });

  const submitReport = async () => {
    if (!form.suburb.trim()) { setSubmitError("Please enter your suburb or town."); return; }
    setSubmitting(true); setSubmitError("");
    try {
      await apiRequest("POST", "/api/fuel-reports", form);
      setSubmitted(true);
      qc.invalidateQueries({ queryKey: ["/api/fuel-reports"] });
      qc.invalidateQueries({ queryKey: ["/api/fuel-reports/count"] });
      setTimeout(() => { setSubmitted(false); setForm(f => ({ ...f, suburb:"", stationName:"", note:"" })); }, 4000);
    } catch (e: any) {
      setSubmitError(e.message || "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const stateLevels = Object.entries(STATE_STATUS).sort((a,b) => {
    const order = ["critical","severe","moderate","watch","ok"];
    return order.indexOf(a[1].level) - order.indexOf(b[1].level);
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-red-800/50 bg-red-950/20 p-4">
        <div className="flex items-start gap-3">
          <Flame className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm font-bold text-slate-100 mb-1">Fuel Shortage Tracker — Australia</div>
            <div className="text-xs text-slate-400 leading-relaxed">
              State-level supply status based on PetrolPulse live government-feed data (updated every 30 min), ACCC weekly reports, WA Government weekly briefs, and verified news sources. As of Jul 10 2026: 173 stations reporting outages nationally (221 fuel-type outages). SA worst by % (6.1%), NSW highest count (58 stations). MOU collapsed Jul 8 — forward supply disruptions expected. Data auto-refreshes weekly via scheduled task — next update Fri Jul 17 2026. Station-level data is community-submitted and unverified.
            </div>
            <div className="flex flex-wrap gap-3 mt-2 text-xs">
              <a href="https://petrolpulse.com.au/fuel-shortage" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">PetrolPulse — live outage map</a>
              <a href="https://www.lastdrop.au" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">LastDrop AU — vessel tracking</a>
              <a href="https://www.accc.gov.au/consumers/petrol-and-fuel/fuel-price-monitoring-during-the-current-middle-eastern-conflict" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">ACCC Weekly Fuel Monitor</a>
              <a href="https://fuelplan.gov.au/news" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">FuelPlan.gov.au — Govt updates</a>
              <a href="https://global-energy-flow.com/shortages/australia/" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">Global Energy Flow — AU status</a>
              <a href="https://www.fuelwatch.wa.gov.au" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">FuelWatch WA</a>
              <a href="https://www.fuelcheck.nsw.gov.au" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">FuelCheck NSW</a>
              <a href="https://fueltracker.swqroc.com.au" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:underline">SWQROC QLD Outback Tracker</a>
            </div>
          </div>
        </div>
      </div>

      {/* Status key */}
      <div className="flex flex-wrap gap-2 items-center text-xs text-slate-500">
        <span>Status key:</span>
        {["critical","severe","moderate","watch","ok"].map(l => (
          <span key={l} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${LEVEL_COLOR[l].dot}`}/>
            <span className={LEVEL_COLOR[l].text}>{LEVEL_LABEL[l]}</span>
          </span>
        ))}
        <span className="ml-auto text-slate-600">Based on PetrolPulse live data, ACCC, WA Govt weekly brief · Updated Jul 10 2026</span>
      </div>

      {/* State grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stateLevels.map(([state, info]) => {
          const c = LEVEL_COLOR[info.level];
          return (
            <div key={state} className={`rounded-xl border p-3 ${c.bg} ${c.border}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-base font-bold text-slate-100">{state}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${c.bg} ${c.text} border ${c.border}`}>
                  {LEVEL_LABEL[info.level]}
                </span>
              </div>
              <div className="space-y-1 mb-2">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-slate-500 w-14 flex-shrink-0">Diesel</span>
                  <span className={`font-medium ${c.text}`}>{info.diesel}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="text-slate-500 w-14 flex-shrink-0">Unleaded</span>
                  <span className={`font-medium ${c.text}`}>{info.unleaded}</span>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">{info.note}</p>
              <div className="text-[9px] text-slate-600 mt-1.5">Updated {info.updated}</div>
            </div>
          );
        })}
      </div>

      {/* Geographical map */}
      <AustraliaMap />

      {/* Confirmed hotspots */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
        <div className="text-sm font-bold text-slate-100 mb-1">Confirmed Shortage Hotspots</div>
        <div className="text-xs text-slate-500 mb-3">Sourced from news reports, government advisories, and industry alerts. Click sources to verify.</div>
        <div className="space-y-2">
          {HOTSPOTS.map((h, i) => {
            const ss = SHORTAGE_STATUS_STYLE[h.status] ?? SHORTAGE_STATUS_STYLE.ok;
            return (
              <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="text-xs font-semibold text-slate-200">{h.region}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ss.cls}`}>{ss.label}</span>
                    {h.fuels.map(f => (
                      <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 capitalize">{f}</span>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{h.note}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <a href={h.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-teal-500 hover:underline">
                      Source: {h.source}
                    </a>
                    <span className="text-[10px] text-slate-600">· {h.date}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Community report form */}
      <div className="rounded-xl border border-teal-700/40 bg-teal-950/15 p-4">
        <div className="flex items-center gap-2 mb-1">
          <MapPin className="w-4 h-4 text-teal-400"/>
          <span className="text-sm font-bold text-teal-300">Report a Fuel Shortage Near You</span>
        </div>
        <p className="text-xs text-slate-400 mb-4 leading-relaxed">
          No government system tracks station-level shortages in real time. Your report helps other Australians know what's happening on the ground.
          Reports are anonymous and visible to everyone on this page.
          {countData?.count ? <span className="text-teal-400 font-medium"> {countData.count} report{countData.count !== 1 ? "s" : ""} submitted so far.</span> : null}
        </p>
        {submitted ? (
          <div className="rounded-lg bg-green-900/40 border border-green-700/50 p-3 text-sm text-green-300 text-center">
            ✓ Report submitted — thank you for helping the community.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Suburb / Town *</label>
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                placeholder="e.g. Cairns, Alice Springs"
                value={form.suburb}
                onChange={e => setForm(f => ({ ...f, suburb: e.target.value }))}
                maxLength={80}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">State *</label>
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
                value={form.state}
                onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
              >
                {["NSW","VIC","QLD","WA","SA","TAS","NT","ACT"].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Fuel Type *</label>
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
                value={form.fuelType}
                onChange={e => setForm(f => ({ ...f, fuelType: e.target.value }))}
              >
                <option value="unleaded">Unleaded (ULP91)</option>
                <option value="diesel">Diesel</option>
                <option value="e10">E10</option>
                <option value="premium">Premium (98)</option>
                <option value="lpg">LPG</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Status *</label>
              <select
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-teal-500"
                value={form.status}
                onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              >
                <option value="dry">Completely Dry — pumps empty</option>
                <option value="low">Very Low — almost out</option>
                <option value="limited">Limited — purchase restrictions</option>
                <option value="ok">OK — supply available</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Station Name (optional)</label>
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                placeholder="e.g. BP Cairns North"
                value={form.stationName}
                onChange={e => setForm(f => ({ ...f, stationName: e.target.value }))}
                maxLength={100}
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 uppercase tracking-wider block mb-1">Note (optional)</label>
              <input
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-teal-500"
                placeholder="e.g. Queue 2hrs, 20L limit"
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                maxLength={300}
              />
            </div>
            {submitError && (
              <div className="sm:col-span-2 text-xs text-red-400 bg-red-950/40 border border-red-800/50 rounded-lg px-3 py-2">{submitError}</div>
            )}
            <div className="sm:col-span-2">
              <button
                onClick={submitReport}
                disabled={submitting}
                className="w-full sm:w-auto px-5 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <MapPin className="w-4 h-4"/>}
                {submitting ? "Submitting…" : "Submit Report"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Community reports feed */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-bold text-slate-100">Community Reports — Last 72 Hours</div>
            <div className="text-xs text-slate-500">Community-submitted · Unverified · Refresh every 60s</div>
          </div>
          <button onClick={() => qc.invalidateQueries({ queryKey:["/api/fuel-reports"] })}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1">
            <RefreshCw className="w-3 h-3"/> Refresh
          </button>
        </div>
        {reportsLoading && (
          <div className="flex items-center gap-2 text-xs text-slate-500 py-4">
            <Loader2 className="w-3 h-3 animate-spin"/> Loading reports…
          </div>
        )}
        {!reportsLoading && reports.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-6 border border-dashed border-slate-700 rounded-lg">
            No community reports yet in the last 72 hours.<br/>
            Be the first to report fuel availability in your area.
          </div>
        )}
        {reports.length > 0 && (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {reports.map((r: any) => {
              const ss = SHORTAGE_STATUS_STYLE[r.status] ?? SHORTAGE_STATUS_STYLE.ok;
              return (
                <div key={r.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-slate-200">{r.suburb}, {r.state}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${ss.cls}`}>{ss.label}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 capitalize">{r.fuel_type}</span>
                      {r.station_name && <span className="text-[10px] text-slate-400">{r.station_name}</span>}
                    </div>
                    {r.note && <p className="text-xs text-slate-400 mt-0.5">{r.note}</p>}
                    <div className="text-[10px] text-slate-600 mt-0.5">Reported {timeAgo(r.reported_at)} · community report — unverified</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="text-xs text-slate-600 leading-relaxed text-center pb-2">
        State data: <a href="https://petrolpulse.com.au/fuel-shortage" target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">PetrolPulse</a> (Jun 19 2026, 164 stations / 211 fuel-type outages) · <a href="https://www.accc.gov.au/consumers/petrol-and-fuel/fuel-price-monitoring-during-the-current-middle-eastern-conflict" target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">ACCC Weekly Monitor</a> · <a href="https://www.wa.gov.au/government/publications/fuel-security-wa-government-weekly-fuel-update" target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">WA Govt Weekly Brief</a> · <a href="https://global-energy-flow.com/shortages/australia/" target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">Global Energy Flow</a> · <a href="https://amec.org.au/resources-hub/fuel-security/" target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">AMEC</a> · <a href="https://www.lastdrop.au" target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline">Last Drop AU</a>.
        Community reports are unverified. Weekly auto-update via scheduled cron — next run Fri Jul 17 2026.
      </div>
    </div>
  );
}


// ─── CITIZENS GUIDE ───────────────────────────────────────────────────────────
function CitizensGuidePanel(){
  const colorMap:Record<string,string>={
    teal:"border-teal-700/50 bg-teal-950/20",
    amber:"border-amber-700/50 bg-amber-950/20",
    yellow:"border-yellow-700/50 bg-yellow-950/20",
    purple:"border-purple-700/50 bg-purple-950/20",
    slate:"border-slate-600/50 bg-slate-800/30",
    red:"border-red-700/50 bg-red-950/20",
    green:"border-green-700/50 bg-green-950/20",
    emerald:"border-emerald-700/50 bg-emerald-950/20",
    blue:"border-blue-700/50 bg-blue-950/20",
  };
  const hdrMap:Record<string,string>={
    teal:"text-teal-300",amber:"text-amber-300",yellow:"text-yellow-300",
    purple:"text-purple-300",slate:"text-slate-200",red:"text-red-300",
    green:"text-green-300",emerald:"text-emerald-300",blue:"text-blue-300",
  };
  const sections=[
    {
      id:"food",icon:"🥫",color:"teal",title:"Food & Groceries",
      intro:`With fertilizer supply down 52–84% and diesel at ${RESERVE_DAYS.diesel.current} days, food prices are rising sharply. Practical steps you can take now:`,
      tips:[
        "Stock 2–4 weeks of staples gradually — rice, pasta, canned legumes, oats, flour, sugar, salt. Rotate stock so nothing expires.",
        "Grow what you can — herbs, tomatoes, lettuce on a balcony or windowsill. Most councils have free community gardens.",
        "Switch proteins: eggs, lentils, chickpeas and dried beans are far cheaper than meat and less affected by fuel costs.",
        "Shop at local markets late Saturday — vendors discount heavily to avoid waste.",
        "Use Foodbank, OzHarvest or SecondBite if costs become unmanageable — these services are for working people too.",
      ],
      resources:[
        {label:"Foodbank Australia — find your nearest",url:"https://www.foodbank.org.au/foodbank-near-me/",phone:""},
        {label:"OzHarvest NEST — free food & cooking skills",url:"https://www.ozharvest.org/what-we-do/programs/nest/",phone:""},
        {label:"SecondBite — community food programs",url:"https://secondbite.org",phone:""},
        {label:"Salvation Army — emergency food parcels",url:"https://www.salvationarmy.org.au/need-help/financial-assistance/",phone:"13 72 58"},
      ]
    },
    {
      id:"fuel",icon:"⛽",color:"amber",title:"Fuel & Transport",
      intro:`Diesel is at ${RESERVE_DAYS.diesel.current} days reserve (IEA requires 90). Petrol prices up 40–58%. Reduce your exposure now:`,
      tips:[
        "Fill up when prices dip — cheapest Tuesday/Wednesday mornings. PetrolSpy and GasBuddy apps show cheapest nearby stations.",
        "Combine all errands into single trips — every unnecessary drive adds up at current prices.",
        "Work from home 1–2 days per week where possible — meaningful fuel savings each month.",
        "Log every litre used for work — fully tax deductible for work-related driving.",
        "Maintain tyre pressure — under-inflated tyres increase fuel consumption by up to 3%.",
        "Carpool for regular commutes via Carpool World or Liftshare AU apps.",
      ],
      resources:[
        {label:"PetrolSpy — cheapest fuel near you",url:"https://petrolspy.com.au",phone:""},
        {label:"GasBuddy Australia",url:"https://www.gasbuddy.com",phone:""},
      ]
    },
    {
      id:"power",icon:"💡",color:"yellow",title:"Power & Energy Bills",
      intro:"Energy prices are linked to gas — with LNG supply disrupted, bills will rise. Every major retailer has a hardship team by law.",
      tips:[
        "Contact your energy retailer before missing a payment — not after. Ask for a 'hardship plan'. They must offer one by law.",
        "Compare plans free at energymadeeasy.gov.au — the government's official tool shows all available offers in your area.",
        "Apply for your state's energy concession if you hold a Centrelink, pension, or Health Care Card.",
        "Run heavy appliances (dishwasher, washing machine, dryer) off-peak — usually 10pm–7am.",
        "A plug-in power meter (~$30 at Bunnings) identifies energy-hungry appliances worth replacing.",
        "Hot water is typically 30% of your bill — a 4-minute shower timer costs nothing to use.",
      ],
      resources:[
        {label:"Energy Made Easy — government bill comparison",url:"https://www.energymadeeasy.gov.au",phone:""},
        {label:"AGL Financial Hardship",url:"https://www.agl.com.au/residential/support/financial-hardship",phone:"131 245"},
        {label:"Origin Energy Hardship",url:"https://www.originenergy.com.au/about/contact-us/hardship-policy/",phone:"132 461"},
        {label:"Energy & Water Ombudsman (all states)",url:"https://www.ombudsman.gov.au/about/ombudsmen-in-australia",phone:""},
      ]
    },
    {
      id:"telco",icon:"📱",color:"purple",title:"Phone & Internet",
      intro:"A 2024 federal law requires all telcos to keep you connected in hardship. You have legal rights — use them.",
      tips:[
        "Call your provider and say 'financial hardship' — this triggers legal protections under the Telecommunications Financial Hardship Industry Standard 2024.",
        "They must offer at least 6 different assistance options including payment plans, temporary pauses, and plan downgrades.",
        "If they disconnect you without first offering hardship options, complain to the TIO — free and independent.",
        "Budget prepaid SIMs (Aldi Mobile, Boost, Kogan) offer plans from $10–15/month with basic calls and data.",
      ],
      resources:[
        {label:"Telstra Financial Hardship",url:"https://www.telstra.com.au/aboutus/support-in-times-of-need/adversity-financial-hardship",phone:"132 200"},
        {label:"Optus Hardship — Advocacy Assist",url:"https://www.optus.com.au/about/specialist-care/financial-hardship",phone:"1300 308 839"},
        {label:"Telecommunications Industry Ombudsman",url:"https://www.tio.com.au",phone:"1800 062 058"},
      ]
    },
    {
      id:"council",icon:"🏛️",color:"slate",title:"Council Rates & Vehicle Registration",
      intro:"Council rates, rego, and similar charges can be deferred, waived, or paid in instalments — ask before the due date.",
      tips:[
        "Contact your local council before rates are due and ask about the hardship policy — most can defer, remit, or spread payments.",
        "All states allow vehicle registration paid in instalments. NSW, QLD, VIC and WA allow quarterly payments.",
        "Centrelink card holders may be eligible for concession rates on rego — check your state's concession register.",
        "Ask about other unpublicised council relief: bulk waste deferral, library fee waiver, community facility discounts.",
      ],
      resources:[
        {label:"National Debt Helpline — Council Rates guide",url:"https://ndh.org.au/debt-problems/council-rates/",phone:"1800 007 007"},
        {label:"NSW: Service NSW",url:"https://www.service.nsw.gov.au",phone:"13 77 88"},
        {label:"VIC: VicRoads payment plans",url:"https://www.vicroads.vic.gov.au",phone:"13 11 71"},
        {label:"QLD: TMR concessions",url:"https://www.tmr.qld.gov.au",phone:"13 23 80"},
        {label:"WA: DoT concessions",url:"https://www.transport.wa.gov.au",phone:"13 11 56"},
      ]
    },
    {
      id:"banks",icon:"🏦",color:"red",title:"Banks, Mortgages & Interest Rates",
      intro:"Interest rates remain elevated. If you're struggling with mortgage or credit repayments, banks have a legal hardship obligation — act early.",
      tips:[
        "Contact your bank's hardship team before missing a payment. Under the National Credit Code, lenders must consider your request in writing.",
        "Ask specifically for: payment pause, repayment reduction, interest capitalisation, loan extension, or interest-only temporarily.",
        "Missing a payment triggers a default on your credit file — contacting the bank first usually prevents this.",
        "If a bank refuses your hardship request, escalate to AFCA — free, independent, and legally binding.",
        "Check eligibility for the No Interest Loan Scheme (NILS) — loans up to $2,000 interest-free through Good Shepherd.",
      ],
      resources:[
        {label:"Australian Financial Complaints Authority (AFCA)",url:"https://www.afca.org.au",phone:"1800 931 678"},
        {label:"ASIC MoneySmart — financial difficulty",url:"https://moneysmart.gov.au/managing-debt/financial-hardship",phone:""},
        {label:"No Interest Loan Scheme (NILS)",url:"https://goodshep.org.au/services/nils/",phone:"1300 121 130"},
      ]
    },
    {
      id:"financial",icon:"📋",color:"green",title:"Free Financial Counselling",
      intro:"Free financial counsellors are qualified professionals — not salespeople. They help you prioritise debts, negotiate with creditors, and find relief you may not know exists.",
      tips:[
        "Call 1800 007 007 — the National Debt Helpline. Free, confidential, weekdays 9:30am–4:30pm.",
        "Live chat at ndh.org.au weekdays 9am–8pm — if you'd prefer not to speak on the phone.",
        "Financial counsellors can negotiate directly with your bank, utility, or creditor on your behalf at no cost.",
        "They identify government benefits and concessions you're entitled to but may not be receiving.",
        "Running a small business? Call the Small Business Debt Hotline: 1800 413 828.",
      ],
      resources:[
        {label:"National Debt Helpline",url:"https://ndh.org.au",phone:"1800 007 007"},
        {label:"Financial Counselling Australia — find a counsellor",url:"https://www.financialcounsellingaustralia.org.au/find-financial-counsellor",phone:""},
        {label:"Small Business Debt Hotline",url:"https://sbdh.org.au",phone:"1800 413 828"},
        {label:"ASIC MoneySmart",url:"https://moneysmart.gov.au",phone:""},
      ]
    },
    {
      id:"mental",icon:"💚",color:"emerald",title:"Mental Health & Wellbeing",
      intro:"46% of Australians cite financial pressure as a key factor in distress (Beyond Blue 2026). Financial stress and mental health are directly linked — reaching out early works.",
      tips:[
        "Call Lifeline 13 11 14 anytime, 24/7. Not only for crisis — also for sustained cost-of-living pressure and anxiety.",
        "Beyond Blue 1300 22 4636 (24/7) has a specific cost-of-living and financial wellbeing section at beyondblue.org.au.",
        "A GP Mental Health Plan gives you up to 20 Medicare-subsidised psychology sessions per year. Book a long appointment and ask your GP.",
        "Many community health centres offer free or low-cost counselling — search 'community mental health [your suburb]'.",
        "Headspace (under 25s) offers free mental health support at headspace.org.au or call 1800 650 890.",
        "R U OK? — check in on people around you who might be quietly struggling. ruok.org.au has conversation guides.",
      ],
      resources:[
        {label:"Lifeline — 24/7 crisis & support line",url:"https://www.lifeline.org.au",phone:"13 11 14"},
        {label:"Beyond Blue — financial stress & wellbeing",url:"https://www.beyondblue.org.au/mental-health/financial-wellbeing/cost-of-living-crisis",phone:"1300 22 4636"},
        {label:"Headspace — under 25s mental health",url:"https://headspace.org.au",phone:"1800 650 890"},
        {label:"SANE Australia",url:"https://www.sane.org",phone:"1800 187 263"},
        {label:"R U OK? — supporting others",url:"https://www.ruok.org.au",phone:""},
      ]
    },
  ];

  return(
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-700/40 bg-blue-950/20 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-6 h-6 text-blue-400 flex-shrink-0 mt-0.5"/>
          <div>
            <div className="text-sm font-bold text-slate-100 mb-1">Practical Preparation Guide — For Every Australian</div>
            <div className="text-xs text-slate-400 leading-relaxed">
              The Strait of Hormuz crisis is raising costs across fuel, food, power, and essential goods. This guide covers real steps you can take now — plus official hardship programs, free financial counselling, food charities, and mental health services available across Australia.
              All services listed are free or low-cost. You do not need to be in crisis to use them.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          {label:"Financial Counselling",phone:"1800 007 007",sub:"National Debt Helpline · Weekdays"},
          {label:"Mental Health / Crisis",phone:"13 11 14",sub:"Lifeline — 24/7"},
          {label:"Beyond Blue",phone:"1300 22 4636",sub:"Financial stress support — 24/7"},
          {label:"Small Business Debt",phone:"1800 413 828",sub:"Small Business Debt Hotline"},
        ].map((h:any)=>(
          <a key={h.phone} href={`tel:${h.phone.replace(/\s/g,"")}`}
            className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3 hover:bg-slate-700/40 transition-colors block text-left">
            <div className="text-[10px] text-slate-400 mb-0.5">{h.label}</div>
            <div className="text-sm font-bold text-slate-100 font-mono">{h.phone}</div>
            <div className="text-[10px] text-slate-500 mt-0.5">{h.sub}</div>
          </a>
        ))}
      </div>

      {sections.map((sec:any)=>(
        <div key={sec.id} className={`rounded-xl border p-4 ${colorMap[sec.color]??"border-slate-700/50 bg-slate-900/60"}`}>
          <div className={`text-sm font-bold mb-1 flex items-center gap-2 ${hdrMap[sec.color]??"text-slate-100"}`}>
            <span className="text-base">{sec.icon}</span>{sec.title}
          </div>
          <p className="text-xs text-slate-400 mb-3 leading-relaxed">{sec.intro}</p>
          <ul className="space-y-1.5 mb-4">
            {sec.tips.map((tip:string,i:number)=>(
              <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                <span className="text-slate-500 flex-shrink-0 mt-0.5">›</span>
                <span className="leading-relaxed">{tip}</span>
              </li>
            ))}
          </ul>
          {sec.resources.length>0&&(
            <div className="border-t border-slate-700/40 pt-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">Resources &amp; Contacts</div>
              <div className="grid gap-1.5">
                {sec.resources.map((r:any,i:number)=>(
                  <div key={i} className="flex items-center justify-between gap-2">
                    <a href={r.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-teal-400 hover:underline">{r.label}</a>
                    {r.phone&&(
                      <a href={`tel:${r.phone.replace(/\s/g,"")}`}
                        className="text-xs font-mono text-slate-300 hover:text-slate-100 flex-shrink-0 bg-slate-800/60 px-2 py-0.5 rounded">{r.phone}</a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="rounded-xl border border-slate-600/50 bg-slate-800/30 p-4">
        <div className="text-sm font-bold text-slate-100 mb-3">📋 30-Day Household Preparation Checklist</div>
        <div className="grid sm:grid-cols-2 gap-1.5">
          {[
            "Stock 2–4 weeks of non-perishable food staples",
            "Keep fuel tank above half — fill when prices dip",
            "Compare energy plan at energymadeeasy.gov.au",
            "Contact any creditor you're struggling with before missing a payment",
            "Apply for any concession card you may be eligible for",
            "Download your state's emergency app (Hazards Near Me, VicEmergency)",
            "Build a small cash reserve — ATMs can be unreliable in disruptions",
            "Call your council about hardship deferral on rates",
            "Check in on elderly or isolated neighbours",
            "Bookmark ndh.org.au (1800 007 007) and lifeline.org.au (13 11 14)",
          ].map((item:string,i:number)=>(
            <div key={i} className="flex items-start gap-2 text-xs text-slate-300">
              <span className="text-slate-600 flex-shrink-0 mt-0.5">☐</span>
              <span className="leading-relaxed">{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="text-xs text-slate-600 text-center pt-1 pb-2">
        Sources: <a href="https://ndh.org.au" className="text-teal-700 hover:underline" target="_blank">National Debt Helpline</a> · <a href="https://www.foodbank.org.au" className="text-teal-700 hover:underline" target="_blank">Foodbank Australia</a> · <a href="https://www.beyondblue.org.au" className="text-teal-700 hover:underline" target="_blank">Beyond Blue</a> · <a href="https://www.energymadeeasy.gov.au" className="text-teal-700 hover:underline" target="_blank">Energy Made Easy</a> · <a href="https://www.afca.org.au" className="text-teal-700 hover:underline" target="_blank">AFCA</a> · <a href="https://www.acma.gov.au" className="text-teal-700 hover:underline" target="_blank">ACMA 2024</a>
      </div>
    </div>
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
type ViewMode="overview"|"commodities"|"sectors"|"reserves"|"citizens"|"shortage";


export default function Dashboard(){
  const [viewMode,setViewMode]=useState<ViewMode>("overview");
  const [showHormuzMap,setShowHormuzMap]=useState(false);
  const [showShipTracker,setShowShipTracker]=useState(false);
  const [activeTab,setActiveTab]=useState<"all"|"fertilizer"|"petroleum">("all");
  const [expandedIds,setExpandedIds]=useState<Set<string>>(new Set(["urea","diesel"]));
  const qc=useQueryClient();
  const toggleExpanded=useCallback((id:string)=>{setExpandedIds(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});},[]);

  const {data:allRows=[],isLoading:rowsLoading}=useQuery<ImportDataRow[]>({queryKey:["/api/import-data/all"],refetchInterval:5*60*1000});
  const {data:syncResp}=useQuery<{inProgress:boolean;logs:SyncLog[]}>({queryKey:["/api/sync/status"],refetchInterval:60*1000});
  const syncs:SyncLog[]=syncResp?.logs??[];
  const syncMutation=useMutation({
    mutationFn:()=>apiRequest("POST","/api/sync"),
    onSuccess:()=>{qc.invalidateQueries({queryKey:["/api/import-data/all"]});qc.invalidateQueries({queryKey:["/api/sync/status"]});},
  });

  const subcategories=useMemo<SubcategoryData[]>(()=>
    allRows.length===0?subcategoryDefs.map(d=>buildFallbackSubcategory(d)):subcategoryDefs.map(d=>buildSubcategory(d,allRows,15))
  ,[allRows]);

  const displayed=useMemo(()=>activeTab==="all"?subcategories:subcategories.filter(s=>s.commodity===activeTab),[subcategories,activeTab]);

  const NAV:[ViewMode,string,any][]=[
    ["overview","Overview",BarChart2],
    ["commodities","Commodities",Package],
    ["sectors","Sector Impacts",Users],
    ["reserves","Reserves",Database],
    ["citizens","Citizens Guide",ShieldCheck],
    ["shortage","Fuel Shortage Map",Flame],
  ];

  return(
    <div className="min-h-screen bg-background text-foreground" style={{fontFamily:"'Satoshi',sans-serif"}}>
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <svg aria-label="AU Supply Crisis Monitor" viewBox="0 0 32 32" className="w-8 h-8 flex-shrink-0" fill="none">
            <rect width="32" height="32" rx="8" fill="#20808d" fillOpacity="0.18"/>
            <path d="M8 22 L8 14 L12 17 L16 10 L20 15 L24 8" stroke="#20808d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="24" cy="8" r="1.5" fill="#e05260"/>
          </svg>
          <div className="mr-auto min-w-0">
            <div className="text-sm font-bold text-slate-100 leading-tight truncate">AU Supply Crisis Monitor</div>
            <div className="text-[10px] text-slate-500 leading-tight hidden sm:block">Hormuz 2026 · Live ABS · Auto-updated daily · Public</div>
          </div>
          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700/50">
            {NAV.map(([key,label,Icon])=>(
              <button key={key} onClick={()=>setViewMode(key)} data-testid={`nav-${key}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${viewMode===key?"bg-slate-700 text-slate-100":"text-slate-400 hover:text-slate-200"}`}>
                <Icon className="w-3 h-3"/>{label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 flex-wrap justify-end">
            <button
              onClick={()=>setShowHormuzMap(true)}
              title="View live AIS shipping traffic in the Strait of Hormuz"
              className="flex items-center gap-1.5 text-xs bg-red-950/60 border border-red-800/60 hover:bg-red-900/70 hover:border-red-600/80 px-2 py-1 rounded-lg transition-all cursor-pointer group"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"/>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"/>
              </span>
              <Zap className="w-3 h-3 text-red-400 group-hover:text-red-300"/>
              <span className="text-red-300 group-hover:text-red-200 hidden sm:inline font-medium">Hormuz Active</span>
              <span className="text-red-500/70 group-hover:text-red-400 hidden sm:inline text-[10px]">▶ Snapshot</span>
            </button>
            <button
              onClick={()=>setShowShipTracker(v=>!v)}
              title="Track incoming shipments to Australian ports via AIS"
              className={`flex items-center gap-1.5 text-xs border px-2 py-1 rounded-lg transition-all cursor-pointer group ${
                showShipTracker
                  ? "bg-teal-800/60 border-teal-600/60 hover:bg-teal-700/70"
                  : "bg-slate-800/60 border-slate-700/60 hover:bg-slate-700/70"
              }`}
            >
              <Ship className="w-3 h-3 text-teal-400 group-hover:text-teal-300"/>
              <span className="text-teal-300 group-hover:text-teal-200 hidden sm:inline font-medium">AU Shipments</span>
              <span className={`hidden sm:inline text-[10px] ${showShipTracker?"text-teal-400":"text-slate-500"}`}>{showShipTracker?"▼ Hide":"▶ Track"}</span>
            </button>
          </div>
        </div>
        {/* Mobile nav */}
        <div className="md:hidden flex gap-1 px-4 pb-2 overflow-x-auto scrollbar-hide" style={{scrollbarWidth:"none",msOverflowStyle:"none"}}>
          {NAV.map(([key,label,Icon])=>(
            <button key={key} onClick={()=>setViewMode(key)} data-testid={`mob-nav-${key}`}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md font-medium whitespace-nowrap flex-shrink-0 transition-colors ${viewMode===key?"bg-slate-700 text-slate-100":"text-slate-400 hover:text-slate-200"}`}>
              <Icon className="w-3 h-3"/>{label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-5">
        {/* Crisis banner */}
        <div className="rounded-xl border border-red-800/70 bg-gradient-to-r from-red-950/80 via-slate-900/80 to-slate-900/80 px-4 py-3 mb-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5"/>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <span className="text-sm font-bold text-red-300">Strait of Hormuz — Active Disruption Since Feb 28 2026</span>
                <Badge className="text-[10px] bg-red-900 text-red-300 border-red-700">Op. Epic Fury</Badge>
              </div>
              <div className="text-xs text-slate-400 leading-relaxed">
                Gulf oil exports down <span className="text-red-300 font-semibold">60–71%</span>. Iraq exports collapsed <span className="text-red-300 font-semibold">89%</span>. Kuwait zero crude April (first since 1991). QatarEnergy halted urea/LNG Mar 3.
                AU diesel: <span className="text-red-300 font-semibold">{RESERVE_DAYS.diesel.current} days</span> · jet fuel: <span className="text-red-300 font-semibold">{RESERVE_DAYS["jet-fuel"].current} days</span> (IEA requires 90) · Saudi urea to AU: <span className="text-red-300 font-semibold">−99.6% YoY</span>.
                IEA warns critical inventory levels possible <span className="text-amber-400 font-semibold">Jul–Aug 2026</span>.
              </div>
              <div className="flex flex-wrap gap-3 mt-1.5">
                <a href="https://en.wikipedia.org/wiki/2026_Strait_of_Hormuz_crisis" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline">Wikipedia — Crisis</a>
                <a href="https://www.abc.net.au/news/2026-04-15/australian-fertiliser-manufacturing-after-iran-war-deficit/106559278" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline">ABC — Fertiliser deficit</a>
                <a href="https://www.commbank.com.au/articles/newsroom/2026/05/disruption-drives-up-farm-costs.html" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline">CommBank — Farm costs</a>
                <a href="https://oilprice.com/Energy/Energy-General/Australias-Fuels-Dependence-Turns-Into-a-Crisis.html" target="_blank" rel="noopener noreferrer" className="text-xs text-teal-400 hover:underline">OilPrice — Fuel crisis</a>
              </div>
            </div>
          </div>
        </div>

        {/* ── AU Incoming Shipment Tracker (inline below Hormuz button) ── */}
        {showShipTracker&&(
          <div className="mb-4 rounded-2xl border border-teal-800/50 bg-slate-900/80 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-800 bg-gradient-to-r from-teal-950/60 via-slate-900 to-slate-900">
              <div className="flex items-center gap-2">
                <Ship className="w-4 h-4 text-teal-400"/>
                <span className="text-sm font-bold text-teal-300">AU Incoming Shipment Tracker</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-900/60 text-teal-400 border border-teal-700/40 font-medium">AIS LIVE</span>
              </div>
              <button onClick={()=>setShowShipTracker(false)} className="text-slate-400 hover:text-slate-100 transition-colors text-lg font-light leading-none" aria-label="Close">✕</button>
            </div>
            <div className="px-4 py-4">
              <ShipmentTracker/>
            </div>
          </div>
        )}
        <SyncBar syncs={syncs} onRefresh={()=>syncMutation.mutate()} isSyncing={syncMutation.isPending||(syncResp?.inProgress??false)}/>
        {allRows.length===0&&!rowsLoading&&<div className="text-xs bg-amber-950/40 border border-amber-700/50 text-amber-300 rounded-lg px-3 py-2 mb-4">Showing reference data — click "Sync Now" to fetch latest ABS live data.</div>}
        {rowsLoading&&<div className="text-xs text-slate-500 flex items-center gap-2 mb-4"><Loader2 className="w-3 h-3 animate-spin"/>Loading live data…</div>}

        {/* Always-visible sector alert strip */}
        <SectorAlertStrip/>

        {/* ── OVERVIEW ── */}
        {viewMode==="overview"&&(
          <>
            <OverviewStats/>
            <BrentCrudeMonitor/>
            <CrisisTimeline/>
            <NationalReservesPanel/>
          </>
        )}

        {/* ── COMMODITIES ── */}
        {viewMode==="commodities"&&(
          <>
            <OverviewStats/>
            <div className="flex items-center justify-between mb-4">
              <div className="flex gap-1 bg-slate-800/50 p-1 rounded-lg border border-slate-700/50">
                {(["all","fertilizer","petroleum"] as const).map(key=>(
                  <button key={key} onClick={()=>setActiveTab(key)} data-testid={`tab-${key}`}
                    className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${activeTab===key?"bg-slate-700 text-slate-100":"text-slate-400 hover:text-slate-200"}`}>
                    {key==="all"?"All Commodities":key.charAt(0).toUpperCase()+key.slice(1)}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={()=>setExpandedIds(new Set(displayed.map(s=>s.id)))} className="text-xs text-slate-400 hover:text-slate-200">Expand all</button>
                <span className="text-slate-600">·</span>
                <button onClick={()=>setExpandedIds(new Set())} className="text-xs text-slate-400 hover:text-slate-200">Collapse</button>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {displayed.map(sub=>(
                <CommodityCard key={sub.id} sub={sub} allRows={allRows} expanded={expandedIds.has(sub.id)} onToggle={()=>toggleExpanded(sub.id)}/>
              ))}
            </div>
          </>
        )}

        {/* ── SECTORS ── */}
        {viewMode==="sectors"&&(
          <>
            <div className="mb-4 p-3 rounded-lg bg-amber-950/20 border border-amber-800/40">
              <div className="text-xs text-slate-400 leading-relaxed">
                Real-world sector impact assessments from the Strait of Hormuz supply disruption (Feb 28 2026). Sources: <a href="https://www.commbank.com.au/articles/newsroom/2026/05/disruption-drives-up-farm-costs.html" className="text-teal-400 hover:underline" target="_blank" rel="noopener noreferrer">CommBank farm costs</a> · <a href="https://www.sbs.com.au/news/article/australia-fuel-shortage-2026/zl0grg7ey" className="text-teal-400 hover:underline" target="_blank" rel="noopener noreferrer">SBS fuel shortage</a> · <a href="https://www.csis.org/analysis/iran-fertilizer-and-food-security-risks-impacts-and-policy-responses" className="text-teal-400 hover:underline" target="_blank" rel="noopener noreferrer">CSIS fertilizer security</a> · <a href="https://www.fao.org/agrifood-economics/news/news-detail/ru/c/1758248/" className="text-teal-400 hover:underline" target="_blank" rel="noopener noreferrer">FAO Apr 2026</a>
              </div>
            </div>
            <SectorImpactPanel/>
          </>
        )}

        {/* ── RESERVES ── */}
        {viewMode==="reserves"&&(
          <>
            <NationalReservesPanel/>
            <div className="flex flex-col gap-3 mt-2">
              {subcategories.filter(s=>RESERVE_DAYS[s.id]?.current>0||s.commodity==="petroleum").map(sub=>{
                const pvr=PROJECTED_VS_RECEIVED[sub.id];
                if(!pvr)return null;
                const demandSeries=buildDemandSeries(sub.id);
                const domesticPct=DOMESTIC_PCT[sub.id]??0;
                return(
                  <div key={sub.id} className="rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      {sub.commodity==="fertilizer"?<Sprout className="w-4 h-4 text-emerald-400"/>:<Flame className="w-4 h-4 text-amber-400"/>}
                      <span className="text-sm font-semibold text-slate-100">{sub.name}</span>
                      <span className="ml-auto text-xs text-slate-500">2024–2026 + Sep projection</span>
                    </div>
                    <FullHistoryChart monthlyData={sub.monthlyData} demandSeries={demandSeries} domesticPct={domesticPct} commodityId={sub.id}/>
                    {RESERVE_DAYS[sub.id]?.current>0&&<div className="mt-3"><ReserveGauge id={sub.id}/></div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ── CITIZENS GUIDE ── */}
        {viewMode==="citizens"&&(
          <CitizensGuidePanel/>
        )}

        {/* ── FUEL SHORTAGE MAP ── */}
        {viewMode==="shortage"&&(
          <FuelShortagePanel/>
        )}

        {/* Donation */}
        <div className="mt-10 mx-auto max-w-xl">
          <div className="rounded-xl border border-yellow-500/30 bg-yellow-950/20 p-5 flex flex-col sm:flex-row items-center gap-5">
            <img src={bmcQr} alt="Buy Me a Coffee QR code" className="w-24 h-24 sm:w-28 sm:h-28 rounded-lg flex-shrink-0 border border-yellow-500/40" />
            <div className="flex-1 text-center sm:text-left">
              <p className="text-yellow-400 font-semibold text-sm mb-1">☕ Support This Dashboard</p>
              <p className="text-slate-400 text-xs mb-3 leading-relaxed">This dashboard is free and runs on no funding. If it's useful to you — as a farmer, trucker, business owner, or concerned citizen — consider buying a coffee to keep the server running and data flowing.</p>
              <a
                href="https://buymeacoffee.com/discobiscuitaus"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-bold text-sm transition-colors"
              >
                <span>☕</span> buymeacoffee.com/discobiscuitaus
              </a>
            </div>
          </div>
        </div>

        {/* Disclaimer */}
        <div className="mt-8 rounded-xl border border-slate-700/50 bg-slate-900/40 px-4 py-3.5 text-[10px] text-slate-500 leading-relaxed space-y-1.5">
          <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-xs mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            Disclaimer — Scenario Modelling &amp; Information Tool Only
          </div>
          <p>
            All figures presented on this site are modelled estimates derived from publicly available sources and may differ from official government statistics.
            This tool is built for situational awareness and public education — it is <strong className="text-slate-400">not</strong> financial, investment, trading, or operational advice.
            No commercial, investment, or policy decisions should be made based solely on information shown here.
          </p>
          <p>
            Data may be delayed, incomplete, or sourced from material that has since been updated.
            Vessel tracking data — including cargo type, volume, destination, and classification — is inferred from AIS broadcasts and port schedules and is <strong className="text-slate-400">not confirmed</strong> by operators or authorities.
            Supply days figures are estimates based on publicly reported national consumption rates.
          </p>
          <p>
            The creators of this site and its data providers accept no liability for any loss, damage, or decision made in reliance on information displayed here.
            For authoritative fuel security data, always consult official government sources including the{" "}
            <a href="https://www.dcceew.gov.au/energy/security/australias-fuel-security/minimum-stockholding-obligation/statistics"
              target="_blank" rel="noopener noreferrer"
              className="text-teal-600 hover:text-teal-400 hover:underline transition-colors">
              DCCEEW MSO Statistics
            </a>
            {" "}and the{" "}
            <a href="https://www.iea.org/topics/energy-security"
              target="_blank" rel="noopener noreferrer"
              className="text-teal-600 hover:text-teal-400 hover:underline transition-colors">
              IEA Energy Security
            </a>
            {" "}portal.
          </p>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-slate-800 text-xs text-slate-600 flex flex-wrap gap-3 justify-between">
          <div className="flex items-center gap-1.5"><Clock className="w-3 h-3"/>Auto-syncs daily from <a href="https://data.api.abs.gov.au" className="text-teal-700 hover:underline" target="_blank">ABS MERCH_IMP</a> — no input required</div>
          <div>Sources: <a href="https://www.sbs.com.au/news/article/australia-fuel-shortage-2026/zl0grg7ey" className="text-teal-700 hover:underline" target="_blank">SBS</a> · <a href="https://www.rabobank.com.au/news/media-releases/2025/supply-fragility-creating-volatility-in-urea-market-rabobank-report" className="text-teal-700 hover:underline" target="_blank">Rabobank</a> · <a href="https://en.wikipedia.org/wiki/2026_Strait_of_Hormuz_crisis" className="text-teal-700 hover:underline" target="_blank">Wikipedia</a> · <a href="https://www.csis.org/analysis/iran-fertilizer-and-food-security-risks-impacts-and-policy-responses" className="text-teal-700 hover:underline" target="_blank">CSIS</a> · <a href="https://budget.gov.au/content/01-fuel-supply-and-security.htm" className="text-teal-700 hover:underline" target="_blank">Budget 2026-27</a></div>
        </div>
      </div>

      {/* ─ Hormuz AIS Shipping Traffic Snapshot Modal ─ */}
      {showHormuzMap&&(
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-3 sm:p-6"
          style={{backgroundColor:"rgba(0,0,0,0.85)",backdropFilter:"blur(4px)"}}
          onClick={()=>setShowHormuzMap(false)}
        >
          <div
            className="relative w-full max-w-5xl bg-slate-900 border border-red-800/60 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            style={{maxHeight:"90vh"}}
            onClick={e=>e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-gradient-to-r from-red-950/80 via-slate-900 to-slate-900 flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"/>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"/>
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <Ship className="w-4 h-4 text-red-400"/>
                    <span className="text-sm font-bold text-red-300">Strait of Hormuz — AIS Shipping Traffic Snapshot</span>
                    <Badge className="text-[10px] bg-slate-800 text-slate-400 border-slate-600">SNAPSHOT</Badge>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">Documented vessel positions by period. Crisis active since Feb 28 2026 — use the timeline to step through traffic decline.</p>
                </div>
              </div>
              <button onClick={()=>setShowHormuzMap(false)} className="text-slate-400 hover:text-slate-100 transition-colors text-xl font-light leading-none ml-4 flex-shrink-0" aria-label="Close">✕</button>
            </div>
            <div className="flex flex-wrap gap-4 px-4 py-2 bg-slate-950/60 border-b border-slate-800/60 text-[11px] flex-shrink-0">
              <span className="text-slate-400">Gulf oil exports: <span className="text-red-400 font-semibold">−60–71%</span></span>
              <span className="text-slate-400">Iraq: <span className="text-red-400 font-semibold">−89%</span></span>
              <span className="text-slate-400">Kuwait crude: <span className="text-red-400 font-semibold">ZERO (Apr 2026)</span></span>
              <span className="text-slate-400">AU diesel reserves: <span className="text-amber-400 font-semibold">{RESERVE_DAYS.diesel.current} days</span></span>
              <span className="text-slate-400">Op. Epic Fury: <span className="text-red-400 font-semibold">Feb 28 2026</span></span>
            </div>
            <div className="relative flex-1 bg-slate-950" style={{minHeight:"460px"}}>
              <HormuzMapEmbed/>
            </div>
            <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-slate-800 bg-slate-950/60 text-[11px] flex-shrink-0">
              <span className="text-slate-500">Open full AIS map:</span>
              <a href="https://www.marinetraffic.com/en/ais/home/centerx:56.2/centery:26.6/zoom:9" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 hover:underline transition-colors flex items-center gap-1"><Ship className="w-3 h-3"/>MarineTraffic</a>
              <a href="https://www.vesselfinder.com/?zoom=9&lat=26.6&lon=56.2" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 hover:underline transition-colors flex items-center gap-1"><Ship className="w-3 h-3"/>VesselFinder</a>
              <a href="https://www.marinevesseltraffic.com/HORMUZ-STRAIT/ship-traffic-tracker" target="_blank" rel="noopener noreferrer" className="text-teal-400 hover:text-teal-300 hover:underline transition-colors flex items-center gap-1"><Ship className="w-3 h-3"/>MarineVesselTraffic</a>
              <span className="ml-auto text-slate-600">Click outside or ✕ to close</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─ Hormuz AIS Map Embed ─ */
// Monthly snapshot context data — updated by cron on the 1st of each month.
// Vessel positions shown on VesselFinder live map; this panel shows the crisis timeline context.

type MonthSnapshot = {
  id: string;
  label: string;
  date: string;
  trafficPct: number;   // % of pre-crisis baseline
  tankerCount: number;
  transitCount: number;
  headline: string;
  keyEvents: string[];
  sources: string[];
};

// ── MONTHLY SNAPSHOT DATA ────────────────────────────────────────────────────
// Last updated: Jun 20 2026 (manual update — MOU signed, Hormuz partially reopening)
const MONTHLY_SNAPSHOTS: MonthSnapshot[] = [
  {
    id: "jan2026",
    label: "Jan 2026",
    date: "January 2026",
    trafficPct: 100,
    tankerCount: 320,
    transitCount: 105,
    headline: "Pre-crisis — normal Hormuz operations",
    keyEvents: [
      "~100+ tankers per day transiting Hormuz",
      "Kuwait, Iraq, Saudi Arabia all exporting at full capacity",
      "Australia receiving normal diesel, LPG and fertilizer volumes",
      "War-risk insurance premiums at baseline levels",
    ],
    sources: ["S&P Global", "Lloyd's List", "IEA"],
  },
  {
    id: "feb2026",
    label: "Feb 28",
    date: "28 February 2026 — Crisis Day 1",
    trafficPct: 55,
    tankerCount: 240,
    transitCount: 12,
    headline: "Op. Epic Fury begins — traffic falls 40–50% within hours",
    keyEvents: [
      "US/Israel strikes on Iranian naval assets trigger IRGC response",
      "~240 vessels cluster near Hormuz entrance; most anchor in Gulf of Oman",
      "War-risk insurance suspended for Hormuz transits by Lloyd's underwriters",
      "Crude tankers begin emergency anchoring at Fujairah (UAE Indian Ocean port)",
      "Australia issues first fuel security alert — 45 days diesel reserve",
    ],
    sources: ["S&P Global Mar 1 2026", "Reuters Mar 8 2026", "CNBC Mar 18 2026"],
  },
  {
    id: "mar2026",
    label: "Mar 2026",
    date: "March 2026",
    trafficPct: 20,
    tankerCount: 150,
    transitCount: 21,
    headline: "150+ tankers anchored in Gulf; only 21 transited all month",
    keyEvents: [
      "Only 21 tankers transited total month vs 3,000+ in January (CNBC Mar 18)",
      "Greek VLCC SMYRNI transits Mar 14 with Saudi crude — AIS off 10 days prior",
      "SCI (India) LPG carriers allowed through under bilateral corridor arrangement",
      "Pakistan-flagged KARACHI — first non-Iranian AIS-confirmed cargo transit",
      "Kuwait crude exports: ZERO. Iraq: −89% YoY (S&P Global)",
      "Australia diesel reserves fall to 38 days; NEMA convenes emergency briefing",
    ],
    sources: ["CNBC Mar 18 2026", "S&P Global", "Lloyd's List Apr 7 2026"],
  },
  {
    id: "apr2026",
    label: "Apr 2026",
    date: "April 2026",
    trafficPct: 8,
    tankerCount: 80,
    transitCount: 8,
    headline: "25 Iranian tankers depart; 7 turned back, 2 seized in Indian Ocean",
    keyEvents: [
      "25 Iranian crude tankers attempted departure — 7 intercepted by US Navy",
      "2 non-Iranian vessels seized by IRGC in Indian Ocean",
      "Kuwait crude exports remain at ZERO for second month running",
      "Iraq exports down 89%; Ras Tanura (Saudi) −99.6% YoY to Australia",
      "Fujairah anchorage swells to 400+ vessels — largest maritime anchorage ever recorded",
      "Australia diesel reserves: 32 days. ACCC authorises emergency fuel rationing framework",
    ],
    sources: ["Lloyd's List Apr 7 2026", "NPR May 15 2026", "ACCC"],
  },
  {
    id: "may2026",
    label: "May 2026",
    date: "May 2026",
    trafficPct: 4,
    tankerCount: 60,
    transitCount: 5,
    headline: "First convoy attempt; Ocean Koi seized; Iranian selective passage for Chinese buyers",
    keyEvents: [
      "OCEAN KOI tanker seized by Iran 38nm NE of Fujairah — 22 crew detained (NPR May 15)",
      "Iran begins selectively allowing Chinese state-owned tankers through",
      "First major convoy movement since crisis — 5 vessels under Iranian escort",
      "Cape of Good Hope route now standard — adds 28 days and ~$3M/voyage",
      "Australia LNG imports 40% below contract volumes; fertilizer supply critical",
      "Federal Government activates strategic petroleum reserve drawdown",
    ],
    sources: ["NPR May 15 2026", "Lloyd's List", "ACCC", "Dept. of Energy"],
  },
  {
    id: "jun2026",
    label: "Jun 2026",
    date: "June 2026 — Current",
    trafficPct: 20,
    tankerCount: 180,
    transitCount: 25,
    headline: "US-Iran MOU signed Jun 18 — Hormuz partially reopening. 25 vessels crossed Jun 19. AU diesel 39 days (improving).",
    keyEvents: [
      "Jun 18–19: US-Iran 14-point MOU signed; CENTCOM lifts US naval blockade on Hormuz",
      "Jun 19: 25 commercial vessels crossed including 4 Saudi supertankers (8M bbl crude) — highest since Jun 2",
      "~550 ships backlogged in Persian Gulf; ~80 mines blocking central Hormuz lane — mine clearing underway (INTERTANKO)",
      "60-day toll-free window active to ~Aug 17; Iran signals transit fees after window expires",
      "Brent crude ~$83/bbl — down from $126/bbl wartime peak; Goldman Q4 forecast $80/bbl",
      "AU: Diesel 39d (+7d), Petrol 44d, Jet 32d (WARNING). 164 station outages. Fuel excise cut expires Jun 30.",
      "Experts warn supply normalisation 12–18 months away despite MOU; IEA SPR at 1990-era lows",
    ],
    sources: [
      "https://www.cnbc.com/2026/06/19/iran-oil-tanker-traffic-strait-hormuz-gulf-vlcc.html",
      "https://www.theguardian.com/world/2026/jun/19/normal-shipping-will-not-resume-in-strait-of-hormuz-until-mines-cleared",
      "https://www.cnbc.com/2026/06/18/strait-hormuz-reopening-shipping-oil.html",
      "https://www.perthnow.com.au/news/prime-minister-anthony-albanese-is-expected-to-make-a-decision-on-fuel-excise-extension-in-coming-days-c-22459814",
    ],
  },
  {
    id: "jul2026", label: "Jul 2026", date: "July 2026 — Current",
    trafficPct: 12, tankerCount: 90, transitCount: 6,
    headline: "MOU Collapsed Jul 8: Iran hits vessels, US strikes Iran, Arab Gulf states targeted — Hormuz re-closing.",
    keyEvents: [
      "Jun 17–18: US-Iran 14-point MOU signed; Strait partially reopened with 25 vessels crossing",
      "Jun 25–26: Iran strikes shipping — first MOU breach; US retaliates; Iran targets Bahrain and Kuwait (first Arab Gulf involvement)",
      "Late Jun: Iran warns MOU collapse during Israel-Lebanon talks; Arab capitals recalibrate",
      "Jul 7: Iran hits three vessels; US cancels Iran's oil waiver — a core MOU pillar undermined",
      "Jul 8–9: US airstrikes inside Iran; Iran strikes US bases in Bahrain and Kuwait; Trump declares ceasefire over",
      "Early Jul: Hormuz traffic slows sharply again; MOU collapse mainstream in policy and media",
    ],
    sources: [
      "https://abcnews.com/Politics/us-iran-ceasefire-mou-broke-timeline/story?id=134622392",
      "https://www.youtube.com/watch?v=MMslqAgoeLs",
      "https://oilprice.com/Energy/Crude-Oil/Half-Open-Half-Closed-Strait-of-Hormuz-Baffles-Oil-Markets.html",
      "https://www.reuters.com/business/energy/",
    ],
  },
];

function HormuzMapEmbed() {
  const [activeTab, setActiveTab] = useState<"live"|"timeline">("live");
  const [periodIdx, setPeriodIdx] = useState(MONTHLY_SNAPSHOTS.length - 1);

  const period = MONTHLY_SNAPSHOTS[periodIdx];
  const barColor = period.trafficPct >= 80 ? "#22c55e"
    : period.trafficPct >= 40 ? "#f59e0b"
    : period.trafficPct >= 15 ? "#f97316"
    : "#ef4444";

  // VesselFinder iframe URL — Hormuz / Gulf of Oman centred, zoom 8
  const VF_URL = "https://www.vesselfinder.com/aismap?zoom=8&lat=25.8&lon=56.6&width=100%25&height=100%25&names=true&track=false&fleet=false&fleet_name=false&clicktoact=false&store_pos=false";

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: "#0f172a" }}>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-0 bg-slate-950/90 border-b border-slate-800/60 px-3 z-10">
        <button
          onClick={() => setActiveTab("live")}
          className={`px-4 py-2 text-[11px] font-medium border-b-2 transition-colors ${
            activeTab === "live"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          🔴 LIVE Vessels
        </button>
        <button
          onClick={() => setActiveTab("timeline")}
          className={`px-4 py-2 text-[11px] font-medium border-b-2 transition-colors ${
            activeTab === "timeline"
              ? "border-teal-500 text-teal-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          📅 Crisis News Timeline
        </button>
        <div className="ml-auto text-[10px] text-slate-600 pr-1 hidden sm:block">
          Live map: VesselFinder · Timeline updated monthly
        </div>
      </div>

      {/* ── LIVE tab — VesselFinder iframe ───────────────────────────────── */}
      {activeTab === "live" && (
        <div className="flex-1 relative flex flex-col">
          {/* Info strip above map */}
          <div className="flex-shrink-0 flex items-center gap-3 px-3 py-1.5 bg-slate-900/80 border-b border-slate-800/40 text-[10px]">
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"/>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"/>
            </span>
            <span className="text-emerald-400 font-medium">LIVE — Real vessel positions via VesselFinder AIS</span>
            <span className="text-slate-500">Strait of Hormuz &amp; Gulf of Oman · Click any vessel for details</span>
            <span className="ml-auto text-slate-600">
              Current traffic: <span className="text-red-400 font-semibold">~2% of pre-crisis</span>
            </span>
          </div>
          {/* VesselFinder iframe — fills remaining space */}
          <iframe
            src={VF_URL}
            className="flex-1 w-full border-0"
            title="VesselFinder — Strait of Hormuz Live AIS"
            allowFullScreen
            loading="lazy"
          />
          <div className="flex-shrink-0 px-3 py-1 bg-slate-950/80 border-t border-slate-800/40 text-[9px] text-slate-600 flex items-center gap-3">
            <span>Live data by <a href="https://www.vesselfinder.com" target="_blank" rel="noopener noreferrer" className="text-teal-600 hover:text-teal-400">VesselFinder</a></span>
            <span>·</span>
            <span>AIS coverage may be limited in conflict zones — sparse traffic IS the crisis</span>
            <span className="ml-auto">Switch to Crisis News Timeline tab for month-by-month context →</span>
          </div>
        </div>
      )}

      {/* ── TIMELINE tab — snapshot context data ─────────────────────────── */}
      {activeTab === "timeline" && (
        <div className="flex-1 overflow-y-auto" style={{ background: "#0f172a" }}>
          {/* Period selector */}
          <div className="sticky top-0 z-10 bg-slate-950/95 border-b border-slate-800/60 px-3 py-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mr-1">Period:</span>
              {MONTHLY_SNAPSHOTS.map((s, i) => {
                const isActive = i === periodIdx;
                const c = s.trafficPct >= 80 ? "bg-emerald-500" : s.trafficPct >= 40 ? "bg-amber-500" : s.trafficPct >= 15 ? "bg-orange-500" : "bg-red-500";
                return (
                  <button
                    key={s.id}
                    onClick={() => setPeriodIdx(i)}
                    className={`flex flex-col items-center px-2.5 py-1 rounded text-[10px] font-medium transition-all border ${
                      isActive
                        ? "border-teal-500/60 bg-teal-900/40 text-teal-300"
                        : "border-slate-700/50 bg-slate-900/60 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                    }`}
                  >
                    <span>{s.label}</span>
                    <div className="mt-0.5 w-full h-1 rounded-full bg-slate-800 overflow-hidden">
                      <div className={`h-1 rounded-full ${c}`} style={{ width: `${s.trafficPct}%` }}/>
                    </div>
                  </button>
                );
              })}
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={() => setPeriodIdx(i => Math.max(0, i - 1))} disabled={periodIdx === 0}
                  className="text-[10px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30">← Prev</button>
                <button onClick={() => setPeriodIdx(i => Math.min(MONTHLY_SNAPSHOTS.length - 1, i + 1))} disabled={periodIdx === MONTHLY_SNAPSHOTS.length - 1}
                  className="text-[10px] px-2 py-1 rounded border border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30">Next →</button>
              </div>
            </div>
          </div>

          {/* Period detail card */}
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">{period.date}</div>
                  <div className="text-sm font-bold text-slate-100">{period.headline}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-2xl font-black" style={{ color: barColor }}>{period.trafficPct}%</div>
                  <div className="text-[10px] text-slate-500">of pre-crisis traffic</div>
                </div>
              </div>
              {/* Traffic bar */}
              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                  <span>Tanker traffic vs Jan 2026 baseline</span>
                  <span>{period.transitCount} strait transits · {period.tankerCount} vessels in region</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${period.trafficPct}%`, background: barColor }}/>
                </div>
              </div>
            </div>

            {/* Key events */}
            <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
              <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-3">Key Events This Period</div>
              <ul className="space-y-2">
                {period.keyEvents.map((ev, i) => (
                  <li key={i} className="flex items-start gap-2 text-[11px] text-slate-300">
                    <span className="flex-shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full" style={{ background: barColor }}/>
                    {ev}
                  </li>
                ))}
              </ul>
            </div>

            {/* Impact on Australia */}
            <div className="rounded-lg border border-amber-800/30 bg-amber-950/20 p-4">
              <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-2">Australia Impact — {period.date}</div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-lg font-black" style={{ color: barColor }}>{period.trafficPct}%</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">Gulf supply<br/>delivered</div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-lg font-black text-amber-400">{period.transitCount}</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">tanker<br/>transits</div>
                </div>
                <div className="bg-slate-900/60 rounded p-2">
                  <div className="text-lg font-black text-red-400">+28d</div>
                  <div className="text-[9px] text-slate-500 mt-0.5">Cape route<br/>delay</div>
                </div>
              </div>
            </div>

            {/* Sources */}
            <div className="text-[9px] text-slate-600">
              Sources: {period.sources.join(" · ")} · Data updated monthly on the 1st
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

