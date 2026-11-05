import pg from "pg";
import { rootCertificates } from "node:tls";
import { readFile } from "node:fs/promises";
import { createCvStorage } from "../storage.js";

export function createPostgresDatabase(pool, { storage, storageLimitBytes = 800 * 1024 * 1024, transaction } = {}) {
  return {
    dialect: "postgres",
    pool,
    storage,
    storageLimitBytes,
    transaction: transaction || (async operation => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    })
  };
}

export async function initializePostgres(db) {
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  await db.transaction(async client => {
    await client.query(schema);
    const roles = await client.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')");
    for (const { rolname } of roles.rows) {
      await client.query(`REVOKE ALL ON SCHEMA jobfest FROM ${rolname}`);
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA jobfest FROM ${rolname}`);
      await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA jobfest FROM ${rolname}`);
    }
  });
}

export async function openPostgres(connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL trebuie să fie o adresă PostgreSQL.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(parameter);
  const ssl = local ? undefined : { rejectUnauthorized: true };
  if (ssl && process.env.PGSSLROOTCERT) ssl.ca = [...rootCertificates, await readFile(process.env.PGSSLROOTCERT, "utf8")];
  const limitMb = Number(process.env.CV_STORAGE_LIMIT_MB || 800);
  if (!Number.isInteger(limitMb) || limitMb < 1 || limitMb > 800) throw new Error("CV_STORAGE_LIMIT_MB trebuie să fie între 1 și 800.");
  const pool = new pg.Pool({ connectionString: url.toString(), ssl, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });
  pool.on("error", error => console.error("Conexiune PostgreSQL întreruptă:", error.code || "necunoscut"));
  try {
    const storage = createCvStorage();
    const db = createPostgresDatabase(pool, { storage, storageLimitBytes: limitMb * 1024 * 1024 });
    await initializePostgres(db);
    await storage.initialize();
    return db;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
