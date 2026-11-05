import { cp, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(process.argv[2] || path.join(root, "..", "Jobfest_Frontend"));
const target = path.join(root, "public");
await access(path.join(source, "index.html"));
await access(path.join(source, "inscriere.js"));
for (const entry of await readdir(source, { withFileTypes: true })) {
  if (entry.isFile() && /\.(html|css|js)$/.test(entry.name)) await cp(path.join(source, entry.name), path.join(target, entry.name));
}
await cp(path.join(source, "asstest"), path.join(target, "asstest"), { recursive: true });
console.log("Frontendul a fost sincronizat în public/.");
