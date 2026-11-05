import "dotenv/config";
import { openDatabase, closeDatabase } from "./database.js";

const db = await openDatabase();
await closeDatabase(db);
console.log("Tabelele și migrarea pentru CV sunt pregătite.");
