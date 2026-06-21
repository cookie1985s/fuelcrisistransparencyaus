import BetterSqlite3 from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@shared/schema";
import { eq, and, gte } from "drizzle-orm";

const sqlite = new BetterSqlite3("data.db");
export const db = drizzle(sqlite, { schema });

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS import_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sitc_code TEXT NOT NULL,
    country_code TEXT NOT NULL,
    time_period TEXT NOT NULL,
    aud_value REAL NOT NULL,
    fetched_at TEXT NOT NULL,
    UNIQUE(sitc_code, country_code, time_period)
  );
  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sitc_code TEXT NOT NULL UNIQUE,
    last_sync_at TEXT NOT NULL,
    latest_period TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ok',
    error_msg TEXT
  );
  CREATE TABLE IF NOT EXISTS alert_thresholds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commodity TEXT NOT NULL,
    subcategory TEXT NOT NULL,
    threshold_pct REAL NOT NULL DEFAULT 15,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS dismissed_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_key TEXT NOT NULL UNIQUE,
    dismissed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fuel_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suburb TEXT NOT NULL,
    state TEXT NOT NULL,
    fuel_type TEXT NOT NULL,
    status TEXT NOT NULL,
    station_name TEXT,
    note TEXT,
    reported_at TEXT NOT NULL,
    lat REAL,
    lng REAL
  );
`);

export interface IStorage {
  // Import data
  upsertImportRows(rows: { sitcCode: string; countryCode: string; timePeriod: string; audValue: number }[]): void;
  getImportData(sitcCode: string, countryCode: string): schema.ImportDataRow[];
  getImportDataMulti(sitcCodes: string[], countryCode: string): schema.ImportDataRow[];

  // Sync log
  getSyncLogs(): schema.SyncLog[];
  upsertSyncLog(sitcCode: string, latestPeriod: string, status: string, errorMsg?: string): void;

  // Alerts
  getAlertThresholds(): schema.AlertThreshold[];
  upsertAlertThreshold(data: schema.InsertAlertThreshold): schema.AlertThreshold;
  getDismissedAlerts(): schema.DismissedAlert[];
  dismissAlert(alertKey: string): schema.DismissedAlert;
  restoreAlert(alertKey: string): void;

  // Fuel shortage crowd reports
  addFuelReport(data: schema.InsertFuelReport): schema.FuelReport;
  getFuelReports(limitHours?: number): schema.FuelReport[];
  getFuelReportCount(): number;
}

export class Storage implements IStorage {
  upsertImportRows(rows: { sitcCode: string; countryCode: string; timePeriod: string; audValue: number }[]): void {
    const now = new Date().toISOString();
    const stmt = sqlite.prepare(`
      INSERT INTO import_data (sitc_code, country_code, time_period, aud_value, fetched_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(sitc_code, country_code, time_period) DO UPDATE SET
        aud_value = excluded.aud_value,
        fetched_at = excluded.fetched_at
    `);
    const insertMany = sqlite.transaction((rows: any[]) => {
      for (const r of rows) stmt.run(r.sitcCode, r.countryCode, r.timePeriod, r.audValue, now);
    });
    insertMany(rows);
  }

  getImportData(sitcCode: string, countryCode: string): schema.ImportDataRow[] {
    return sqlite.prepare(
      `SELECT * FROM import_data WHERE sitc_code = ? AND country_code = ? ORDER BY time_period ASC`
    ).all(sitcCode, countryCode) as schema.ImportDataRow[];
  }

  getImportDataMulti(sitcCodes: string[], countryCode: string): schema.ImportDataRow[] {
    if (!sitcCodes.length) return [];
    const placeholders = sitcCodes.map(() => "?").join(",");
    return sqlite.prepare(
      `SELECT * FROM import_data WHERE sitc_code IN (${placeholders}) AND country_code = ? ORDER BY time_period ASC`
    ).all(...sitcCodes, countryCode) as schema.ImportDataRow[];
  }

  getSyncLogs(): schema.SyncLog[] {
    return db.select().from(schema.syncLog).all();
  }

  upsertSyncLog(sitcCode: string, latestPeriod: string, status: string, errorMsg?: string): void {
    sqlite.prepare(`
      INSERT INTO sync_log (sitc_code, last_sync_at, latest_period, status, error_msg)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(sitc_code) DO UPDATE SET
        last_sync_at = excluded.last_sync_at,
        latest_period = excluded.latest_period,
        status = excluded.status,
        error_msg = excluded.error_msg
    `).run(sitcCode, new Date().toISOString(), latestPeriod, status, errorMsg ?? null);
  }

  getAlertThresholds(): schema.AlertThreshold[] {
    return db.select().from(schema.alertThresholds).all();
  }

  upsertAlertThreshold(data: schema.InsertAlertThreshold): schema.AlertThreshold {
    const existing = db.select().from(schema.alertThresholds)
      .where(eq(schema.alertThresholds.subcategory, data.subcategory)).get();
    if (existing) {
      return db.update(schema.alertThresholds)
        .set({ thresholdPct: data.thresholdPct, active: data.active })
        .where(eq(schema.alertThresholds.id, existing.id))
        .returning().get();
    }
    return db.insert(schema.alertThresholds).values(data).returning().get();
  }

  getDismissedAlerts(): schema.DismissedAlert[] {
    return db.select().from(schema.dismissedAlerts).all();
  }

  dismissAlert(alertKey: string): schema.DismissedAlert {
    return sqlite.prepare(`
      INSERT INTO dismissed_alerts (alert_key, dismissed_at) VALUES (?, ?)
      ON CONFLICT(alert_key) DO UPDATE SET dismissed_at = excluded.dismissed_at
    `).run(alertKey, new Date().toISOString()) && 
    db.select().from(schema.dismissedAlerts).where(eq(schema.dismissedAlerts.alertKey, alertKey)).get()!;
  }

  restoreAlert(alertKey: string): void {
    db.delete(schema.dismissedAlerts).where(eq(schema.dismissedAlerts.alertKey, alertKey)).run();
  }

  addFuelReport(data: schema.InsertFuelReport): schema.FuelReport {
    return sqlite.prepare(`
      INSERT INTO fuel_reports (suburb, state, fuel_type, status, station_name, note, reported_at, lat, lng)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.suburb, data.state, data.fuelType, data.status,
      data.stationName ?? null, data.note ?? null,
      data.reportedAt, data.lat ?? null, data.lng ?? null
    ) && sqlite.prepare(`SELECT * FROM fuel_reports ORDER BY id DESC LIMIT 1`).get() as schema.FuelReport;
  }

  getFuelReports(limitHours: number = 72): schema.FuelReport[] {
    const since = new Date(Date.now() - limitHours * 3600_000).toISOString();
    return sqlite.prepare(
      `SELECT * FROM fuel_reports WHERE reported_at >= ? ORDER BY reported_at DESC LIMIT 200`
    ).all(since) as schema.FuelReport[];
  }

  getFuelReportCount(): number {
    const row = sqlite.prepare(`SELECT COUNT(*) as cnt FROM fuel_reports`).get() as any;
    return row?.cnt ?? 0;
  }
}

export const storage = new Storage();
