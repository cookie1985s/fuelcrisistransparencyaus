// Vercel serverless entry point — wraps the Express app
import type { VercelRequest, VercelResponse } from "@vercel/node";
import express from "express";
import { registerRoutes } from "../server/routes";
import { createServer } from "http";

// Build a one-off Express app for each cold-start
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const httpServer = createServer(app);
registerRoutes(httpServer, app);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Let Express handle the request
  app(req as any, res as any);
}
