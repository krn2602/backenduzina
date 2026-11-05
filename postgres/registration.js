import { randomUUID } from "node:crypto";
import { httpError } from "../errors.js";

export async function reserveCv(db, path, size) {
  await db.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [7462041]);
    const { rows } = await client.query("SELECT COALESCE(SUM(size_bytes), 0)::text AS used FROM jobfest.cv_uploads");
    if (BigInt(rows[0].used) + BigInt(size) > BigInt(db.storageLimitBytes)) throw httpError(507, "Limita de stocare pentru CV-uri a fost atinsă. Înscrierile noi sunt oprite momentan.");
    await client.query("INSERT INTO jobfest.cv_uploads (path, size_bytes) VALUES ($1, $2)", [path, size]);
  });
}

export async function saveRegistration(db, date, cv) {
  const path = `cv/${randomUUID()}.pdf`;
  await reserveCv(db, path, cv.content.length);
  try {
    await db.storage.upload(path, cv);
    return await db.transaction(async client => {
      const reservation = await client.query("SELECT state FROM jobfest.cv_uploads WHERE path = $1 FOR UPDATE", [path]);
      if (reservation.rows[0]?.state !== "pending") throw new Error("Rezervarea CV-ului nu mai este disponibilă.");
      const { rows } = await client.query(`
        INSERT INTO jobfest.inscrieri (nume, prenume, email, zile, facultate, an, sursa, cv_nume, cv_tip, cv_path, cv_size)
        VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11) RETURNING id
      `, [date.nume, date.prenume, date.email, JSON.stringify(date.zile), JSON.stringify(date.facultate), date.an, date.sursa, cv.name, cv.type, path, cv.content.length]);
      await client.query("UPDATE jobfest.cv_uploads SET state = 'committed' WHERE path = $1", [path]);
      return rows[0].id;
    });
  } catch (error) {
    let existing;
    try {
      existing = await db.pool.query("SELECT id FROM jobfest.inscrieri WHERE cv_path = $1", [path]);
    } catch {
      throw error;
    }
    if (existing.rows[0]) return existing.rows[0].id;
    try {
      await db.storage.remove(path);
      await db.pool.query("DELETE FROM jobfest.cv_uploads WHERE path = $1 AND state = 'pending'", [path]);
    } catch {
      console.error("O rezervare de CV nefinalizată a fost păstrată pentru verificare.");
    }
    throw error;
  }
}

export async function readCv(db, id) {
  const { rows } = await db.pool.query("SELECT cv_nume, cv_tip, cv_path FROM jobfest.inscrieri WHERE id = $1", [id]);
  if (!rows[0]) return undefined;
  return { ...rows[0], cv_continut: await db.storage.download(rows[0].cv_path) };
}

export async function cleanupPendingCv(db) {
  const { rows } = await db.pool.query(`
    SELECT path FROM jobfest.cv_uploads AS uploads
    WHERE state = 'pending' AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
      AND NOT EXISTS (SELECT 1 FROM jobfest.inscrieri WHERE cv_path = uploads.path)
  `);
  let cleaned = 0;
  for (const { path } of rows) {
    const removed = await db.transaction(async client => {
      const current = await client.query(`
        SELECT path FROM jobfest.cv_uploads AS uploads
        WHERE path = $1 AND state = 'pending' AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
          AND NOT EXISTS (SELECT 1 FROM jobfest.inscrieri WHERE cv_path = uploads.path)
        FOR UPDATE
      `, [path]);
      if (!current.rows.length) return false;
      await db.storage.remove(path);
      await client.query("DELETE FROM jobfest.cv_uploads WHERE path = $1 AND state = 'pending'", [path]);
      return true;
    });
    if (removed) cleaned++;
  }
  return cleaned;
}
