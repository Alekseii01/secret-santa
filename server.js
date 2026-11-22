// Тайный Санта: Express + SQLite.
//
// Как устроена секретность:
//  - Пара «кто → кому» нигде не хранится в открытом виде. Получатель шифруется
//    AES-256-GCM ключом, выведенным из личного токена участника, а в базе лежит
//    только хеш этого токена. Без токена (он есть только в браузере участника)
//    даже админ с доступом к базе не узнает, кому кто выпал.
//  - Отдельно хранится только флаг «этого человека уже кто-то вытянул» — он нужен,
//    чтобы не выпасть двоим, но не говорит, кто именно его вытянул.
//  - API наружу отдаёт имена, «уже тянул / ещё нет» и вишлисты. Вишлисты ни к
//    кому не привязаны, поэтому по ним не понять, кто кому дарит.
import express from 'express';
import compression from 'compression';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickLocale, renderIndexHtml } from './web/src/locales.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Переменные из .env рядом с server.js (если файл есть). Уже заданные в окружении не перезаписываем.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'santa.db');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
// Язык интерфейса: LOCALE=en | ru (по умолчанию en)
const LOCALE = pickLocale(process.env.LOCALE);
// Участники: NAMES=Аня,Боря,Вика (через запятую). Имена должны быть разными.
const NAMES = [...new Set((process.env.NAMES || '').split(',').map((s) => s.trim()).filter(Boolean))];
if (NAMES.length < 2) {
  console.error('Set the participants in NAMES (at least two), e.g. NAMES=Anna,Bob,Vika. See .env.example');
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS people (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    has_drawn  INTEGER NOT NULL DEFAULT 0,  -- этот человек уже тянул
    is_taken   INTEGER NOT NULL DEFAULT 0,  -- этого человека уже кто-то вытянул
    token_hash TEXT,                        -- sha256 личного токена
    secret     TEXT,                        -- зашифрованное имя того, кому даришь
    wishlist   TEXT NOT NULL DEFAULT '[]',  -- JSON-массив пожеланий
    claimed_at INTEGER                      -- когда имя закрепили за браузером
  );
`);
// миграция для баз, созданных до появления claimed_at
if (!db.prepare('PRAGMA table_info(people)').all().some((c) => c.name === 'claimed_at')) {
  db.exec('ALTER TABLE people ADD COLUMN claimed_at INTEGER');
}

// Список участников в базе приводим к NAMES. Пока никто не тянул, можно свободно
// добавлять и убирать людей (вишлисты оставшихся сохраняются). После начала
// жеребьёвки состав не трогаем: иначе сломаются уже выпавшие пары.
function seed() {
  const rows = db.prepare('SELECT name, has_drawn FROM people').all();
  const inDb = new Set(rows.map((r) => r.name));
  const wanted = new Set(NAMES);
  const toAdd = NAMES.filter((n) => !inDb.has(n));
  const toRemove = rows.filter((r) => !wanted.has(r.name)).map((r) => r.name);
  if (!toAdd.length && !toRemove.length) return;
  if (rows.some((r) => r.has_drawn)) {
    console.warn(
      `NAMES differs from the database (removed: ${toRemove.join(', ') || '-'}; added: ${toAdd.join(', ') || '-'}), ` +
        'but the draw has already started, so the participants stay the same. To start over: POST /api/admin/reset.'
    );
    return;
  }
  const ins = db.prepare('INSERT INTO people (name) VALUES (?)');
  const del = db.prepare('DELETE FROM people WHERE name = ?');
  db.transaction(() => {
    toRemove.forEach((n) => del.run(n));
    toAdd.forEach((n) => ins.run(n));
  })();
  console.log(`Participants: ${NAMES.join(', ')}`);
}
seed();

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const tokenHash = (t) => sha('id:' + t).toString('hex');

function encrypt(token, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sha('key:' + token), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(token, blob) {
  const buf = Buffer.from(blob, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', sha('key:' + token), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

// Случайный способ раздать оставшимся «дарителям» оставшихся «получателей» так,
// чтобы никто не достался сам себе. Перемешиваем получателей и повторяем, пока
// не выйдет без самоподарков: подходит примерно каждая третья попытка при любом
// числе участников, а результат равновероятен среди всех допустимых раздач.
function randomCompletion(givers, receivers) {
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const r = [...receivers];
    for (let i = r.length - 1; i > 0; i--) {
      const j = crypto.randomInt(i + 1);
      [r[i], r[j]] = [r[j], r[i]];
    }
    if (givers.every((g, i) => g !== r[i])) return r;
  }
  return null;
}

// Тянем: берём случайное корректное продолжение розыгрыша целиком и отдаём
// текущему участнику его часть. Так никогда не будет тупика «последнему
// остался только он сам», а результат равновероятен.
// Вишлист: до 50 пунктов (защита от мусора). Пункт — название, описание, цена в €, ссылка и/или фото (сжатое в браузере).
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function cleanWishlist(raw) {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .map((x) => (typeof x === 'string' ? { text: x } : x || {}))
    .map((x) => {
      const text = String(x.text ?? '').trim().slice(0, 200);
      const desc = String(x.desc ?? '').trim().slice(0, 2000);
      // цена в евро: число или диапазон «30-40»
      let price = String(x.price ?? '').replace(/[–—]/g, '-').replace(/,/g, '.').replace(/[^\d.-]/g, '').slice(0, 15);
      if (!/^\d+(\.\d+)?(-\d+(\.\d+)?)?$/.test(price)) price = (price.match(/\d+(\.\d+)?/) || [''])[0];
      let link = String(x.link ?? '').trim().slice(0, 1000);
      if (link && !/^https?:\/\//i.test(link)) link = /^[\w-]+(\.[\w-]+)+/.test(link) ? `https://${link}` : '';
      if (link) {
        try {
          if (!new URL(link).hostname.includes('.')) link = '';
        } catch {
          link = '';
        }
      }
      const image = typeof x.image === 'string' && x.image.length <= 400_000 && IMG_RE.test(x.image) ? x.image : '';
      return { text, desc, price, link, image };
    })
    .filter((x) => x.text || x.desc || x.link || x.image)
    .slice(0, 50);
  return items.length ? items : null;
}

// Старый формат (массив строк) тоже понимаем.
const readWishlist = (json) =>
  JSON.parse(json).map((x) => ({
    text: '',
    desc: '',
    price: '',
    link: '',
    image: '',
    ...(typeof x === 'string' ? { text: x } : x),
  }));

// Шаг 1: «Да, это я». Имя сразу закрепляется за браузером — токен выдаётся
// ДО жеребьёвки, так что обновление страницы ничего не теряет.
// Если человек закрепил имя и пропал на 30 минут, не вытянув, имя освобождается.
const CLAIM_TTL = 30 * 60 * 1000;
function releaseStale() {
  db.prepare('UPDATE people SET token_hash = NULL, claimed_at = NULL WHERE has_drawn = 0 AND claimed_at < ?').run(
    Date.now() - CLAIM_TTL
  );
}

const claim = db.transaction((id) => {
  releaseStale();
  const row = db.prepare('SELECT id, name, has_drawn, token_hash FROM people WHERE id = ?').get(id);
  if (!row) return { error: 'not_found', status: 404 };
  if (row.has_drawn || row.token_hash) return { error: 'taken', status: 409 };
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('UPDATE people SET token_hash = ?, claimed_at = ? WHERE id = ?').run(tokenHash(token), Date.now(), id);
  return { token, me: row.name, drawn: false, myWishlist: [] };
});

// Шаг 2: жеребьёвка. Идемпотентна: повторный запрос (например, после обрыва
// связи) возвращает тот же результат, а не тянет заново.
// Вишлист заполняют уже после — на экране «кому я дарю».
const draw = db.transaction((me, token) => {
  if (me.has_drawn) return profile(me.name, decrypt(token, me.secret));
  const people = db.prepare('SELECT id, name, has_drawn, is_taken FROM people').all();
  const givers = [me.id, ...people.filter((p) => !p.has_drawn && p.id !== me.id).map((p) => p.id)];
  const receivers = people.filter((p) => !p.is_taken).map((p) => p.id);
  const option = randomCompletion(givers, receivers);
  if (!option) return { error: 'no_options', status: 500 };
  const recipient = people.find((p) => p.id === option[0]);

  db.prepare('UPDATE people SET has_drawn = 1, secret = ? WHERE id = ?').run(encrypt(token, recipient.name), me.id);
  db.prepare('UPDATE people SET is_taken = 1 WHERE id = ?').run(recipient.id);
  return profile(me.name, recipient.name);
});

// Всё, что видит участник: его вишлист и вишлист того, кому он дарит.
function profile(myName, recipientName) {
  const wl = (name) => readWishlist(db.prepare('SELECT wishlist FROM people WHERE name = ?').get(name).wishlist);
  return { me: myName, drawn: true, recipient: recipientName, myWishlist: wl(myName), recipientWishlist: wl(recipientName) };
}

function auth(req) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const row = db.prepare('SELECT * FROM people WHERE token_hash = ?').get(tokenHash(token));
  return row ? { ...row, token } : null;
}

const app = express();
app.use(express.json({ limit: '20mb' })); // фото в вишлисте
app.disable('x-powered-by');
// gzip в том числе для пакета моделей (.bin): CDN обычно сам двоичные файлы не сжимает
app.use(compression({ filter: (req, res) => /octet-stream|javascript|css|json|html/.test(res.getHeader('Content-Type') || '') }));

app.get('/api/people', (_req, res) => {
  releaseStale();
  const rows = db.prepare('SELECT id, name, has_drawn, token_hash FROM people ORDER BY id').all();
  res.json(rows.map((r) => ({ id: r.id, name: r.name, drawn: !!r.has_drawn, claimed: !!r.token_hash && !r.has_drawn })));
});

app.post('/api/claim', (req, res) => {
  const result = claim(Number(req.body?.id));
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

// «Это не я» — освободить имя, пока не вытянул.
app.delete('/api/claim', (req, res) => {
  const me = auth(req);
  if (!me) return res.status(401).json({ error: 'unknown_token' });
  if (me.has_drawn) return res.status(409).json({ error: 'already_drawn' });
  db.prepare('UPDATE people SET token_hash = NULL, claimed_at = NULL WHERE id = ?').run(me.id);
  res.json({ ok: true });
});

app.post('/api/draw', (req, res) => {
  const me = auth(req);
  if (!me) return res.status(401).json({ error: 'unknown_token' });
  const result = draw(me, me.token);
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json(result);
});

app.get('/api/me', (req, res) => {
  const me = auth(req);
  if (!me) return res.status(401).json({ error: 'unknown_token' });
  if (!me.has_drawn) {
    // закрепил имя, но ещё не тянул — продлеваем бронь и возвращаем на вишлист
    db.prepare('UPDATE people SET claimed_at = ? WHERE id = ?').run(Date.now(), me.id);
    return res.json({ me: me.name, drawn: false, myWishlist: readWishlist(me.wishlist) });
  }
  res.json(profile(me.name, decrypt(me.token, me.secret)));
});

// Вишлисты всех — открыты всем, даже тем, кто не участвует или ещё не тянул.
// Кто кому дарит отсюда не узнать: вишлист ни к кому не привязан.
// С токеном дополнительно помечаем, какой из списков твой.
app.get('/api/wishlists', (req, res) => {
  const me = auth(req);
  const rows = db.prepare('SELECT id, name, wishlist FROM people ORDER BY id').all();
  res.json(rows.map((r) => ({ name: r.name, me: r.id === me?.id, wishlist: readWishlist(r.wishlist) })));
});

app.put('/api/me/wishlist', (req, res) => {
  const me = auth(req);
  if (!me) return res.status(401).json({ error: 'unknown_token' });
  const wishlist = cleanWishlist(req.body?.wishlist);
  if (!wishlist) return res.status(400).json({ error: 'empty_wishlist' });
  db.prepare('UPDATE people SET wishlist = ? WHERE id = ?').run(JSON.stringify(wishlist), me.id);
  if (!me.has_drawn) return res.json({ me: me.name, drawn: false, myWishlist: wishlist });
  res.json(profile(me.name, decrypt(me.token, me.secret)));
});

// Освободить застрявшее имя (закрепили, но не вытянули) — только с ADMIN_KEY.
app.post('/api/admin/release', (req, res) => {
  if (!ADMIN_KEY || req.get('x-admin-key') !== ADMIN_KEY) return res.status(403).end();
  const r = db
    .prepare('UPDATE people SET token_hash = NULL, claimed_at = NULL WHERE name = ? AND has_drawn = 0')
    .run(String(req.body?.name || ''));
  res.json({ released: r.changes });
});

// Сброс розыгрыша — только с ADMIN_KEY (для тестов перед запуском).
app.post('/api/admin/reset', (req, res) => {
  if (!ADMIN_KEY || req.get('x-admin-key') !== ADMIN_KEY) return res.status(403).end();
  db.exec('DELETE FROM people');
  seed();
  res.json({ ok: true });
});

const dist = path.join(__dirname, 'web', 'dist');
// Файлы сборки с хешем в имени (JS, CSS, модели) не меняются — кэшируем на год,
// CDN перед сайтом (если есть) держит их у себя.
app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(dist, { index: false, maxAge: 0, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
// index.html отдаём уже на нужном языке (LOCALE) и всегда свежим,
// чтобы после обновления сразу подхватывалась новая сборка.
let indexHtml = null;
app.get(/^(?!\/api).*/, (_req, res) => {
  try {
    indexHtml ??= renderIndexHtml(fs.readFileSync(path.join(dist, 'index.html'), 'utf8'), LOCALE);
  } catch {
    return res.status(503).type('text').send('Frontend is not built yet: run npm run build');
  }
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(indexHtml);
});

app.listen(PORT, () => console.log(`Secret Santa on :${PORT} (${LOCALE})`));
