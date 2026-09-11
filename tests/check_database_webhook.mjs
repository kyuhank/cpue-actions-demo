// Exercise the real Edge Function handler with controlled HTTP boundaries.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const secrets = {WORKSHOP_WEBHOOK_SECRET:'test-webhook', WORKSHOP_RELAY_SECRET:'test-relay'};
globalThis.workshopTestDeno = {env:{get:name=>secrets[name]}, serve:()=>{}};
const source = readFileSync(new URL('../supabase/functions/dispatch-workshop/index.ts', import.meta.url));
const {handle} = await import('data:text/javascript,' + encodeURIComponent('const Deno = globalThis.workshopTestDeno;\n' + source.toString().replace('request: Request','request')));
const event = {type:'INSERT', schema:'public', table:'cpue_releases', record:{version:2024}};
let calls = [];
let pointer = {active:true, expires:new Date(Date.now()+60000).toISOString(), url:'https://workshop-test.trycloudflare.com'};
globalThis.fetch = async (url, options) => {
  calls.push({url, options});
  return url.startsWith('https://raw.githubusercontent.com/')
    ? Response.json(pointer) : new Response('{}', {status:202});
};
const request = (data=event, secret='test-webhook') => new Request('https://example.supabase.co/functions/v1/dispatch-workshop',
  {method:'POST',headers:{'x-workshop-webhook':secret},body:JSON.stringify(data)});
assert.equal((await handle(request(event, 'wrong'))).status,403);
for (const data of [null, {...event,table:'private_data'}, {...event,record:{version:9999}}, {...event,record:{version:'2024'}}])
  assert.equal((await handle(request(data))).status,400);
assert.equal(calls.length,0);
assert.equal((await handle(request())).status,202);
assert.equal(calls.length,2);
assert.equal(calls[1].url,'https://workshop-test.trycloudflare.com/api/database-release');
assert.equal(calls[1].options.headers['X-Workshop-Relay'],'test-relay');
assert.deepEqual(JSON.parse(calls[1].options.body),{version:2024});
assert.equal(calls[1].options.redirect,'error');
for (const url of ['https://attacker.example','http://workshop-test.trycloudflare.com','https://workshop-test.trycloudflare.com@attacker.example','https://api.trycloudflare.com']) {
  pointer.url=url;calls=[];
  assert.equal((await handle(request())).status,503);
  assert.equal(calls.length,1);
}
pointer.url='https://workshop-test.trycloudflare.com';pointer.expires='2000-01-01';calls=[];
assert.equal((await handle(request())).status,503);
assert.equal(calls.length,1);
assert(!source.toString().includes('WORKSHOP_GITHUB_TOKEN'));
console.log('Database webhook: authenticated events, exact release contract, active fixed host, no GitHub credential or redirects.');
