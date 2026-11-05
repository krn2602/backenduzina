import { object, text, email, days, faculties, rating } from "../validation.js";
import { adaugaFeedback } from "../repository/feedbackrepository.js";

export async function salveazaFeedback(db, date) {
  object(date);
  const normalized = {
    email: email(date.email),
    general: rating(date.general, "Experiența generală", true),
    recomandare: rating(date.recomandare, "Recomandare"),
    bine: text(date.bine, "Ce ți-a plăcut", 1000),
    zile: days(date.zile),
    schimbat: text(date.schimbat, "Ce ar trebui schimbat", 1000),
    facultate: faculties(date.facultate)
  };
  for (const name of ["locatie", "speakeri", "program", "standuri", "promovare"]) normalized[name] = rating(date[name], name);
  return adaugaFeedback(db, normalized);
}
