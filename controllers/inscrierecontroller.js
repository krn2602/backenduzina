import { salveazaInscriere } from "../services/inscriereservice.js";
import { citesteCv } from "../repository/inscriererepository.js";
import { httpError } from "../errors.js";

export function createRegistrationControllers(db) {
  return {
    async creareInscriere(request, response) {
      let data = request.body;
      if (request.is("multipart/form-data")) {
        if (typeof request.body?.date !== "string") throw httpError(400, "Lipsește câmpul date cu informațiile de înscriere.");
        try {
          data = JSON.parse(request.body.date);
        } catch {
          throw httpError(400, "Câmpul date nu conține JSON valid.");
        }
      }
      const id = await salveazaInscriere(db, data, request.file);
      response.status(201).json({ ok: true, mesaj: "Înscriere realizată cu succes!", id });
    },
    async descarcaCv(request, response) {
      if (!/^[1-9]\d*$/.test(request.params.id) || !Number.isSafeInteger(Number(request.params.id))) throw httpError(400, "Identificator de înscriere invalid.");
      const cv = await citesteCv(db, Number(request.params.id));
      if (!cv) throw httpError(404, "CV-ul nu a fost găsit.");
      response.set({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" });
      response.type("application/pdf");
      response.attachment(`cv-${request.params.id}.pdf`);
      response.send(cv.cv_continut);
    }
  };
}
