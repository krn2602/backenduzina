import { saveRegistration, readCv } from "../postgres/registration.js";
import { get, run } from "../database.js";

export async function adaugaInscriere(db, date, cv) {
  if (db.dialect === "postgres") return saveRegistration(db, date, cv);
  const result = await run(db, `
    INSERT INTO inscrieri (nume, prenume, email, zile, facultate, an, sursa, cv_nume, cv_tip, cv_continut)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [date.nume, date.prenume, date.email, JSON.stringify(date.zile), JSON.stringify(date.facultate), date.an, date.sursa, cv.name, cv.type, cv.content]);
  return result.id;
}

export function citesteCv(db, id) {
  if (db.dialect === "postgres") return readCv(db, id);
  return get(db, "SELECT cv_nume, cv_tip, cv_continut FROM inscrieri WHERE id = ? AND cv_continut IS NOT NULL", [id]);
}
