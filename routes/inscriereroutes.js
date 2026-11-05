import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { createRegistrationControllers } from "../controllers/inscrierecontroller.js";
import { uploadCv } from "../middlewares/upload.js";
import { httpError } from "../errors.js";

export function createRegistrationRouter(db, cvAccessToken) {
  const router = Router();
  const controller = createRegistrationControllers(db);
  router.post("/", uploadCv, controller.creareInscriere);
  router.get("/:id/cv", (request, response, next) => {
    response.set("Cache-Control", "no-store");
    if (!cvAccessToken) return next(httpError(503, "Accesul la CV-uri nu este configurat."));
    const supplied = Buffer.from(request.get("Authorization") || "");
    const expected = Buffer.from(`Bearer ${cvAccessToken}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return next(httpError(401, "Acces neautorizat."));
    next();
  }, controller.descarcaCv);
  return router;
}
