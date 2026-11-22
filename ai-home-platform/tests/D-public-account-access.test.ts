import test from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { createPublicAccountAccess } from '../src/lib/public-account-access';
import { readOwnerSessionState } from '../src/lib/owner-auth';
import { readStaffSession } from '../src/lib/staff-auth';

test('opt-in original accounts preserve business rows and reuse valid sessions', { skip: !process.env.PUBLIC_ACCESS_TEST_DATABASE_URL }, async t => {
  // A local backup copy, never the active business database.
  const url=process.env.PUBLIC_ACCESS_TEST_DATABASE_URL;
  assert.ok(url?.includes('public-access-test.db'), 'explicit test database required');
  const db=new PrismaClient({datasources:{db:{url}}});
  t.after(()=>db.$disconnect());
  const snapshot=async()=>JSON.stringify(await Promise.all([db.demandOrder.findMany({orderBy:{id:'asc'}}),db.quote.findMany({orderBy:{id:'asc'}}),db.serviceOrder.findMany({orderBy:{id:'asc'}})]));
  const before=await snapshot();
  const accounts={owner:'roadshow-owner',provider:'demo-provider-account',admin:'roadshow-admin'};
  const api=createPublicAccountAccess(db,{enabled:true,accounts});
  const req=(body:unknown,cookie='',origin='https://platform.example')=>new Request('https://platform.example/api/auth/public-access',{method:'POST',headers:{origin,cookie},body:JSON.stringify(body)});
  assert.equal((await createPublicAccountAccess(db,{enabled:false,accounts})(req({role:'owner'}))).status,404);
  assert.equal((await api(req({role:'owner',userId:'demo-owner'}))).status,400);
  assert.equal((await api(req({role:'owner'},'','https://evil.example'))).status,403);
  assert.equal((await createPublicAccountAccess(db,{enabled:true,accounts:{...accounts,owner:'missing'}})(req({role:'owner'}))).status,503);
  for(const role of ['owner','provider','admin'] as const){
    const result=await api(req({role})); assert.equal(result.status,200);
    const cookie=result.headers.getSetCookie().find(s=>s.startsWith(`__Host-ai_home_${role}_session=`)&&!s.includes('Max-Age=0'))!;
    assert.ok(cookie); assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
    const request=new Request('https://platform.example',{headers:{cookie:cookie.split(';')[0]}});
    const state=role==='owner'?await readOwnerSessionState(request,db):await readStaffSession(request,db,role);
    assert.ok(state&&'identity' in state); assert.equal(state.identity.userId,accounts[role]);
    const again=await api(req({role},cookie.split(';')[0])); assert.equal((await again.json()).data.changed,false);
  }
  assert.equal(await snapshot(),before);
});
