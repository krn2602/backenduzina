import { salveazaFeedback } from "../services/feedbackservice.js";

export function createFeedbackController(db) {
  return async (request, response) => {
    const id = await salveazaFeedback(db, request.body);
    response.status(201).json({ ok: true, mesaj: "Feedbackul a fost salvat. Îți mulțumim!", id });
  };
}
