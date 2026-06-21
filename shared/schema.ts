import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Cached ABS import data — one row per commodity+country+month
export const importData = sqliteTable("import_data", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sitcCode: text("sitc_code").notNull(),       // e.g. "562"
  countryCode: text("country_code").notNull(), // e.g. "TOT" or "SAUD"
  timePeriod: text("time_period").notNull(),   // e.g. "2024-01"
  audValue: real("aud_value").notNull(),        // AUD thousands
  fetchedAt: text("fetched_at").notNull(),
});

// Last sync timestamp per SITC code
export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sitcCode: text("sitc_code").notNull().unique(),
  lastSyncAt: text("last_sync_at").notNull(),
  latestPeriod: text("latest_period").notNull(),
  status: text("status").notNull().default("ok"), // "ok" | "error"
  errorMsg: text("error_msg"),
});

// Alert thresholds
export const alertThresholds = sqliteTable("alert_thresholds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  commodity: text("commodity").notNull(),
  subcategory: text("subcategory").notNull(),
  thresholdPct: real("threshold_pct").notNull().default(15),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

// Dismissed alerts
export const dismissedAlerts = sqliteTable("dismissed_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  alertKey: text("alert_key").notNull().unique(),
  dismissedAt: text("dismissed_at").notNull(),
});

// Community fuel shortage reports
export const fuelReports = sqliteTable("fuel_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  suburb: text("suburb").notNull(),
  state: text("state").notNull(),
  fuelType: text("fuel_type").notNull(),   // "unleaded" | "diesel" | "e10" | "lpg"
  status: text("status").notNull(),         // "dry" | "low" | "limited" | "ok"
  stationName: text("station_name"),
  note: text("note"),
  reportedAt: text("reported_at").notNull(),
  lat: real("lat"),
  lng: real("lng"),
});

export const insertFuelReportSchema = createInsertSchema(fuelReports).omit({ id: true });
export type InsertFuelReport = z.infer<typeof insertFuelReportSchema>;
export type FuelReport = typeof fuelReports.$inferSelect;

export const insertAlertThresholdSchema = createInsertSchema(alertThresholds).omit({ id: true });
export type InsertAlertThreshold = z.infer<typeof insertAlertThresholdSchema>;
export type AlertThreshold = typeof alertThresholds.$inferSelect;

export const insertDismissedAlertSchema = createInsertSchema(dismissedAlerts).omit({ id: true });
export type InsertDismissedAlert = z.infer<typeof insertDismissedAlertSchema>;
export type DismissedAlert = typeof dismissedAlerts.$inferSelect;

export type ImportDataRow = typeof importData.$inferSelect;
export type SyncLog = typeof syncLog.$inferSelect;
