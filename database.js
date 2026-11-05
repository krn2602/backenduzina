import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export function run(db, sql, parameters = []) {
  if (db.dialect === "postgres") return db.pool.query(sql, parameters);
  return new Promise((resolve, reject) => {
    db.run(sql, parameters, function (error) {
      if (error) reject(error);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

export function get(db, sql, parameters = []) {
  if (db.dialect === "postgres") return db.pool.query(sql, parameters).then(result => result.rows[0]);
  return new Promise((resolve, reject) => db.get(sql, parameters, (error, row) => error ? reject(error) : resolve(row)));
}

export function closeDatabase(db) {
  if (db.dialect === "postgres") return db.pool.end();
  return new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

export async function initializeDatabase(db) {
  const execute = sql => new Promise((resolve, reject) => db.exec(sql, error => error ? reject(error) : resolve()));
  await execute("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  await execute("BEGIN IMMEDIATE");
  try {
    await execute(`
      CREATE TABLE IF NOT EXISTS inscrieri (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nume TEXT NOT NULL,
        prenume TEXT NOT NULL,
        email TEXT NOT NULL,
        zile TEXT NOT NULL,
        facultate TEXT NOT NULL,
        an INTEGER NOT NULL,
        sursa TEXT,
        data_inscrierii TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT,
        general INTEGER NOT NULL CHECK (general BETWEEN 1 AND 5),
        recomandare INTEGER CHECK (recomandare BETWEEN 1 AND 5),
        bine TEXT NOT NULL,
        zile TEXT NOT NULL,
        locatie INTEGER CHECK (locatie BETWEEN 1 AND 5),
        speakeri INTEGER CHECK (speakeri BETWEEN 1 AND 5),
        program INTEGER CHECK (program BETWEEN 1 AND 5),
        standuri INTEGER CHECK (standuri BETWEEN 1 AND 5),
        promovare INTEGER CHECK (promovare BETWEEN 1 AND 5),
        schimbat TEXT NOT NULL,
        facultate TEXT NOT NULL,
        data_feedback TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const columns = await new Promise((resolve, reject) => db.all("PRAGMA table_info(inscrieri)", (error, rows) => error ? reject(error) : resolve(rows)));
    const existing = new Set(columns.map(column => column.name));
    for (const [name, type] of [["cv_nume", "TEXT"], ["cv_tip", "TEXT"], ["cv_continut", "BLOB"]]) {
      if (!existing.has(name)) await execute(`ALTER TABLE inscrieri ADD COLUMN ${name} ${type}`);
    }
    await execute("COMMIT");
  } catch (error) {
    await execute("ROLLBACK");
    throw error;
  }
}

export async function openDatabase(filename = process.env.DATABASE_URL || process.env.DATABASE_PATH || path.join(directory, "inscrieri.db")) {
  if (/^postgres(?:ql)?:/.test(filename)) {
    const { openPostgres } = await import("./postgres/database.js");
    return openPostgres(filename);
  }
  if (process.env.NODE_ENV === "production") throw new Error("Varianta publică necesită DATABASE_URL; SQLite rămâne pentru testarea locală.");
  const { default: sqlite3 } = await import("sqlite3");
  if (filename !== ":memory:") await mkdir(path.dirname(path.resolve(filename)), { recursive: true });
  const db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(filename, error => error ? reject(error) : resolve(connection));
  });
  try {
    await initializeDatabase(db);
    return db;
  } catch (error) {
    await closeDatabase(db);
    throw error;
  }
}
