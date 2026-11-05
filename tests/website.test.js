import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import { createApp } from "../app.js";
import { openDatabase, closeDatabase, get } from "../database.js";

const require = createRequire(import.meta.url);
const { implForWrapper } = require("jsdom/lib/generated/idl/utils.js");

async function fixture(t, page) {
  const db = await openDatabase(":memory:");
  const server = createApp({ db }).listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/${page}`);
  assert.equal(response.status, 200);
  const dom = new JSDOM(await response.text(), { url: `${base}/${page}`, runScripts: "outside-only" });
  const { window } = dom;
  window.matchMedia = () => ({ matches: true });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.AbortController = AbortController;
  window.fetch = async (url, options) => {
    let body = options.body;
    if (body instanceof window.FormData) {
      const converted = new FormData();
      for (const [key, value] of body) {
        if (typeof value === "string") converted.append(key, value);
        else {
          const buffer = await new Promise((resolve, reject) => {
            const reader = new window.FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(value);
          });
          converted.append(key, new Blob([new Uint8Array(buffer)], { type: value.type }), value.name);
        }
      }
      body = converted;
    }
    return fetch(new URL(url, base), { ...options, body });
  };
  for (const file of ["config.js", "api.js", "formulare.js", page === "index.html" ? "inscriere.js" : "feedback.js", "navigatie.js"]) {
    const script = await fetch(`${base}/${file}`);
    assert.equal(script.status, 200);
    window.eval(await script.text());
  }
  t.after(async () => {
    dom.window.close();
    await new Promise(resolve => server.close(resolve));
    await closeDatabase(db);
  });
  const document = window.document;
  const form = document.querySelector("form");
  const set = (name, value) => {
    const input = form.querySelector(`[name="${name}"]`);
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const check = name => {
    const input = form.querySelector(`[name="${name}"]`);
    input.checked = true;
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  const submit = async () => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    for (let attempt = 0; attempt < 500; attempt++) {
      const state = document.querySelector('[role="status"]').dataset.state;
      if (state === "success" || state === "error") return state;
      await delay(5);
    }
    assert.fail("Formularul nu a primit răspunsul serverului.");
  };
  return { db, window, document, form, set, check, submit };
}

test("website-ul trimite înscrierea și PDF-ul prin HTTP până în SQLite", async t => {
  const app = await fixture(t, "index.html");
  app.set("nume", "Popescu");
  app.set("prenume", "Ana");
  app.set("email", "ana@example.test");
  const next = () => [...app.form.querySelectorAll("button")].find(button => button.textContent === "Next").click();
  next();
  app.check("zile");
  app.check("facultate");
  app.check("an");
  next();
  app.set("sursa", "Test integrare");
  const file = new app.window.File(["%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"], "cv.pdf", { type: "application/pdf" });
  implForWrapper(app.form.querySelector('[name="cv"]').files).push(implForWrapper(file));
  assert.equal(await app.submit(), "success");
  const row = await get(app.db, "SELECT * FROM inscrieri WHERE id = 1");
  assert.equal(row.email, "ana@example.test");
  assert.equal(row.sursa, "Test integrare");
  assert.equal(row.cv_nume, "cv.pdf");
  assert.equal(row.cv_continut.length, file.size);
  assert.equal(app.form.querySelector('[name="nume"]').value, "");
});

test("website-ul trimite feedback anonim prin HTTP până în SQLite", async t => {
  const app = await fixture(t, "pag3.html");
  app.check("general");
  app.check("zile");
  app.set("bine", "Prezentările");
  assert.equal(await app.submit(), "success");
  const row = await get(app.db, "SELECT * FROM feedback WHERE id = 1");
  assert.equal(row.email, null);
  assert.equal(row.general, 1);
  assert.equal(row.bine, "Prezentările");
});
