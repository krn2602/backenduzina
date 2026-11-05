import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import YAML from "yaml";
import { createApp } from "../app.js";
import { createPostgresDatabase, initializePostgres } from "../postgres/database.js";
import { reserveCv, cleanupPendingCv } from "../postgres/registration.js";
import { createCvStorage } from "../storage.js";

const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
const data = () => ({ nume: "Popescu", prenume: "Ana", email: "ana@example.test", zile: ["4 martie (CSIE, REI, FABBV)"], facultate: ["CSIE"], an: "2", sursa: "Test PostgreSQL" });

async function fixture(t, options = {}) {
  const engine = new PGlite();
  const wrap = connection => ({
    async query(sql, parameters) {
      if (sql.includes("CREATE SCHEMA IF NOT EXISTS jobfest")) {
        const results = await connection.exec(sql);
        return results.at(-1);
      }
      return connection.query(sql, parameters);
    }
  });
  const pool = { ...wrap(engine), end: () => engine.close() };
  const objects = new Map();
  const removed = [];
  const storage = {
    async upload(path, cv) {
      objects.set(path, cv.content);
      if (options.failUpload) throw new Error("Upload failure");
    },
    async download(path) {
      if (!objects.has(path)) throw new Error("Missing private object");
      return objects.get(path);
    },
    async remove(path) {
      if (options.failRemove) throw new Error("Remove failure");
      objects.delete(path);
      removed.push(path);
    }
  };
  const db = createPostgresDatabase(pool, {
    storage, storageLimitBytes: options.limit ?? 800 * 1024 * 1024,
    transaction: operation => engine.transaction(connection => operation(wrap(connection)))
  });
  await engine.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await initializePostgres(db);
  const server = createApp({ db, cvAccessToken: "test-token", frontendOrigins: "https://jobfest.pages.dev" }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await engine.close();
  });
  const upload = (details = data(), file = pdf) => {
    const form = new FormData();
    form.append("date", JSON.stringify(details));
    if (file) form.append("cv", new Blob([file], { type: "application/pdf" }), "cv.pdf");
    return fetch(base + "/api/inscriere", { method: "POST", body: form });
  };
  return { db, pool, engine, storage, objects, removed, base, upload };
}

async function total(db, table) {
  assert.ok(["inscrieri", "feedback", "cv_uploads"].includes(table));
  const { rows } = await db.pool.query(`SELECT COUNT(*)::int AS count FROM jobfest.${table}`);
  return rows[0].count;
}

test("Node.js salvează metadatele în PostgreSQL și CV-ul în stocarea privată", async t => {
  const app = await fixture(t);
  const response = await app.upload();
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const { rows } = await app.pool.query("SELECT * FROM jobfest.inscrieri WHERE id = $1", [id]);
  assert.equal(rows[0].email, "ana@example.test");
  assert.deepEqual(rows[0].zile, data().zile);
  assert.equal(rows[0].cv_size, pdf.length);
  assert.ok(!("cv_continut" in rows[0]));
  assert.deepEqual(app.objects.get(rows[0].cv_path), pdf);
  const reservation = await app.pool.query("SELECT state FROM jobfest.cv_uploads WHERE path = $1", [rows[0].cv_path]);
  assert.equal(reservation.rows[0].state, "committed");
  const unauthorized = await fetch(`${app.base}/api/inscriere/${id}/cv`);
  assert.equal(unauthorized.status, 401);
  const download = await fetch(`${app.base}/api/inscriere/${id}/cv`, { headers: { Authorization: "Bearer test-token" } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("cache-control"), "no-store");
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
});

test("feedbackul anonim folosește PostgreSQL și ratinguri numerice", async t => {
  const app = await fixture(t);
  const response = await fetch(app.base + "/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ general: 5, zile: data().zile, bine: "Prezentările", facultate: [] })
  });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const { rows } = await app.pool.query("SELECT * FROM jobfest.feedback WHERE id = $1", [id]);
  assert.equal(rows[0].email, null);
  assert.equal(rows[0].general, 5);
  assert.equal(rows[0].program, null);
  assert.deepEqual(rows[0].facultate, []);
});

test("CV-ul obligatoriu și validarea sunt aplicate înainte de rezervarea spațiului", async t => {
  const app = await fixture(t);
  assert.equal((await app.upload(data(), null)).status, 400);
  assert.equal((await app.upload({ ...data(), nume: " " })).status, 400);
  assert.equal((await app.upload(data(), Buffer.from("invalid"))).status, 400);
  assert.equal(await total(app.db, "inscrieri"), 0);
  assert.equal(await total(app.db, "cv_uploads"), 0);
  assert.equal(app.objects.size, 0);
});

test("rezervările concurente nu pot depăși limita gratuită configurată", async t => {
  const app = await fixture(t, { limit: pdf.length });
  const responses = await Promise.all([app.upload(), app.upload()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 507]);
  assert.equal(await total(app.db, "inscrieri"), 1);
  assert.equal(await total(app.db, "cv_uploads"), 1);
  assert.equal(app.objects.size, 1);
});

test("un upload eșuat este curățat înainte de eliberarea rezervării", async t => {
  const app = await fixture(t, { failUpload: true });
  assert.equal((await app.upload()).status, 500);
  assert.equal(await total(app.db, "inscrieri"), 0);
  assert.equal(await total(app.db, "cv_uploads"), 0);
  assert.equal(app.objects.size, 0);
  assert.equal(app.removed.length, 1);
});

test("eroarea SQL după upload curăță fișierul și rezervarea", async t => {
  const app = await fixture(t);
  await app.pool.query("ALTER TABLE jobfest.inscrieri ADD CONSTRAINT test_failure CHECK (nume <> 'DB failure')");
  assert.equal((await app.upload({ ...data(), nume: "DB failure" })).status, 500);
  assert.equal(await total(app.db, "inscrieri"), 0);
  assert.equal(await total(app.db, "cv_uploads"), 0);
  assert.equal(app.objects.size, 0);
});

test("curățarea neconfirmată păstrează rezervarea și nu permite depășirea cotei", async t => {
  const app = await fixture(t, { failUpload: true, failRemove: true, limit: pdf.length });
  assert.equal((await app.upload()).status, 500);
  assert.equal(await total(app.db, "cv_uploads"), 1);
  assert.equal((await app.upload()).status, 507);
  assert.equal(await total(app.db, "inscrieri"), 0);
});

test("o confirmare de commit pierdută nu șterge un CV deja asociat", async t => {
  const app = await fixture(t);
  const transaction = app.db.transaction;
  let completed = 0;
  app.db.transaction = async operation => {
    const result = await transaction(operation);
    if (++completed === 2) throw new Error("Commit acknowledgement lost");
    return result;
  };
  assert.equal((await app.upload()).status, 201);
  assert.equal(await total(app.db, "inscrieri"), 1);
  assert.equal(app.objects.size, 1);
  assert.equal(app.removed.length, 0);
});

test("curățarea rezervărilor vechi păstrează CV-urile salvate și uploadurile recente", async t => {
  const app = await fixture(t);
  assert.equal((await app.upload()).status, 201);
  await reserveCv(app.db, "cv/old.pdf", pdf.length);
  await reserveCv(app.db, "cv/recent.pdf", pdf.length);
  app.objects.set("cv/old.pdf", pdf);
  app.objects.set("cv/recent.pdf", pdf);
  await app.pool.query("UPDATE jobfest.cv_uploads SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE path = $1", ["cv/old.pdf"]);
  assert.equal(await cleanupPendingCv(app.db), 1);
  assert.equal(await total(app.db, "inscrieri"), 1);
  assert.equal(await total(app.db, "cv_uploads"), 2);
  assert.ok(app.objects.has("cv/recent.pdf"));
  assert.equal(app.objects.size, 2);
});

test("schema poate fi inițializată repetat și nu permite acces anon la date", async t => {
  const app = await fixture(t);
  assert.equal((await app.upload()).status, 201);
  await initializePostgres(app.db);
  assert.equal(await total(app.db, "inscrieri"), 1);
  await app.pool.query("SET ROLE anon");
  try {
    await assert.rejects(app.pool.query("SELECT * FROM jobfest.inscrieri"), /permission denied/);
  } finally {
    await app.pool.query("RESET ROLE");
  }
});

test("health check și CORS permit originea Pages configurată", async t => {
  const app = await fixture(t);
  const response = await fetch(app.base + "/api/health", { headers: { Origin: "https://jobfest.pages.dev" } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(response.headers.get("access-control-allow-origin"), "https://jobfest.pages.dev");
  const other = await fetch(app.base + "/api/health", { headers: { Origin: "https://other.test" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});

test("Storage inițializează numai un bucket privat, cu limite PDF", async () => {
  let created;
  const client = { storage: {
    from: () => ({}),
    getBucket: async () => created ? { data: { public: false } } : { error: { statusCode: "404" } },
    createBucket: async (name, options) => { created = { name, options }; return {}; }
  } };
  await createCvStorage({ client }).initialize();
  assert.equal(created.name, "jobfest-cv");
  assert.equal(created.options.public, false);
  assert.equal(created.options.fileSizeLimit, 5 * 1024 * 1024);
  assert.deepEqual(created.options.allowedMimeTypes, ["application/pdf"]);
  const publicClient = { storage: { from: () => ({}), getBucket: async () => ({ data: { public: true } }) } };
  await assert.rejects(createCvStorage({ client: publicClient }).initialize(), /privat/);
  assert.throws(() => createCvStorage({ url: "https://example.supabase.co", key: "sb_publishable_test" }), /cheia serverului/);
});

test("Render folosește doar un serviciu Node gratuit și credențiale externe", async () => {
  const blueprint = YAML.parse(await readFile(new URL("../render.yaml", import.meta.url), "utf8"));
  assert.equal(blueprint.services.length, 1);
  const service = blueprint.services[0];
  assert.equal(service.runtime, "node");
  assert.equal(service.plan, "free");
  assert.equal(service.branch, "fix");
  assert.equal(service.autoDeployTrigger, "off");
  assert.equal(service.healthCheckPath, "/api/health");
  assert.ok(!service.disk && !blueprint.databases);
  for (const name of ["DATABASE_URL", "SUPABASE_SECRET_KEY"]) {
    const variable = service.envVars.find(entry => entry.key === name);
    assert.equal(variable.sync, false);
    assert.equal(variable.value, undefined);
  }
});

test("curățarea revalidează rezervarea dacă înscrierea s-a finalizat între timp", async t => {
  const app = await fixture(t);
  const path = "cv/finished-late.pdf";
  await reserveCv(app.db, path, pdf.length);
  app.objects.set(path, pdf);
  await app.pool.query("UPDATE jobfest.cv_uploads SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE path = $1", [path]);
  const query = app.pool.query;
  let advanced = false;
  app.pool.query = async (sql, parameters) => {
    const result = await query(sql, parameters);
    if (!advanced && sql.includes("SELECT path FROM jobfest.cv_uploads AS uploads")) {
      advanced = true;
      await query("UPDATE jobfest.cv_uploads SET state = 'committed' WHERE path = $1", [path]);
      await query(`INSERT INTO jobfest.inscrieri (nume, prenume, email, zile, facultate, an, cv_nume, cv_path, cv_size)
        VALUES ('Test', 'Finalizat', 'test@example.test', '[]'::jsonb, '[]'::jsonb, 1, 'cv.pdf', $1, $2)`, [path, pdf.length]);
    }
    return result;
  };
  assert.equal(await cleanupPendingCv(app.db), 0);
  assert.equal(await total(app.db, "inscrieri"), 1);
  assert.ok(app.objects.has(path));
  assert.equal(app.removed.length, 0);
});
