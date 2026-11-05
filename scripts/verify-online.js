import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createApp } from "../app.js";
import { openDatabase, closeDatabase } from "../database.js";

if (!process.env.DATABASE_URL) throw new Error("Verificarea online necesită DATABASE_URL în .env.");
const marker = `jobfest-probe-${randomUUID()}`;
const email = `${marker}@example.invalid`;
const token = randomUUID();
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
let db;
let server;
let failure;
try {
  db = await openDatabase();
  assert.equal(db.dialect, "postgres");
  server = createApp({ db, cvAccessToken: token }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  const form = new FormData();
  form.append("date", JSON.stringify({ nume: "Verificare", prenume: "Online", email, zile: ["4 martie (CSIE, REI, FABBV)"], facultate: ["CSIE"], an: "1", sursa: marker }));
  form.append("cv", new Blob([pdf], { type: "application/pdf" }), `${marker}.pdf`);
  const registration = await fetch(base + "/api/inscriere", { method: "POST", body: form });
  assert.equal(registration.status, 201);
  const { id } = await registration.json();
  const saved = await db.pool.query("SELECT cv_path, cv_size FROM jobfest.inscrieri WHERE id = $1 AND email = $2", [id, email]);
  assert.equal(saved.rows[0].cv_size, pdf.length);
  console.log("Înscriere: Node.js -> PostgreSQL -> Storage privat, verificat.");
  const unauthorized = await fetch(`${base}/api/inscriere/${id}/cv`);
  assert.equal(unauthorized.status, 401);
  const download = await fetch(`${base}/api/inscriere/${id}/cv`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/${process.env.CV_BUCKET || "jobfest-cv"}/${saved.rows[0].cv_path}`;
  const publicAccess = await fetch(publicUrl);
  assert.notEqual(publicAccess.status, 200);
  console.log("CV: descărcare autorizată verificată; accesul public este blocat.");
  const feedback = await fetch(base + "/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ general: 5, zile: ["4 martie (CSIE, REI, FABBV)"], bine: marker }) });
  assert.equal(feedback.status, 201);
  const feedbackData = await feedback.json();
  const row = await db.pool.query("SELECT email, general FROM jobfest.feedback WHERE id = $1 AND bine = $2", [feedbackData.id, marker]);
  assert.equal(row.rows[0].email, null);
  assert.equal(row.rows[0].general, 5);
  console.log("Feedback anonim: salvat și verificat în PostgreSQL.");
  for (const origin of (process.env.FRONTEND_ORIGIN || "").split(",").filter(Boolean)) {
    const result = await fetch(base + "/api/health", { headers: { Origin: origin } });
    assert.equal(result.headers.get("access-control-allow-origin"), origin);
  }
  console.log("Originile Pages configurate: acceptate.");
} catch (error) {
  failure = error;
  console.error("Verificarea online nu a trecut:", error.code || error.name);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db) {
    try {
      const owned = await db.pool.query("SELECT id, cv_path FROM jobfest.inscrieri WHERE email = $1 AND sursa = $2", [email, marker]);
      for (const row of owned.rows) {
        await db.storage.remove(row.cv_path);
        await db.transaction(async client => {
          await client.query("DELETE FROM jobfest.inscrieri WHERE id = $1 AND email = $2", [row.id, email]);
          await client.query("DELETE FROM jobfest.cv_uploads WHERE path = $1", [row.cv_path]);
        });
      }
      await db.pool.query("DELETE FROM jobfest.feedback WHERE bine = $1 AND email IS NULL", [marker]);
      console.log("Datele și fișierul create de această verificare au fost curățate.");
    } catch (error) {
      failure = error;
      console.error("Curățarea verificării online necesită atenție:", error.code || error.name);
    }
    await closeDatabase(db);
  }
}
if (failure) process.exitCode = 1;
