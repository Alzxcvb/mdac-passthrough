import express from "express";
import cors from "cors";
import submitRouter from "./routes/submit";
import retrieveRouter from "./routes/retrieve";

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: allow all origins for now — lock down to Vercel domain in production via ALLOWED_ORIGIN env var
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(
  cors({
    origin: allowedOrigin
      ? (origin, callback) => {
          // Allow requests with no origin (e.g. curl, server-to-server) and the configured origin
          if (!origin || origin === allowedOrigin) {
            callback(null, true);
          } else {
            callback(new Error(`CORS: origin ${origin} not allowed`));
          }
        }
      : "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Body parser — increase limit in case large payloads are sent
app.use(express.json({ limit: "1mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// Routes
app.use("/api/submit", submitRouter);
app.use("/api/retrieve-qr", retrieveRouter);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handling middleware
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[server] Unhandled error:", err.message);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`[mdac-passthrough] Server running on port ${PORT}`);
});

export default app;
