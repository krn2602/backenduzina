import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";

for (const name of ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "CV_ACCESS_TOKEN", "FRONTEND_ORIGIN"]) {
  if (!process.env[name]) throw new Error(`Completează ${name} în .env.`);
}
const url = new URL(process.env.DATABASE_URL);
const addresses = await lookup(url.hostname, { all: true });
if (!addresses.some(address => address.family === 4)) throw new Error("Render necesită o adresă PostgreSQL accesibilă pe IPv4. Folosește Session pooler.");
const names = ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "PGSSLROOTCERT", "CV_BUCKET", "CV_STORAGE_LIMIT_MB", "CV_ACCESS_TOKEN", "FRONTEND_ORIGIN"];
const values = Object.fromEntries(names.filter(name => process.env[name]).map(name => [name, process.env[name]]));
Object.assign(values, { NODE_ENV: "production", HOST: "0.0.0.0", NODE_VERSION: "22" });
await writeFile(".env.render", Object.entries(values).map(([name, value]) => `${name}=${JSON.stringify(value)}`).join("\n") + "\n");
console.log(".env.render este pregătit pentru import în Render. Fișierul conține secrete și este ignorat de Git.");
