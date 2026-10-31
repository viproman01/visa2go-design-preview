import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker, {deliverNotifications} from './worker.mjs';
import {SQLiteD1} from './sqlite-adapter.mjs';

const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const catalog = {
  citizenships: [{id: 'RU', name: 'Россия'}, {id: 'KZ', name: 'Казахстан'}],
  destinations: [{id: 'DE', name: 'Германия', services: ['study', 'work'], city: 'Берлин', image: 'assets/germany.jpg', popular: true}],
  company: {legalName: 'Test organisation', address: 'Test address', jurisdiction: 'Test country'},
  contacts: {email: 'testing@example.org'}, legal: {privacyVersion: 'test-v1', termsVersion: 'test-v1'}, reviewed: true
};
function setup() {
  const DB = new SQLiteD1(); DB.exec(schema);
  DB.database.prepare('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?)').run('catalog', JSON.stringify(catalog), new Date().toISOString());
  return {DB, SESSION_SECRET: 'test-session-secret-with-at-least-32-characters', ADMIN_PASSWORD: 'test-long-admin-password', LEAD_COLLECTION_ENABLED: 'true', LEGAL_DOCUMENTS_APPROVED: 'true', NOTIFICATION_WEBHOOK_URL: 'https://notification.example/hook', LOCAL_TEST: 'true'};
}
function request(path, data, method = 'POST', headers = {}) {
  return new Request(`https://visa2go.example${path}`, {method, headers: {Origin: 'https://visa2go.example', ...(data ? {'Content-Type': 'application/json'} : {}), ...headers}, ...(data ? {body: JSON.stringify(data)} : {})});
}
function lead(overrides = {}) { return {requestId: crypto.randomUUID(), name: 'Test Visitor', contact: 'visitor@example.org', channel: 'email', citizenship: 'RU', destination: 'DE', purpose: 'study', comment: 'Test request', consent: true, website: '', ...overrides}; }
async function adminCookie(env) {
  const response = await worker.fetch(request('/api/admin/session', {password: env.ADMIN_PASSWORD}), env);
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
test('durable lead save and idempotent retry produce one row and one notification', async () => {
  const env = setup(), payload = lead();
  const first = await worker.fetch(request('/api/leads', payload), env), saved = await first.json();
  assert.equal(first.status, 201); assert.ok(saved.id);
  const retry = await worker.fetch(request('/api/leads', payload), env), retried = await retry.json();
  assert.equal(retry.status, 200); assert.equal(retried.id, saved.id); assert.equal(retried.duplicate, true);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n, 1);
  const changed = await worker.fetch(request('/api/leads', {...payload, name: 'Different'}), env);
  assert.equal(changed.status, 409); env.DB.close();
});
test('disabled collection and missing DB fail closed without false success', async () => {
  const env = setup(); env.LEAD_COLLECTION_ENABLED = 'false';
  assert.equal((await worker.fetch(request('/api/leads', lead()), env)).status, 503);
  assert.equal((await worker.fetch(request('/api/leads', lead()), {})).status, 503);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 0); env.DB.close();
});
test('missing company metadata or unreviewed catalog blocks collection', async () => {
  for (const change of [{reviewed: false}, {company: {}}, {contacts: {}}, {legal: {}}]) {
    const env = setup();
    env.DB.database.prepare('UPDATE settings SET value=?').run(JSON.stringify({...catalog, ...change}));
    assert.equal((await worker.fetch(request('/api/leads', lead()), env)).status, 503); env.DB.close();
  }
});
test('unavailable services, missing consent, honeypot and bad contact are rejected', async () => {
  for (const change of [{purpose: 'tourism'}, {consent: false}, {website: 'spam'}, {contact: 'not-an-email'}, {citizenship: 'XX'}, {destination: 'XX'}, {name: ''}, {comment: 'x'.repeat(2001)}]) {
    const env = setup();
    assert.equal((await worker.fetch(request('/api/leads', lead(change)), env)).status, 400);
    assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 0); env.DB.close();
  }
});
test('other citizenship and undecided destination retain explicitly entered data', async () => {
  const env = setup();
  assert.equal((await worker.fetch(request('/api/leads', lead({citizenship: 'other', citizenshipOther: 'A different nationality', destination: 'undecided'})), env)).status, 201);
  const saved = env.DB.database.prepare('SELECT citizenship_other,destination FROM leads').get();
  assert.equal(saved.citizenship_other, 'A different nationality'); assert.equal(saved.destination, 'undecided'); env.DB.close();
});
test('citizenship outside popular eight countries is accepted from the full ISO list', async () => {
  const env = setup();
  assert.equal((await worker.fetch(request('/api/leads', lead({citizenship: 'US'})), env)).status, 201);
  assert.equal((await worker.fetch(request('/api/leads', lead({citizenship: 'FR'})), env)).status, 201); env.DB.close();
});
test('database failure never returns saved response', async () => {
  const env = setup(); env.DB.batch = async () => { throw new Error('simulated DB failure'); };
  assert.equal((await worker.fetch(request('/api/leads', lead()), env)).status, 503);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 0); env.DB.close();
});
test('IP rate limiting stores keyed hashes, never raw addresses', async () => {
  const env = setup();
  for (let i = 0; i < 8; i++) assert.equal((await worker.fetch(request('/api/leads', lead()), env)).status, 201);
  assert.equal((await worker.fetch(request('/api/leads', lead()), env)).status, 429);
  const row = env.DB.database.prepare('SELECT key,count FROM rate_limits').get();
  assert.match(row.key, /^[a-f\d]{64}$/); assert.equal(row.count, 9); env.DB.close();
});
test('origin checks prevent cross-site writes and admin access', async () => {
  const env = setup();
  assert.equal((await worker.fetch(request('/api/leads', lead(), 'POST', {Origin: 'https://evil.example'}), env)).status, 403);
  assert.equal((await worker.fetch(request('/api/admin/session', {password: env.ADMIN_PASSWORD}, 'POST', {Origin: 'https://evil.example'}), env)).status, 403);
  env.ALLOWED_ORIGINS = 'https://frontend.example';
  const response = await worker.fetch(request('/api/leads', lead(), 'POST', {Origin: 'https://frontend.example'}), env);
  assert.equal(response.status, 201); assert.equal(response.headers.get('access-control-allow-origin'), 'https://frontend.example'); env.DB.close();
});
test('admin endpoints protect contact data and sessions use secure HttpOnly cookie', async () => {
  const env = setup();
  assert.equal((await worker.fetch(request('/api/admin/leads', null, 'GET'), env)).status, 401);
  assert.equal((await worker.fetch(request('/api/admin/session', {password: 'wrong-password'}), env)).status, 401);
  const login = await worker.fetch(request('/api/admin/session', {password: env.ADMIN_PASSWORD}), env);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  const authenticated = await worker.fetch(request('/api/admin/session', null, 'GET', {Cookie: cookie.split(';')[0]}), env);
  assert.equal(authenticated.status, 200);
  const forged = await worker.fetch(request('/api/admin/session', null, 'GET', {Cookie: `${cookie.split(';')[0]}tampered`}), env);
  assert.equal(forged.status, 401); env.DB.close();
});
test('admin reads and updates leads; catalog save keeps descriptive fields', async () => {
  const env = setup(), cookie = await adminCookie(env), headers = {Cookie: cookie};
  const saved = await (await worker.fetch(request('/api/leads', lead()), env)).json();
  let response = await worker.fetch(request('/api/admin/leads', null, 'GET', headers), env);
  const result = await response.json(); assert.equal(result.leads[0].contact, 'visitor@example.org');
  assert.equal((await worker.fetch(request(`/api/admin/leads/${saved.id}`, {status: 'contacted'}, 'PATCH', headers), env)).status, 200);
  response = await worker.fetch(request('/api/admin/catalog', {catalog}, 'PUT', headers), env);
  assert.equal(response.status, 200); assert.equal((await response.json()).catalog.destinations[0].city, 'Берлин');
  const filtered = await (await worker.fetch(request('/api/admin/leads?status=new', null, 'GET', headers), env)).json(); assert.equal(filtered.leads.length, 0);
  env.DB.close();
});
test('public event API rejects personal fields and aggregates only allowed dimensions', async () => {
  const env = setup();
  assert.equal((await worker.fetch(request('/api/events', {type: 'form_start', email: 'private@example.org'}), env)).status, 400);
  for (let i = 0; i < 2; i++) assert.equal((await worker.fetch(request('/api/events', {type: 'form_start', destination: 'DE', purpose: 'study'}), env)).status, 200);
  assert.equal(env.DB.database.prepare('SELECT count FROM events').get().count, 2);
  env.DB.close();
});
test('notification remains pending without channel; fails retryably; marks delivered only after success', async () => {
  const env = setup();
  await worker.fetch(request('/api/leads', lead()), env);
  delete env.NOTIFICATION_WEBHOOK_URL;
  await deliverNotifications(env);
  assert.equal(env.DB.database.prepare('SELECT status,attempts FROM notification_outbox').get().attempts, 0);
  env.NOTIFICATION_WEBHOOK_URL = 'https://notification.example/hook';
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', {status: 500});
    await deliverNotifications(env);
    let status = env.DB.database.prepare('SELECT status,attempts FROM notification_outbox').get();
    assert.equal(status.status, 'pending'); assert.equal(status.attempts, 1);
    env.DB.database.prepare('UPDATE notification_outbox SET next_at=?').run('2000-01-01T00:00:00.000Z');
    globalThis.fetch = async (_url, options) => { const payload = JSON.parse(options.body); assert.equal(payload.contact, undefined); assert.equal(payload.name, undefined); assert.ok(payload.id); return new Response('', {status: 200}); };
    await deliverNotifications(env);
    status = env.DB.database.prepare('SELECT status,attempts FROM notification_outbox').get();
    assert.equal(status.status, 'delivered'); assert.equal(status.attempts, 2);
  } finally { globalThis.fetch = originalFetch; env.DB.close(); }
});
test('oversized requests and incorrect content type rejected before data write', async () => {
  const env = setup();
  assert.equal((await worker.fetch(request('/api/leads', lead({comment: 'x'.repeat(17000)})), env)).status, 413);
  assert.equal((await worker.fetch(request('/api/leads', lead(), 'POST', {'Content-Type': 'text/plain'}), env)).status, 415); env.DB.close();
});
test('scheduled cleanup expires only transient hashes and old aggregate events', async () => {
  const env = setup(); await worker.fetch(request('/api/leads', lead()), env);
  delete env.NOTIFICATION_WEBHOOK_URL;
  env.DB.database.prepare('INSERT INTO rate_limits VALUES(?,?,?)').run('expired-hash', 1, 1);
  env.DB.database.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run('2000-01-01', 'page_view', '', '', 1);
  await worker.scheduled({}, env);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM rate_limits WHERE key=?').get('expired-hash').n, 0);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 1); env.DB.close();
});
test('reviewed catalogue alone never enables intake without approved legal pages and notification channel', async () => {
  for (const settings of [{LEGAL_DOCUMENTS_APPROVED: 'false'}, {NOTIFICATION_WEBHOOK_URL: ''}, {NOTIFICATION_WEBHOOK_URL: 'http://unsafe.example'}, {LEAD_COLLECTION_ENABLED: 'false'}]) {
    const env = {...setup(), ...settings};
    const response = await worker.fetch(request('/api/catalog', null, 'GET'), env);
    assert.equal((await response.json()).collectionEnabled, false);
    assert.equal((await worker.fetch(request('/api/leads', lead()), env)).status, 503); env.DB.close();
  }
});
test('catalogue normalizes contact formats accepted by admin UI', async () => {
  const env = setup(), Cookie = await adminCookie(env);
  const response = await worker.fetch(request('/api/admin/catalog', {catalog: {...catalog, contacts: {telegram: ' @visa2go_team ', whatsapp: ' +7 (777) 123-45-67 ', email: ' team@example.org '}}}, 'PUT', {Cookie}), env);
  assert.equal(response.status, 200);
  const saved = (await response.json()).catalog.contacts;
  assert.equal(saved.telegram, 'https://t.me/visa2go_team'); assert.equal(saved.whatsapp, '+77771234567'); assert.equal(saved.email, 'team@example.org');
  env.DB.close();
});
test('phone digit count cannot be padded using separators', async () => {
  for (const contact of ['+1 (2) ---', '+1234567890123456', '+0 (777) 1234567']) {
    const env = setup();
    assert.equal((await worker.fetch(request('/api/leads', lead({channel: 'whatsapp', contact})), env)).status, 400); env.DB.close();
  }
});
test('authorized deletion removes lead and associated notification; anonymous deletion is denied', async () => {
  const env = setup(), Cookie = await adminCookie(env);
  const {id} = await (await worker.fetch(request('/api/leads', lead()), env)).json();
  assert.equal((await worker.fetch(request(`/api/admin/leads/${id}`, null, 'DELETE'), env)).status, 401);
  assert.equal((await worker.fetch(request(`/api/admin/leads/${id}`, null, 'DELETE', {Cookie}), env)).status, 200);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n, 0);
  assert.equal(env.DB.database.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 0); env.DB.close();
});
test('same-origin host enables API config but static fallback never implies reviewed catalog', async () => {
  const env = setup();
  env.DB.database.prepare('DELETE FROM settings').run();
  env.ASSETS = {fetch: async () => new Response(JSON.stringify({apiBase: '', catalog}), {headers: {'Content-Type': 'application/json'}})};
  const config = await (await worker.fetch(request('/config/site.json', null, 'GET'), env)).json();
  assert.equal(config.apiBase, '/');
  const publicCatalog = await (await worker.fetch(request('/api/catalog', null, 'GET'), env)).json();
  assert.equal(publicCatalog.catalog.destinations[0].id, 'DE');
  assert.equal(publicCatalog.catalog.reviewed, false); assert.equal(publicCatalog.collectionEnabled, false); env.DB.close();
});
