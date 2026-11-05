import "dotenv/config";
import { openDatabase, closeDatabase } from "../database.js";
import { cleanupPendingCv } from "../postgres/registration.js";

if (!process.env.DATABASE_URL) throw new Error("Curățarea CV-urilor online necesită DATABASE_URL.");
const db = await openDatabase();
try {
  console.log(`Rezervări nefinalizate curățate: ${await cleanupPendingCv(db)}`);
} finally {
  await closeDatabase(db);
}
