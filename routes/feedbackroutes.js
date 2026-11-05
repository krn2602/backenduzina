import { Router } from "express";
import { createFeedbackController } from "../controllers/feedbackcontroller.js";

export function createFeedbackRouter(db) {
  const router = Router();
  router.post("/", createFeedbackController(db));
  return router;
}
