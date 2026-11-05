import { test } from "node:test";
import assert from "node:assert/strict";
import sqlite3 from "sqlite3";
import { once } from "node:events";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app.js";
import { openDatabase, closeDatabase, initializeDatabase, run, get } from "../database.js";

const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF");
const registration = () => ({ nume: " Popescu ", prenume: " Ana ", email: "ANA@example.test", zile: ["4 martie (CSIE, REI, FABBV)"], facultate: ["CSIE"], an: "2", sursa: " Instagram " });
const feedback = () => ({ email: "", general: 5, recomandare: 4, bine: "Speakerii", zile: ["4 martie (CSIE, REI, FABBV)"], locatie: null, speakeri: 5, program: 4, standuri: null, promovare: 3, schimbat: "", facultate: [] });

async function fixture(t, options = {}) {
  const db = await openDatabase(options.filename || ":memory:");
  const app = createApp({ db, cvAccessToken: options.cvAccessToken ?? "test-cv-token" });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await closeDatabase(db);
  });
  const json = (route, body) => fetch(base + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const upload = (data = registration(), content = pdf, filename = "cv.pdf", type = "application/pdf", extraFile = false) => {
    const form = new FormData();
    form.append("date", typeof data === "string" ? data : JSON.stringify(data));
    if (content !== null) form.append("cv", new Blob([content], { type }), filename);
    if (extraFile) form.append("cv", new Blob([pdf], { type: "application/pdf" }), "extra.pdf");
    return fetch(base + "/api/inscriere", { method: "POST", body: form });
  };
  return { db, base, json, upload };
}

async function count(db, table) {
  assert.ok(["inscrieri", "feedback"].includes(table));
  return (await get(db, `SELECT COUNT(*) AS total FROM ${table}`)).total;
}

async function expectError(response, status) {
  assert.equal(response.status, status);
  const data = await response.json();
  assert.equal(data.ok, false);
  assert.equal(typeof data.eroare, "string");
  return data;
}

test("înscrierea și CV-ul sunt salvate împreună în SQLite", async t => {
  const app = await fixture(t);
  const response = await app.upload();
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.ok, true);
  const row = await get(app.db, "SELECT * FROM inscrieri WHERE id = ?", [data.id]);
  assert.equal(row.nume, "Popescu");
  assert.equal(row.prenume, "Ana");
  assert.equal(row.email, "ana@example.test");
  assert.equal(row.sursa, "Instagram");
  assert.deepEqual(JSON.parse(row.zile), registration().zile);
  assert.equal(row.cv_nume, "cv.pdf");
  assert.equal(row.cv_tip, "application/pdf");
  assert.deepEqual(row.cv_continut, pdf);
});

test("CV-ul este obligatoriu și la accesarea directă a API-ului", async t => {
  const app = await fixture(t);
  await expectError(await app.upload(registration(), null), 400);
  await expectError(await app.json("/api/inscriere", registration()), 400);
  assert.equal(await count(app.db, "inscrieri"), 0);
});

test("validarea înscrierii returnează 400, nu 500, și nu salvează un CV orfan", async t => {
  const app = await fixture(t);
  for (const patch of [{ nume: " " }, { email: "ana@example" }, { zile: [] }, { zile: ["zi invalidă"] }, { facultate: ["alta"] }, { an: 4 }, { an: ["2"] }, { sursa: "x".repeat(501) }]) {
    await expectError(await app.upload({ ...registration(), ...patch }), 400);
  }
  assert.equal(await count(app.db, "inscrieri"), 0);
});

test("CV-urile cu extensie, MIME sau conținut neacceptat sunt respinse", async t => {
  const app = await fixture(t);
  await expectError(await app.upload(registration(), "text", "cv.txt", "text/plain"), 400);
  await expectError(await app.upload(registration(), pdf, "cv.pdf", "image/png"), 400);
  await expectError(await app.upload(registration(), "not a pdf"), 400);
  await expectError(await app.upload(registration(), "%PDF-1.4\nwithout terminator"), 400);
  await expectError(await app.upload(registration(), Buffer.alloc(0)), 400);
  assert.equal(await count(app.db, "inscrieri"), 0);
});

test("CV-urile de peste 5 MB și fișierele multiple sunt respinse", async t => {
  const app = await fixture(t);
  await expectError(await app.upload(registration(), Buffer.alloc(5 * 1024 * 1024 + 1)), 413);
  await expectError(await app.upload(registration(), pdf, "cv.pdf", "application/pdf", true), 400);
  assert.equal(await count(app.db, "inscrieri"), 0);
});

test("JSON invalid în câmpul date sau în corpul cererii primește răspuns JSON 400", async t => {
  const app = await fixture(t);
  await expectError(await app.upload("{broken"), 400);
  await expectError(await fetch(app.base + "/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }), 400);
  const form = new FormData();
  form.append("cv", new Blob([pdf], { type: "application/pdf" }), "cv.pdf");
  await expectError(await fetch(app.base + "/api/inscriere", { method: "POST", body: form }), 400);
});

test("descărcarea CV-ului necesită token și returnează atașament fără cache", async t => {
  const app = await fixture(t);
  const { id } = await (await app.upload()).json();
  await expectError(await fetch(`${app.base}/api/inscriere/${id}/cv`), 401);
  await expectError(await fetch(`${app.base}/api/inscriere/${id}/cv`, { headers: { Authorization: "Bearer wrong" } }), 401);
  const headers = { Authorization: "Bearer test-cv-token" };
  const response = await fetch(`${app.base}/api/inscriere/${id}/cv`, { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/pdf/);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="?cv-1\.pdf"?/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), pdf);
  await expectError(await fetch(`${app.base}/api/inscriere/99999/cv`, { headers }), 404);
  await expectError(await fetch(`${app.base}/api/inscriere/invalid/cv`, { headers }), 400);
});

test("CV-urile nu devin publice dacă tokenul nu a fost configurat", async t => {
  const app = await fixture(t, { cvAccessToken: "" });
  await expectError(await fetch(app.base + "/api/inscriere/1/cv"), 503);
  assert.equal((await fetch(app.base + "/inscrieri.db")).status, 404);
});

test("feedbackul anonim este salvat cu ratinguri numerice și email NULL", async t => {
  const app = await fixture(t);
  const response = await app.json("/api/feedback", feedback());
  assert.equal(response.status, 201);
  const { id, ok } = await response.json();
  assert.equal(ok, true);
  const row = await get(app.db, "SELECT * FROM feedback WHERE id = ?", [id]);
  assert.equal(row.email, null);
  assert.equal(row.general, 5);
  assert.equal(row.locatie, null);
  assert.deepEqual(JSON.parse(row.facultate), []);
  assert.equal(row.bine, "Speakerii");
});

test("feedbackul minimal permite lipsa câmpurilor opționale", async t => {
  const app = await fixture(t);
  const response = await app.json("/api/feedback", { general: 4, zile: registration().zile });
  assert.equal(response.status, 201);
  const { id } = await response.json();
  const row = await get(app.db, "SELECT * FROM feedback WHERE id = ?", [id]);
  assert.equal(row.recomandare, null);
  assert.equal(row.schimbat, "");
});

test("feedbackul cu ratinguri, zile sau texte invalide este respins fără salvare", async t => {
  const app = await fixture(t);
  for (const patch of [{ general: null }, { general: "5" }, { general: 0 }, { speakeri: 6 }, { recomandare: true }, { email: "invalid" }, { zile: [] }, { zile: [...registration().zile, ...registration().zile] }, { bine: "x".repeat(1001) }, { facultate: ["inexistent"] }]) {
    await expectError(await app.json("/api/feedback", { ...feedback(), ...patch }), 400);
  }
  assert.equal(await count(app.db, "feedback"), 0);
});

test("cererile concurente păstrează CV-ul asociat înscrierii corecte", async t => {
  const app = await fixture(t);
  const results = await Promise.all([1, 2, 3].map(async number => {
    const data = { ...registration(), nume: `Test ${number}` };
    const response = await app.upload(data, pdf, `cv-${number}.pdf`);
    assert.equal(response.status, 201);
    return { id: (await response.json()).id, number };
  }));
  assert.equal(new Set(results.map(result => result.id)).size, 3);
  for (const { id, number } of results) {
    const row = await get(app.db, "SELECT nume, cv_nume FROM inscrieri WHERE id = ?", [id]);
    assert.equal(row.nume, `Test ${number}`);
    assert.equal(row.cv_nume, `cv-${number}.pdf`);
  }
});

test("migrarea păstrează înscrierile vechi și poate rula de două ori", async () => {
  const db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(":memory:", error => error ? reject(error) : resolve(connection));
  });
  try {
    await run(db, "CREATE TABLE inscrieri (id INTEGER PRIMARY KEY, nume TEXT, prenume TEXT, email TEXT, zile TEXT, facultate TEXT, an INTEGER, sursa TEXT)");
    await run(db, "INSERT INTO inscrieri (id, nume) VALUES (1, 'Existent')");
    await initializeDatabase(db);
    await initializeDatabase(db);
    const row = await get(db, "SELECT * FROM inscrieri WHERE id = 1");
    assert.equal(row.nume, "Existent");
    assert.equal(row.cv_continut, null);
    assert.equal(await count(db, "feedback"), 0);
  } finally {
    await closeDatabase(db);
  }
});

test("salvarea SQLite persistă după închiderea și redeschiderea bazei", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "jobfest-api-"));
  const filename = path.join(directory, "test.db");
  let db;
  let server;
  try {
    db = await openDatabase(filename);
    server = createApp({ db }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const form = new FormData();
    form.append("date", JSON.stringify(registration()));
    form.append("cv", new Blob([pdf], { type: "application/pdf" }), "cv.pdf");
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/inscriere`, { method: "POST", body: form });
    assert.equal(response.status, 201);
    await new Promise(resolve => server.close(resolve));
    server = null;
    await closeDatabase(db);
    db = await openDatabase(filename);
    assert.deepEqual((await get(db, "SELECT cv_continut FROM inscrieri WHERE id = 1")).cv_continut, pdf);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (db) await closeDatabase(db);
    await unlink(filename);
    await rmdir(directory);
  }
});

test("rutele API necunoscute răspund JSON și formularul vechi redirecționează", async t => {
  const app = await fixture(t);
  await expectError(await fetch(app.base + "/api/inexistent"), 404);
  const response = await fetch(app.base + "/inscrieri.html", { redirect: "manual" });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/index.html");
});
