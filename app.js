import express from "express";
import cors from "cors";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistrationRouter } from "./routes/inscriereroutes.js";
import { createFeedbackRouter } from "./routes/feedbackroutes.js";
import { get } from "./database.js";

const directory = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ db, cvAccessToken = process.env.CV_ACCESS_TOKEN || "", publicDirectory = path.join(directory, "public"), frontendOrigins = process.env.FRONTEND_ORIGIN || "" }) {
  const app = express();
  app.disable("x-powered-by");
  const allowed = new Set(frontendOrigins.split(",").map(value => value.trim()).filter(Boolean));
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowed.has(origin) || (!allowed.size && process.env.NODE_ENV !== "production")) }));
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", async (_request, response) => {
    await get(db, "SELECT 1 AS ok");
    response.set("Cache-Control", "no-store").json({ ok: true });
  });
  app.use("/api/inscriere", createRegistrationRouter(db, cvAccessToken));
  app.use("/api/feedback", createFeedbackRouter(db));
  app.use("/api", (_request, response) => response.status(404).json({ ok: false, eroare: "Ruta API nu există." }));
  app.get("/inscrieri.html", (_request, response) => response.redirect("/index.html"));
  app.use(express.static(publicDirectory));
  app.use((error, _request, response, _next) => {
    let status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    let message = status !== 500 ? error.message : "Datele nu au putut fi salvate. Încearcă din nou mai târziu.";
    if (error instanceof multer.MulterError) {
      status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      message = error.code === "LIMIT_FILE_SIZE" ? "CV-ul poate avea maximum 5 MB." : "Trimite un singur CV PDF și câmpul date.";
    }
    if (error.type === "entity.parse.failed") message = "Corpul cererii nu conține JSON valid.";
    if (status === 500) console.error("Eroare la procesarea cererii:", error.code || "internă");
    response.status(status).json({ ok: false, eroare: message });
  });
  return app;
}
