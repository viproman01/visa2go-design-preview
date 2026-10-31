const PURPOSES = new Set(['study', 'work', 'tourism', 'other']);
const CHANNELS = new Set(['telegram', 'whatsapp', 'email']);
// Citizenship choices are globally available; the catalogue only controls their
// preferred display order. Service availability is checked by destination.
const ISO_COUNTRIES = new Set('AX BQ BV CC CX GS HM IO TF UM AF AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BA BW BR BN BG BF BI CV KH CM CA KY CF TD CL CN CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UY UZ VU VA VE VN VG VI WF EH YE ZM ZW'.split(' '));
const EMPTY_CATALOG = {citizenships: [], destinations: [], company: {}, contacts: {}, legal: {}, reviewed: false};
const encoder = new TextEncoder();
const MAX_BODY = 16 * 1024;
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const iso = () => new Date().toISOString();
const bounded = (value, max, required = false) => {
  if (typeof value !== 'string') { if (required) fail(400, 'Заполните обязательные поля.'); return ''; }
  const text = value.trim();
  if ((required && !text) || text.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text)) fail(400, 'Проверьте заполненные поля.');
  return text;
};
const hex = buffer => [...new Uint8Array(buffer)].map(n => n.toString(16).padStart(2, '0')).join('');
async function digest(text) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text))); }
async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}
async function equalSecret(a, b) {
  const aa = await digest(a), bb = await digest(b);
  let different = 0;
  for (let i = 0; i < aa.length; i++) different |= aa.charCodeAt(i) ^ bb.charCodeAt(i);
  return different === 0;
}
function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers}});
}
async function body(request, maxBody = MAX_BODY) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) fail(415, 'Используйте JSON.');
  if (Number(request.headers.get('content-length')) > maxBody) fail(413, 'Слишком большой запрос.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Пустой запрос.');
  let chunks = [], size = 0;
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maxBody) { await reader.cancel(); fail(413, 'Слишком большой запрос.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Некорректный запрос.'); return value; }
  catch (error) { if (error instanceof HttpError) throw error; fail(400, 'Некорректный JSON.'); }
}
function approvedOrigin(request, env, admin = false) {
  const url = new URL(request.url), origin = request.headers.get('origin');
  const allowed = admin ? [url.origin] : [url.origin, ...(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)];
  if (origin && !allowed.includes(origin)) fail(403, 'Источник запроса не разрешён.');
  if (request.headers.get('sec-fetch-site') === 'cross-site' && (!origin || !allowed.includes(origin))) fail(403, 'Источник запроса не разрешён.');
  return origin && origin !== url.origin ? origin : null;
}
function requireDb(env) { if (!env.DB) fail(503, 'Сервис заявок ещё не подключён.'); }
async function getCatalog(env) {
  if (env.DB) {
    const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?`).bind('catalog').first();
    if (row) { try { return JSON.parse(row.value); } catch { fail(503, 'Каталог временно недоступен.'); } }
  }
  if (env.ASSETS) {
    try {
      const response = await env.ASSETS.fetch(new Request('https://assets.internal/config/site.json'));
      if (response.ok) { const config = await response.json(); return {...config.catalog, reviewed: false}; }
    } catch { /* An unavailable fallback never enables collection. */ }
  }
  return EMPTY_CATALOG;
}
function contactReady(c = {}) {
  return /^https:\/\/t\.me\/[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(c.telegram || '') || /^\+?[1-9]\d{6,14}$/.test(c.whatsapp || '') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email || '');
}
function notificationConfigured(env) {
  if (env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_CHAT_ID?.trim()) return true;
  try { const url = new URL(env.NOTIFICATION_WEBHOOK_URL); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
function ready(catalog, env) {
  return !!env.DB && env.LEAD_COLLECTION_ENABLED === 'true' && env.LEGAL_DOCUMENTS_APPROVED === 'true' && notificationConfigured(env) && catalog.reviewed === true && !!catalog.company?.legalName && !!catalog.company?.address && !!catalog.company?.jurisdiction && !!catalog.legal?.privacyVersion && !!catalog.legal?.termsVersion && contactReady(catalog.contacts) && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;
}
function validPhone(value) { return /^\+?[1-9][\d ()-]*$/.test(value) && /^[1-9]\d{6,14}$/.test(value.replace(/[ +()-]/g, '')); }
async function rateLimit(request, env, group, limit, seconds) {
  requireDb(env);
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) fail(503, 'Сервис ещё не настроен.');
  const now = Math.floor(Date.now() / 1000), window = Math.floor(now / seconds);
  const ip = request.headers.get('cf-connecting-ip') || (env.LOCAL_TEST === 'true' ? 'local-test' : null);
  if (!ip) fail(503, 'Не удалось проверить запрос.');
  const key = await hmac(env.SESSION_SECRET, `${group}:${window}:${ip}`);
  const row = await env.DB.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count`).bind(key, (window + 1) * seconds).first();
  if (row.count > limit) fail(429, 'Слишком много запросов. Попробуйте позже.');
}
function cookie(value, url, maxAge = 28800) {
  const secure = new URL(url).protocol === 'https:' ? '; Secure' : '';
  return `visa2go_admin=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
async function requireAdmin(request, env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) fail(503, 'Вход ещё не настроен.');
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)visa2go_admin=([^;]+)/)?.[1];
  const parts = value?.split('.');
  if (!parts || parts.length !== 3 || !/^\d+$/.test(parts[0]) || Number(parts[0]) <= Date.now() || Number(parts[0]) > Date.now() + 28801000 || !/^[\da-f-]{36}$/.test(parts[1])) fail(401, 'Войдите в панель команды.');
  if (!await equalSecret(parts[2], await hmac(env.SESSION_SECRET, `${parts[0]}.${parts[1]}`))) fail(401, 'Войдите в панель команды.');
}
function validateCatalog(value) {
  if (!Array.isArray(value.citizenships) || !Array.isArray(value.destinations) || value.citizenships.length > 300 || value.destinations.length > 300) fail(400, 'Проверьте список стран.');
  for (const list of [value.citizenships, value.destinations]) {
    const ids = new Set();
    for (const item of list) {
      if (!item || !/^(?:[A-Z]{2}|other)$/.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 100 || ids.has(item.id)) fail(400, 'У каждой страны должны быть уникальный код и название.');
      ids.add(item.id);
    }
  }
  for (const item of value.destinations) {
    if (!Array.isArray(item.services) || item.services.length > 4 || item.services.some(s => !PURPOSES.has(s)) || new Set(item.services).size !== item.services.length) fail(400, 'Проверьте категории услуг.');
    for (const key of ['image', 'alt', 'city']) if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 500)) fail(400, 'Некорректные данные направления.');
    if (item.image && !/^(?:https:\/\/|(?:\.\/)?assets\/)/.test(item.image)) fail(400, 'Некорректная ссылка на изображение.');
  }
  if (typeof value.reviewed !== 'boolean') fail(400, 'Укажите статус проверки каталога.');
  for (const key of ['company', 'contacts', 'legal']) if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) fail(400, 'Заполните настройки компании.');
  for (const data of [value.company, value.contacts, value.legal]) for (const entry of Object.values(data)) if (typeof entry !== 'string' || entry.length > 1500) fail(400, 'Некорректные настройки компании.');
  const telegram = (value.contacts.telegram || '').trim().replace(/^@/, 'https://t.me/').replace(/\/$/, '');
  const whatsapp = (value.contacts.whatsapp || '').trim();
  const email = (value.contacts.email || '').trim();
  if (telegram && !/^https:\/\/t\.me\/[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(telegram)) fail(400, 'Проверьте адрес Telegram.');
  if (whatsapp && !validPhone(whatsapp)) fail(400, 'Проверьте номер WhatsApp.');
  value = {...value, contacts: {...value.contacts, telegram, whatsapp: whatsapp ? `+${whatsapp.replace(/\D/g, '')}` : '', email}};
  if (value.contacts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contacts.email)) fail(400, 'Проверьте email.');
  return value;
}
function validateLead(value, catalog) {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value.requestId || '')) fail(400, 'Не удалось определить заявку. Обновите страницу.');
  if (value.website) fail(400, 'Не удалось проверить заявку.');
  if (value.consent !== true) fail(400, 'Нужно согласие на обработку данных.');
  if (!CHANNELS.has(value.channel) || !PURPOSES.has(value.purpose)) fail(400, 'Выберите цель и способ связи.');
  const citizenship = bounded(value.citizenship, 10, true);
  if (citizenship !== 'other' && !ISO_COUNTRIES.has(citizenship)) fail(400, 'Выберите гражданство из списка.');
  const citizenshipOther = bounded(value.citizenshipOther, 100, citizenship === 'other');
  const destination = bounded(value.destination, 10, true);
  const country = catalog.destinations.find(c => c.id === destination);
  if (destination !== 'undecided' && (!country || !country.services.includes(value.purpose))) fail(400, 'Это направление или категория сейчас недоступны.');
  const contact = bounded(value.contact, 254, true);
  if (value.channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) fail(400, 'Проверьте email.');
  if (value.channel === 'whatsapp' && !validPhone(contact)) fail(400, 'Укажите номер WhatsApp с кодом страны (7–15 цифр).');
  if (value.channel === 'telegram' && !/^(?:@|https:\/\/t\.me\/)[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(contact) && !validPhone(contact)) fail(400, 'Укажите @username или номер Telegram.');
  return {requestId: value.requestId, name: bounded(value.name, 100, true), contact, channel: value.channel, citizenship, citizenshipOther, destination, purpose: value.purpose, residence: bounded(value.residence, 100), comment: bounded(value.comment, 2000)};
}
async function submitLead(request, env, context) {
  requireDb(env);
  const catalog = await getCatalog(env);
  if (!ready(catalog, env)) fail(503, 'Приём заявок пока не подключён. Данные не отправлены.');
  await rateLimit(request, env, 'leads', 8, 3600);
  const lead = validateLead(await body(request), catalog), fingerprint = await digest(JSON.stringify(lead)), now = iso(), id = crypto.randomUUID();
  const existing = await env.DB.prepare(`SELECT id,fingerprint,created_at FROM leads WHERE request_id=?`).bind(lead.requestId).first();
  if (existing) { if (existing.fingerprint !== fingerprint) fail(409, 'Эта заявка уже принята с другими данными.'); return json({ok: true, id: existing.id, createdAt: existing.created_at, duplicate: true}); }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO leads(id,request_id,fingerprint,name,contact,channel,citizenship,citizenship_other,destination,purpose,residence,comment,privacy_version,terms_version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(request_id) DO NOTHING`).bind(id, lead.requestId, fingerprint, lead.name, lead.contact, lead.channel, lead.citizenship, lead.citizenshipOther, lead.destination, lead.purpose, lead.residence, lead.comment, catalog.legal.privacyVersion, catalog.legal.termsVersion, now, now),
    env.DB.prepare(`INSERT INTO notification_outbox(id,lead_id,next_at) SELECT ?,id,? FROM leads WHERE id=?`).bind(crypto.randomUUID(), now, id)
  ]);
  const saved = await env.DB.prepare(`SELECT id,fingerprint,created_at FROM leads WHERE request_id=?`).bind(lead.requestId).first();
  if (!saved) fail(503, 'Не удалось сохранить заявку. Попробуйте ещё раз.');
  if (saved.fingerprint !== fingerprint) fail(409, 'Эта заявка уже принята с другими данными.');
  context?.waitUntil?.(deliverNotifications(env));
  return json({ok: true, id: saved.id, createdAt: saved.created_at, duplicate: saved.id !== id}, saved.id === id ? 201 : 200);
}
async function adminRoutes(request, env, path) {
  requireDb(env);
  if (path === '/api/admin/session' && request.method === 'POST') {
    await rateLimit(request, env, 'login', 10, 900);
    const value = await body(request);
    if (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16) fail(503, 'Вход ещё не настроен.');
    if (!await equalSecret(bounded(value.password, 256, true), env.ADMIN_PASSWORD)) fail(401, 'Неверный пароль.');
    const payload = `${Date.now() + 28800000}.${crypto.randomUUID()}`;
    return json({ok: true}, 200, {'Set-Cookie': cookie(`${payload}.${await hmac(env.SESSION_SECRET, payload)}`, request.url)});
  }
  await requireAdmin(request, env);
  if (path === '/api/admin/session' && request.method === 'GET') return json({ok: true});
  if (path === '/api/admin/session' && request.method === 'DELETE') return json({ok: true}, 200, {'Set-Cookie': cookie('', request.url, 0)});
  if (path === '/api/admin/catalog' && request.method === 'GET') { const catalog = await getCatalog(env); return json({catalog, collectionEnabled: ready(catalog, env)}); }
  if (path === '/api/admin/catalog' && request.method === 'PUT') {
    const value = await body(request, 64 * 1024), catalog = validateCatalog(value.catalog || value);
    await env.DB.prepare(`INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).bind('catalog', JSON.stringify(catalog), iso()).run();
    return json({ok: true, catalog, collectionEnabled: ready(catalog, env)});
  }
  if (path === '/api/admin/leads' && request.method === 'GET') {
    const url = new URL(request.url), status = url.searchParams.get('status') || '', cursor = url.searchParams.get('cursor') || '';
    if (status && !['new', 'contacted', 'closed'].includes(status)) fail(400, 'Некорректный статус.');
    let created = '', id = '';
    if (cursor) { try { [created, id] = JSON.parse(atob(cursor)); } catch { fail(400, 'Некорректная страница.'); } if (typeof created !== 'string' || typeof id !== 'string' || created.length > 30 || id.length > 40) fail(400, 'Некорректная страница.'); }
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 30));
    const result = await env.DB.prepare(`SELECT id,name,contact,channel,citizenship,citizenship_other AS citizenshipOther,destination,purpose,residence,comment,status,created_at AS createdAt,updated_at AS updatedAt FROM leads WHERE (?='' OR status=?) AND (?='' OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?`).bind(status, status, created, created, created, id, limit + 1).all();
    const leads = result.results.slice(0, limit), last = leads.at(-1);
    return json({leads, nextCursor: result.results.length > limit ? btoa(JSON.stringify([last.createdAt, last.id])) : null});
  }
  const match = path.match(/^\/api\/admin\/leads\/([a-f\d-]{36})$/);
  if (match && request.method === 'PATCH') {
    const value = await body(request);
    if (!['new', 'contacted', 'closed'].includes(value.status)) fail(400, 'Некорректный статус.');
    const changed = await env.DB.prepare(`UPDATE leads SET status=?,updated_at=? WHERE id=? RETURNING id`).bind(value.status, iso(), match[1]).first();
    if (!changed) fail(404, 'Заявка не найдена.');
    return json({ok: true});
  }
  if (match && request.method === 'DELETE') {
    const deleted = await env.DB.prepare(`DELETE FROM leads WHERE id=? RETURNING id`).bind(match[1]).first();
    if (!deleted) fail(404, 'Заявка не найдена.');
    return json({ok: true});
  }
  if (path === '/api/admin/metrics' && request.method === 'GET') {
    const [leads, notifications, events] = await Promise.all([
      env.DB.prepare(`SELECT status,COUNT(*) AS count FROM leads GROUP BY status`).all(),
      env.DB.prepare(`SELECT status,COUNT(*) AS count FROM notification_outbox GROUP BY status`).all(),
      env.DB.prepare(`SELECT day,type,SUM(count) AS count FROM events WHERE day>=? GROUP BY day,type ORDER BY day DESC`).bind(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)).all()
    ]);
    return json({leads: leads.results, notifications: notifications.results, events: events.results, notificationConfigured: notificationConfigured(env)});
  }
  fail(404, 'Не найдено.');
}
export async function deliverNotifications(env) {
  if (!env.DB) return;
  const telegram = !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID), webhook = !!env.NOTIFICATION_WEBHOOK_URL;
  if (!telegram && !webhook) return; // Retain pending rows until a real channel is configured.
  const now = iso(), lease = new Date(Date.now() + 60000).toISOString();
  const pending = await env.DB.prepare(`UPDATE notification_outbox SET lease_until=? WHERE id IN (SELECT id FROM notification_outbox WHERE status='pending' AND next_at<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY next_at LIMIT 10) RETURNING id,lead_id,attempts`).bind(lease, now, now).all();
  for (const row of pending.results) {
    try {
      const lead = await env.DB.prepare(`SELECT id,destination,purpose,created_at FROM leads WHERE id=?`).bind(row.lead_id).first();
      if (!lead) continue;
      const adminUrl = env.PUBLIC_ORIGIN ? `${new URL(env.PUBLIC_ORIGIN).origin}/admin.html` : '';
      const summary = {event: 'visa2go.lead.created', id: lead.id, destination: lead.destination, purpose: lead.purpose, createdAt: lead.created_at, adminUrl};
      let response;
      if (telegram) {
        response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({chat_id: env.TELEGRAM_CHAT_ID, text: `Новая заявка Visa2Go\n${lead.id}\nНаправление: ${lead.destination}\nЦель: ${lead.purpose}${adminUrl ? `\n${adminUrl}` : ''}`}), signal: AbortSignal.timeout(10000)});
        if (!response.ok || !(await response.json()).ok) throw new Error('delivery_failed');
      } else {
        const url = new URL(env.NOTIFICATION_WEBHOOK_URL);
        if (url.protocol !== 'https:') throw new Error('invalid_webhook');
        response = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json', ...(env.NOTIFICATION_WEBHOOK_SECRET ? {'Authorization': `Bearer ${env.NOTIFICATION_WEBHOOK_SECRET}`} : {})}, body: JSON.stringify(summary), signal: AbortSignal.timeout(10000)});
        if (!response.ok) throw new Error('delivery_failed');
      }
      await env.DB.prepare(`UPDATE notification_outbox SET status='delivered',attempts=attempts+1,delivered_at=?,lease_until=NULL,last_error=NULL WHERE id=?`).bind(iso(), row.id).run();
    } catch {
      const attempts = row.attempts + 1, next = new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(attempts, 6))).toISOString();
      await env.DB.prepare(`UPDATE notification_outbox SET status=?,attempts=?,next_at=?,lease_until=NULL,last_error=? WHERE id=?`).bind(attempts >= 8 ? 'failed' : 'pending', attempts, next, 'Доставка не подтверждена', row.id).run();
    }
  }
}
export default {
  async fetch(request, env, context) {
    const url = new URL(request.url), path = url.pathname;
    if (path === '/config/site.json' && request.method === 'GET' && env.ASSETS) {
      const original = await env.ASSETS.fetch(request);
      if (!original.ok) return original;
      try { return json({...await original.json(), apiBase: '/'}); }
      catch { return json({apiBase: '/', catalog: EMPTY_CATALOG}, 503); }
    }
    if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', {status: 404});
    let origin;
    try {
      origin = approvedOrigin(request, env, path.startsWith('/api/admin'));
      if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...(origin ? {'Access-Control-Allow-Origin': origin, 'Vary': 'Origin'} : {}), 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}});
      let response;
      if (path === '/api/catalog' && request.method === 'GET') { const catalog = await getCatalog(env); response = json({catalog, collectionEnabled: ready(catalog, env)}); }
      else if (path === '/api/health' && request.method === 'GET') response = json({ok: true, storage: !!env.DB, version: env.SOURCE_SHA || 'development'});
      else if (path === '/api/leads' && request.method === 'POST') response = await submitLead(request, env, context);
      else if (path === '/api/events' && request.method === 'POST') {
        requireDb(env); await rateLimit(request, env, 'events', 120, 60);
        const value = await body(request);
        if (Object.keys(value).some(key => !['type', 'destination', 'purpose'].includes(key)) || !['page_view', 'form_start', 'form_submit'].includes(value.type)) fail(400, 'Некорректное событие.');
        const catalog = await getCatalog(env), destination = bounded(value.destination, 10), purpose = bounded(value.purpose, 10);
        if (destination && destination !== 'undecided' && !catalog.destinations.some(c => c.id === destination)) fail(400, 'Некорректное направление.');
        if (purpose && !PURPOSES.has(purpose)) fail(400, 'Некорректная цель.');
        await env.DB.prepare(`INSERT INTO events(day,type,destination,purpose,count) VALUES(?,?,?,?,1) ON CONFLICT(day,type,destination,purpose) DO UPDATE SET count=count+1`).bind(iso().slice(0, 10), value.type, destination, purpose).run();
        response = json({ok: true});
      } else if (path.startsWith('/api/admin/')) response = await adminRoutes(request, env, path);
      else fail(404, 'Не найдено.');
      if (origin) { response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Vary', 'Origin'); }
      return response;
    } catch (error) {
      const response = json({ok: false, error: error instanceof HttpError ? error.message : 'Сервис временно недоступен. Попробуйте ещё раз.'}, error instanceof HttpError ? error.status : 503);
      if (origin) { response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Vary', 'Origin'); }
      return response;
    }
  },
  async scheduled(_controller, env) {
    await deliverNotifications(env);
    if (env.DB) await env.DB.batch([
      env.DB.prepare(`DELETE FROM rate_limits WHERE expires_at<?`).bind(Math.floor(Date.now() / 1000)),
      env.DB.prepare(`DELETE FROM events WHERE day<?`).bind(new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
    ]);
  }
};
