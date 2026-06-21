/**
 * ABS MERCH_IMP API fetcher
 * Base URL: https://data.api.abs.gov.au/rest/data/ABS,MERCH_IMP,1.0.0/{SITC}.{COUNTRY}.{STATE}.{FREQ}
 * Returns AUD thousands (unit_mult=3 → multiply by 1000 for raw AUD)
 * We store as AUD thousands (the raw value from ABS) in the DB.
 */

const ABS_BASE = "https://data.api.abs.gov.au/rest/data/ABS,MERCH_IMP,1.0.0";

// All SITC codes we care about
export const SITC_CODES = ["272", "562", "333", "334", "335"] as const;
export type SitcCode = (typeof SITC_CODES)[number];

// Country codes we track per-commodity
export const COUNTRY_CODES = [
  "TOT",
  "SAUD", "QATA", "OMAN", "EGYP",
  "RKOR", "SING", "CHIN", "JAP", "INIA", "TAIW",
  "INDO", "MLAY",
  "CAN", "RUSS", "BELA", "FGMY", "MORO",
] as const;

export interface AbsRow {
  sitcCode: string;
  countryCode: string;
  timePeriod: string; // "YYYY-MM"
  audValue: number;   // AUD thousands
}

/**
 * Parse ABS CSV response into AbsRow[]
 * CSV header: DATAFLOW,COMMODITY_SITC,COUNTRY_ORIGIN,STATE_DEST,FREQ,TIME_PERIOD,OBS_VALUE,...
 */
function parseCsv(csv: string, sitcCode: string, countryCode: string): AbsRow[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map(s => s.trim().replace(/^"|"$/g, ""));
  const timeIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");

  if (timeIdx === -1 || valueIdx === -1) return [];

  const rows: AbsRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map(s => s.trim().replace(/^"|"$/g, ""));
    const timePeriod = cols[timeIdx];
    const raw = cols[valueIdx];
    if (!timePeriod || !raw || raw === "" || raw === "..") continue;
    const audValue = parseFloat(raw);
    if (isNaN(audValue)) continue;
    rows.push({ sitcCode, countryCode, timePeriod, audValue });
  }
  return rows;
}

/**
 * Fetch one SITC + country combination from ABS MERCH_IMP.
 * startPeriod defaults to 2024-01 to get a full 2+ year window.
 */
export async function fetchAbsSitcCountry(
  sitcCode: string,
  countryCode: string,
  startPeriod = "2024-01"
): Promise<AbsRow[]> {
  // Determine current period ceiling (ABS has ~2-month lag)
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = String(now.getMonth() + 1).padStart(2, "0"); // current month — ABS will return up to what's available
  const endPeriod = `${endYear}-${endMonth}`;

  const url = `${ABS_BASE}/${sitcCode}.${countryCode}.TOT.M?format=csv&startPeriod=${startPeriod}&endPeriod=${endPeriod}`;

  const resp = await fetch(url, {
    headers: { Accept: "text/csv" },
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) {
    if (resp.status === 404 || resp.status === 400) return []; // no data for this combination
    throw new Error(`ABS API ${resp.status} for ${sitcCode}/${countryCode}`);
  }

  const text = await resp.text();
  return parseCsv(text, sitcCode, countryCode);
}

/**
 * Fetch all country breakdowns for a single SITC code.
 * Fetches TOT + individual country codes in parallel (rate-limited to 5 concurrent).
 */
export async function fetchAbsSitcAll(sitcCode: string): Promise<{
  rows: AbsRow[];
  latestPeriod: string;
}> {
  const countries = [...COUNTRY_CODES];

  // Chunk into groups of 5 for polite parallelism
  const allRows: AbsRow[] = [];
  for (let i = 0; i < countries.length; i += 5) {
    const chunk = countries.slice(i, i + 5);
    const results = await Promise.allSettled(
      chunk.map(cc => fetchAbsSitcCountry(sitcCode, cc))
    );
    for (const r of results) {
      if (r.status === "fulfilled") allRows.push(...r.value);
    }
  }

  // Find latest period from TOT rows — sort first since ABS returns rows in random order
  const totRows = allRows.filter(r => r.countryCode === "TOT");
  const sortedTot = totRows.sort((a, b) => a.timePeriod.localeCompare(b.timePeriod));
  const latestPeriod = sortedTot.length > 0
    ? sortedTot[sortedTot.length - 1].timePeriod
    : "";

  return { rows: allRows, latestPeriod };
}

/**
 * Sync all SITC codes. Returns a summary.
 */
export async function syncAllSitcCodes(
  onProgress?: (sitcCode: string, status: "ok" | "error", msg?: string) => void
): Promise<{ sitcCode: string; latestPeriod: string; rowCount: number; status: string }[]> {
  const summary = [];
  for (const sitcCode of SITC_CODES) {
    try {
      const { rows, latestPeriod } = await fetchAbsSitcAll(sitcCode);
      onProgress?.(sitcCode, "ok");
      summary.push({ sitcCode, latestPeriod, rowCount: rows.length, status: "ok" });
    } catch (err: any) {
      const msg = err?.message || "Unknown error";
      onProgress?.(sitcCode, "error", msg);
      summary.push({ sitcCode, latestPeriod: "", rowCount: 0, status: `error: ${msg}` });
    }
  }
  return summary;
}
