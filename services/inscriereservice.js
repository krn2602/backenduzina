import { adaugaInscriere } from "../repository/inscriererepository.js";
import { object, text, email, days, faculties } from "../validation.js";
import { validateCv } from "../middlewares/upload.js";
import { httpError } from "../errors.js";

export async function salveazaInscriere(db, date, file) {
  object(date);
  const normalized = {
    nume: text(date.nume, "Nume", 100, true),
    prenume: text(date.prenume, "Prenume", 100, true),
    email: email(date.email, true),
    zile: days(date.zile),
    facultate: faculties(date.facultate, true),
    sursa: text(date.sursa, "Sursă", 500)
  };
  if (!["1", "2", "3", 1, 2, 3].includes(date.an)) throw httpError(400, "An de studiu invalid.");
  normalized.an = Number(date.an);
  const cv = validateCv(file);
  return adaugaInscriere(db, normalized, cv);
}
