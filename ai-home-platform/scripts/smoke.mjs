import assert from 'node:assert/strict';
import { require as tsRequire } from 'tsx/cjs/api';
const base = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000';
let demoSchedule;
let demoTickets;
for (const route of ['/', '/owner', '/owner/demand/chat', '/owner/demand/demo-demand', '/owner/matches/demo-demand', '/owner/quotes/demo-demand', '/owner/project/demo-demand', '/owner/payments/demo-demand', '/provider', '/provider/demand/demo-demand', '/provider/orders', '/admin', '/admin/tickets']) {
 const response = await fetch(base + route);
 assert.equal(response.status, 200, route);
 assert.match(await response.text(), /模拟|待开发/);
}
for (const route of ['/api/health', '/api/demand', '/api/provider', '/api/match', '/api/quote', '/api/schedule', '/api/payment', '/api/ticket']) {
 const response = await fetch(base + route);
 assert.equal(response.status, 200, route);
 const payload = await response.json();
 assert.equal(payload.ok, true);
 if (route === '/api/demand') {
  assert.ok(['mock', 'live'].includes(payload.meta.source));
  assert.ok(payload.data.every(demand => demand.status === 'published' && !('ownerId' in demand)));
  assert.ok(payload.data.some(demand => demand.id === 'demo-demand'));
 }
 else assert.equal(payload.meta.source, 'mock');
 if (route === '/api/schedule') demoSchedule = payload.data;
 if (route === '/api/ticket') demoTickets = payload.data;
}
const demoDetail = await fetch(base + '/api/demand/demo-demand');
assert.equal(demoDetail.status, 200);
const demoPayload = await demoDetail.json();
assert.equal(demoPayload.meta.source, 'mock');
assert.equal(demoPayload.data.status, 'published');
assert.equal('ownerId' in demoPayload.data, false);
for (const route of ['/api/demand', '/api/demand/demo-demand']) {
 const invalidOwner = await fetch(base + route, { headers: { Cookie: '__Host-ai_home_owner_session=invalid' } });
 assert.equal(invalidOwner.status, 401, `${route} must not downgrade an invalid owner cookie to public access`);
 assert.equal(invalidOwner.headers.get('cache-control'), 'private, no-store');
 assert.ok((invalidOwner.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
 const failure = await invalidOwner.json();
 assert.equal(failure.ok, false); assert.equal(failure.error.code, 'UNAUTHENTICATED');
 assert.equal('data' in failure, false);
}
const missingDetail = await fetch(base + '/api/demand/missing-demand');
assert.equal(missingDetail.status, 404);
// A client-supplied provider identity never substitutes for an actual order and session.
for (const [path, headers, status, code] of [
 ['/api/demand/missing-demand', { Cookie: 'ai_home_demo_session=invalid', 'X-Provider-Id': 'provider-a' }, 404, 'DEMAND_NOT_FOUND'],
 ['/api/demand/demo-demand?providerId=provider-a', {}, 400, 'VALIDATION_ERROR'],
]) {
 const response = await fetch(base + path, { headers });
 assert.equal(response.status, status, 'provider demand detail authorization');
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.match(response.headers.get('vary') ?? '', /Cookie/i);
 const body = await response.json();
 assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal('data' in body, false);
}
for (const path of ['/api/schedule?demandId=demo-demand', '/api/schedule?demandId=demo-demand&version=1']) {
 const response = await fetch(base + path);
 assert.equal(response.status, 200, path);
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.ok((response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
 const body = await response.json();
 assert.equal(body.ok, true); assert.equal(body.meta.source, 'mock');
 assert.equal(body.data.demandId, 'demo-demand'); assert.equal(body.data.version, 1);
 assert.deepEqual(body.data, demoSchedule);
}
for (const [path, status, code] of [
 ['/api/schedule?demandId=smoke-private-demand', 401, 'UNAUTHENTICATED'],
 ['/api/schedule?demandId=demo-demand&version=2', 404, 'SCHEDULE_NOT_FOUND'],
 ['/api/schedule?unknown=', 400, 'VALIDATION_ERROR'],
]) {
 const response = await fetch(base + path);
 assert.equal(response.status, status, path);
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.ok((response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
 const body = await response.json();
 assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal('data' in body, false);
}
for (const path of ['/api/schedule', '/api/schedule?demandId=demo-demand', '/api/schedule?demandId=demo-demand&version=1']) {
 const response = await fetch(base + path, { headers: { Cookie: '__Host-ai_home_owner_session=invalid' } });
 assert.equal(response.status, 401, `${path} must reject an invalid owner cookie`);
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.ok((response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
 const body = await response.json();
 assert.equal(body.ok, false); assert.equal(body.error.code, 'UNAUTHENTICATED'); assert.equal('data' in body, false);
}
const ticketDemo = await fetch(base + '/api/ticket?demandId=demo-demand');
assert.equal(ticketDemo.status, 200);
assert.equal(ticketDemo.headers.get('cache-control'), 'private, no-store');
const ticketDemoBody = await ticketDemo.json();
assert.equal(ticketDemoBody.ok, true); assert.equal(ticketDemoBody.meta.source, 'mock');
assert.deepEqual(ticketDemoBody.data, demoTickets);
assert.ok(ticketDemoBody.data.length > 0);
assert.ok(ticketDemoBody.data.every(ticket => ticket.demandId === 'demo-demand'));
for (const [path, cookie, status, code] of [
 ['/api/ticket?demandId=smoke-private-demand', '', 401, 'UNAUTHENTICATED'],
 ['/api/ticket?unknown=', '', 400, 'VALIDATION_ERROR'],
 ...['/api/ticket', '/api/ticket?demandId=demo-demand', '/api/ticket?demandId=smoke-private-demand']
  .map(path => [path, '__Host-ai_home_owner_session=invalid', 401, 'UNAUTHENTICATED']),
]) {
 const response = await fetch(base + path, { headers: { Cookie: cookie } });
 assert.equal(response.status, status, path);
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.ok((response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
 const body = await response.json();
 assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal('data' in body, false);
}
// Implemented owner-only writes: anonymous smoke must never create fixtures.
for (const path of ['/api/schedule', '/api/ticket', '/api/order', '/api/order/progress', '/api/inspect', '/api/inspect/images', '/api/review']) {
for (const [headers, status, code] of [
 [{}, 403, 'FORBIDDEN'],
 [{ Origin: new URL(base).origin }, 401, 'UNAUTHENTICATED'],
 [{ Origin: new URL(base).origin, Cookie: '__Host-ai_home_owner_session=invalid' }, 401, 'UNAUTHENTICATED'],
]) {
 const response = await fetch(base + path, { method: 'POST', headers });
 assert.equal(response.status, status, `${path} creation authorization`);
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.ok((response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
 const body = await response.json();
 assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal('data' in body, false);
}
}
// Orders are never inferred from public demo quotes; the provider list requires a verified session.
for (const path of ['/api/order', '/api/order/progress']) {
for (const [query, cookie, status, code] of [
 ['', '', 400, 'VALIDATION_ERROR'],
 ['?demandId=', '', 400, 'VALIDATION_ERROR'],
 ['?demandId=one&demandId=one', '', 400, 'VALIDATION_ERROR'],
 ['?demandId=one&ownerId=owner', '', 400, 'VALIDATION_ERROR'],
 ['?demandId=demo-demand', '', 401, 'UNAUTHENTICATED'],
 ['?demandId=smoke-private-demand', '', 401, 'UNAUTHENTICATED'],
 ['?demandId=demo-demand', '__Host-ai_home_owner_session=invalid', 401, 'UNAUTHENTICATED'],
]) {
 const response = await fetch(base + path + query, { headers: { Cookie: cookie } });
 assert.equal(response.status, status, `${path} owner read isolation`);
 assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.match(response.headers.get('vary') ?? '', /Cookie/i);
 const body = await response.json(); assert.equal(body.ok, false); assert.equal(body.error.code, code);
 assert.equal('data' in body, false); assert.equal('meta' in body, false);
}
}
console.log('业主接单及履约记录读取各 7 个参数/匿名/失效凭证场景通过，无公开演示入口。');
for (const [query, cookie, status, code] of [
 ['', '', 401, 'UNAUTHENTICATED'],
 ['', 'ai_home_demo_session=invalid', 401, 'UNAUTHENTICATED'],
 ['?providerId=provider-b', '', 400, 'VALIDATION_ERROR'],
 ['?demandId=demo-demand', '', 400, 'VALIDATION_ERROR'],
]) {
 const response = await fetch(base + '/api/provider/orders' + query, { headers: { Cookie: cookie } });
 assert.equal(response.status, status, 'provider order isolation');
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.ok((response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
 const body = await response.json();
 assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal('data' in body, false);
}
const chat = await fetch(base + '/api/demand/chat', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({messages:[{role:'user',content:'我想翻新浴室'}]}) });
assert.equal(chat.status, 200);
const chatBody = await chat.json();
assert.equal(chatBody.ok, true);
assert.equal(chatBody.meta.source, 'mock', 'CI 使用 mock，不应调用真实供应商或误标 live');
assert.equal(chatBody.data.ready, false);
assert.equal(chatBody.data.draft, null);
assert.match(chatBody.data.reply, /模拟/);
assert.deepEqual(chatBody.data.missingFields, ['city', 'areaM2', 'budgetMinCents', 'budgetMaxCents', 'renovationType', 'desiredDays']);
const bad = await fetch(base + '/api/demand/chat', { method:'POST', body:'invalid json' });
assert.equal(bad.status, 400);
// Revisions require an actual owner session and same-origin explicit confirmation.
for (const [headers, status, code] of [
 [{}, 403, 'FORBIDDEN'],
 [{ Origin: new URL(base).origin }, 401, 'UNAUTHENTICATED'],
 [{ Origin: new URL(base).origin, Cookie: '__Host-ai_home_owner_session=invalid' }, 401, 'UNAUTHENTICATED'],
]) {
 const response = await fetch(base + '/api/schedule', { method: 'PUT', headers });
 assert.equal(response.status, status, 'schedule revision authorization');
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.ok((response.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
 const body = await response.json();
 assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal('data' in body, false);
}
console.log('3 个 PUT 排期修订鉴权场景通过（无同源、匿名与失效凭证均拒绝）。');
console.log('另增 6 个照片 POST 鉴权场景通过（无同源、匿名与失效凭证均拒绝）。');
const { smokeInspectionImages } = tsRequire('./smoke-inspection-images.ts', import.meta.url);
await smokeInspectionImages(base);
for (const [query, cookie, status, code] of [
 ['', '', 400, 'VALIDATION_ERROR'],
 ['?demandId=demo-demand', '', 401, 'UNAUTHENTICATED'],
 ['?demandId=smoke-private-demand', '', 401, 'UNAUTHENTICATED'],
 ['?demandId=demo-demand', '__Host-ai_home_owner_session=invalid', 401, 'UNAUTHENTICATED'],
 ['?demandId=one&demandId=two', '', 400, 'VALIDATION_ERROR'],
]) {
 const response = await fetch(base + '/api/review' + query, { headers: { Cookie: cookie } });
 assert.equal(response.status, status, 'review read isolation');
 assert.equal(response.headers.get('cache-control'), 'private, no-store');
 assert.match(response.headers.get('vary') ?? '', /Cookie/i);
 const body = await response.json();
 assert.equal(body.ok, false); assert.equal(body.error.code, code); assert.equal('data' in body, false);
}
const { smokeReviews } = tsRequire('./smoke-reviews.ts', import.meta.url);
await smokeReviews(base);
console.log('履约推进另增 3 个 POST 同源/匿名/失效凭证拒绝场景通过。');
console.log('评价新增 3 个匿名 POST 与 5 个 GET 边界场景通过，无公开演示评价入口。');
const demandBody = JSON.stringify({
 description: '冒烟测试需求', city: '深圳', areaM2: 60,
 budgetMinCents: 3000000, budgetMaxCents: 5000000,
 renovationType: 'elderly', desiredDays: 30,
});
// Creating a demand requires an actual owner session. Do not write anonymous fixtures.
const unauthenticated = await fetch(base + '/api/demand', {
 method: 'POST',
 headers: {'Content-Type':'application/json', Origin: new URL(base).origin},
 body: demandBody,
});
assert.equal(unauthenticated.status, 401, 'anonymous demand creation');
assert.equal(unauthenticated.headers.get('cache-control'), 'private, no-store');
assert.ok((unauthenticated.headers.get('vary') ?? '').split(',').some(value => value.trim().toLowerCase() === 'cookie'));
const denied = await unauthenticated.json();
assert.equal(denied.ok, false);
assert.equal(denied.error.code, 'UNAUTHENTICATED');
assert.equal('data' in denied, false);
const withoutOrigin = await fetch(base + '/api/demand', {
 method: 'POST', headers: {'Content-Type':'application/json'}, body: demandBody,
});
assert.equal(withoutOrigin.status, 403, 'demand creation without Origin');
const forbidden = await withoutOrigin.json();
assert.equal(forbidden.ok, false);
assert.equal(forbidden.error.code, 'FORBIDDEN');
assert.equal('data' in forbidden, false);
console.log('13 个页面、32 个 GET 场景和 13 个 POST 场景通过（固定演示公开、服务方身份不可自报、真实排期/工单/接单隔离、匿名与失效凭证写入拒绝）。');
