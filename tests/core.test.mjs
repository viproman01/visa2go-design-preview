import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {contactError,contactHref,findCountry,safeImage,safeApiBase,purposes} from '../core.js';
import map from '../assets/world-map.js';
test('Contact validation rejects malformed input and accepts supported channels',()=>{
  assert.equal(contactError('email','preview@example.com'),'');
  assert.ok(contactError('email','not-email'));
  assert.equal(contactError('telegram','@preview_test'),'');
  assert.equal(contactError('telegram','https://t.me/preview_test'),'');
  assert.ok(contactError('telegram','@a'));
  assert.equal(contactError('whatsapp','+7 (700) 123-45-67'),'');
  assert.ok(contactError('whatsapp','000-1234'));
  assert.ok(contactError('whatsapp','+1------'));
  assert.ok(contactError('whatsapp','+123456789012345678'));
});
test('Contact links cannot execute code or navigate to unrelated hosts',()=>{
  assert.equal(contactHref('telegram','@visa2go_test'),'https://t.me/visa2go_test');
  assert.equal(contactHref('telegram','https://evil.example/a'),null);
  assert.equal(contactHref('whatsapp','+7 (700) 123-45-67'),'https://wa.me/77001234567');
  assert.equal(contactHref('email','javascript:alert(1)'),null);
});
test('Lookup handles casing and Cyrillic ё without inventing a route',()=>{
  const data=[{id:'RU',name:'Россия'},{id:'undecided',name:'Ещё выбираю'}];
  assert.equal(findCountry(data,' россия ').id,'RU');
  assert.equal(findCountry(data,'ЕЩЕ ВЫБИРАЮ').id,'undecided');
  assert.equal(findCountry(data,'made-up'),undefined);
});
test('Config URLs restrict schemes, credentials and image traversal',()=>{
  assert.equal(safeApiBase('javascript:alert(1)','https://example.com'),null);
  assert.equal(safeApiBase('https://user:secret@example.com','https://example.com'),null);
  assert.equal(safeApiBase('/','https://example.com'),'https://example.com');
  assert.equal(safeImage('assets/../secret.jpg'),'assets/alpine-journey-poster.jpg');
  assert.equal(safeImage('https://untrusted.example/img.jpg'),'assets/alpine-journey-poster.jpg');
});
test('Catalog stays preview-gated and all configured countries are selectable on the world map',async()=>{
  const config=JSON.parse(await readFile(new URL('../config/site.json',import.meta.url),'utf8'));
  assert.equal(config.apiBase,'');assert.equal(config.catalog.reviewed,false);
  assert.equal(map.features.length,176);
  const ids=new Set(map.features.map(f=>f.id));assert.equal(ids.size,map.features.length);
  for(const country of config.catalog.destinations){
    assert.ok(ids.has(country.id));assert.ok(country.services.length);
    for(const service of country.services)assert.ok(purposes[service]);
    await readFile(new URL('../'+country.image,import.meta.url));
  }
});
test('Every local homepage asset and legal link resolves',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const paths=[...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1]).filter(p=>!/^https?:/.test(p));
  for(const path of new Set(paths)) await readFile(new URL('../'+path,import.meta.url));
  assert.equal((html.match(/<video /g)||[]).length,1);
  assert.equal((html.match(/<canvas /g)||[]).length,2);
  assert.ok(!html.includes('Мой маршрут'));
});
