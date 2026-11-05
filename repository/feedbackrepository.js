import { run } from "../database.js";

export async function adaugaFeedback(db, date) {
  if (db.dialect === "postgres") {
    const { rows } = await db.pool.query(`
      INSERT INTO jobfest.feedback (email, general, recomandare, bine, zile, locatie, speakeri, program, standuri, promovare, schimbat, facultate)
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12::jsonb) RETURNING id
    `, [date.email || null, date.general, date.recomandare, date.bine, JSON.stringify(date.zile), date.locatie, date.speakeri, date.program, date.standuri, date.promovare, date.schimbat, JSON.stringify(date.facultate)]);
    return rows[0].id;
  }
  const result = await run(db, `
    INSERT INTO feedback (email, general, recomandare, bine, zile, locatie, speakeri, program, standuri, promovare, schimbat, facultate)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [date.email || null, date.general, date.recomandare, date.bine, JSON.stringify(date.zile), date.locatie, date.speakeri, date.program, date.standuri, date.promovare, date.schimbat, JSON.stringify(date.facultate)]);
  return result.id;
}
