import "dotenv/config";
import { createApp } from "./app.js";
import { openDatabase, closeDatabase } from "./database.js";

const production = process.env.NODE_ENV === "production";
if (production && !process.env.CV_ACCESS_TOKEN) throw new Error("Configurează CV_ACCESS_TOKEN pentru varianta publică.");
if (production && !process.env.FRONTEND_ORIGIN) throw new Error("Configurează FRONTEND_ORIGIN cu originea website-ului Pages.");
const db = await openDatabase();
const app = createApp({ db });
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || (production ? "0.0.0.0" : "127.0.0.1");
const server = app.listen(port, host, () => console.log(`Server online: http://${host}:${server.address().port}`));
server.on("error", async error => {
  console.error("Pornirea serverului a eșuat:", error.code || "necunoscut");
  await closeDatabase(db);
  process.exitCode = 1;
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(async () => { await closeDatabase(db); }));
}
