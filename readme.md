# Job Fest — Node.js, Supabase și website

Backendul rămâne în Node.js + Express. Varianta online folosește PostgreSQL și Storage privat din Supabase. SQLite este păstrat numai pentru dezvoltare locală. Nu sunt folosite Next.js sau Supabase Edge Functions. Ramura de lucru este `fix`.

## Configurare locală

```sh
npm ci
npm test
npm start
```

Serverul citește `.env` la pornire. Fișierele `.env`, `.env.render` și bazele locale sunt excluse din Git. `.env.example` conține numai numele configurațiilor și valori publice. Cheile secrete nu se pun în `public/` sau în frontend.

| Variabilă | Utilizare |
| --- | --- |
| `DATABASE_URL` | Conexiune PostgreSQL Session pooler, port 5432 |
| `SUPABASE_URL` | URL-ul proiectului Supabase |
| `SUPABASE_SECRET_KEY` | Cheia serverului `sb_secret_...` |
| `PGSSLROOTCERT` | `certs/supabase-ca.crt`, pentru verificarea TLS |
| `CV_BUCKET` | `jobfest-cv`, privat |
| `CV_ACCESS_TOKEN` | Tokenul organizatorului pentru descărcări |
| `CV_STORAGE_LIMIT_MB` | Maximum 800, fără activarea unui serviciu plătit |
| `FRONTEND_ORIGIN` | Originile HTTPS permise, separate prin virgulă |
| `HOST` / `PORT` | Interfața și portul HTTP |

Domeniile configurate sunt `https://duzina.servertheo.top`, `https://jobfest.servertheo.top` și `https://duzina.pages.dev`.

În prezența `DATABASE_URL`, `npm start` folosește baza online. Pentru testare SQLite, pornește serverul cu `DATABASE_URL` gol și opțional `DATABASE_PATH`; fișierul existent nu este convertit sau încărcat automat în Supabase. Dependența SQLite este de dezvoltare și nu intră în buildul Render. Datele locale și cele online sunt separate.

## Schema Supabase

Tabelele sunt în schema `jobfest`, nu în `public`: `inscrieri`, `feedback`, `cv_uploads`. Selectează schema `jobfest` în Table Editor. `npm run db:init` inițializează tabelele și verifică bucketul privat; comanda poate rula repetat.

Row Level Security este activată, iar rolurile `anon` și `authenticated` nu primesc acces la schema sau tabele. Accesul formularelor trece prin backendul Node.js. Schema SQL este în `postgres/schema.sql`.

Conexiunea PostgreSQL verifică certificatul și hostname-ul. Certificatul CA public Supabase este inclus în `certs/`; verificarea TLS nu este dezactivată. Pentru Render se folosește Session pooler IPv4, nu conexiunea directă IPv6. Nu este necesar un add-on IPv4 plătit.

## Înscriere și CV

`POST /api/inscriere` primește `multipart/form-data` cu `date` (JSON) și `cv` (un singur PDF obligatoriu, maximum 5 MB). JSON-ul conține `nume`, `prenume`, `email`, `zile`, `facultate`, `an`, `sursa`. Răspunsul de succes este HTTP 201 cu `ok`, `mesaj`, `id`.

Datele sunt validate înainte de rezervarea spațiului. Backendul rezervă capacitate în PostgreSQL, încarcă fișierul într-un bucket privat și salvează metadatele înscrierii. O limită de 800 MiB protejează capacitatea destinată CV-urilor; rezervările concurente sunt sincronizate în baza de date. Limita se aplică fișierelor gestionate de această aplicație, nu altor fișiere din cont.

Dacă încărcarea sau INSERT-ul eșuează, backendul încearcă eliminarea obiectului creat și eliberarea rezervării. Dacă eliminarea nu poate fi confirmată, rezervarea este păstrată. Dacă un commit a reușit fără confirmare pe conexiune, existența înscrierii este verificată înainte de curățare. Nu există o tranzacție unică între PostgreSQL și Storage.

`GET /api/inscriere/:id/cv` necesită `Authorization: Bearer <CV_ACCESS_TOKEN>`. Node.js descarcă PDF-ul privat și îl returnează ca atașament, fără cache. Un URL public Storage nu permite citirea PDF-ului.

`npm run cv:cleanup` curăță numai rezervările nefinalizate mai vechi de o oră, fără înscriere asociată. Nu șterge CV-uri finalizate. Nu este programată nicio curățare automată.

## Feedback

`POST /api/feedback` primește JSON cu `email`, `general`, `recomandare`, `bine`, `zile`, `locatie`, `speakeri`, `program`, `standuri`, `promovare`, `schimbat`, `facultate`. Sunt obligatorii `general` între 1 și 5 și cel puțin o zi. E-mailul gol se salvează ca `NULL`.

Validarea folosește `status`, nu `satus`. Erorile sunt JSON cu `ok: false` și `eroare`. HTTP 400 indică date invalide, 413 un PDF prea mare, 507 atingerea capacității pentru CV-uri.

## Render Free

`render.yaml` pregătește un singur serviciu Node.js pe planul `free`, fără discuri sau baze Render plătite. Build: `npm ci --omit=dev`; Start: `npm start`; Health check: `/api/health`. Deployurile automate sunt oprite. În producție lipsa bazei PostgreSQL, a tokenului CV sau a originilor Pages oprește pornirea; nu se revine la SQLite pe discul temporar.

```sh
npm run prepare:render
```

Comanda pregătește `.env.render` pentru importul variabilelor în Render. Fișierul conține secrete și rămâne local. Nu îl copia în GitHub sau Pages. Nu setează `PORT`, deoarece Render îl furnizează. Folosește un cont și un serviciu Free, fără metodă de plată sau upgrade.

Publicarea standard pe Render necesită ca versiunea de cod să fie disponibilă în repository-ul legat serviciului. Schimbările locale nu au fost comise sau trimise. După publicarea serviciului, adresa HTTPS a API-ului se setează în `Jobfest_Frontend/config.js` și apoi se publică frontendul în Pages. Pornirea după repaus pe Render poate dura; frontendul permite două minute pentru cerere și nu repetă automat înscrierea.

## Testare și sincronizare

```sh
npm test
npm run verify:online
npm run sync:frontend
```

Testele automate folosesc SQLite separat și PostgreSQL încorporat prin PGlite. Verifică rutele, schema, validarea, rezervările concurente, rollbackul, accesul la CV și configurația Free. Testele Storage folosesc obiecte de test în memorie.

`verify:online` verifică separat Supabase real prin rutele Node.js: înscriere, upload, descărcare autorizată, blocarea accesului public, feedback și CORS. Creează date fictive cu identificator unic și curăță numai acele date și acel fișier. Nu mută și nu șterge baza SQLite existentă.

`sync:frontend` copiază website-ul din repository-ul vecin în `public/`, fără `.env`, teste sau dependențe. Aspectul paginilor nu este schimbat de integrarea online.
