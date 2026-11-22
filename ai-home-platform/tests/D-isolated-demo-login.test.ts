import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
import {readOwnerSessionState} from '../src/lib/owner-auth';
import {readStaffSession} from '../src/lib/staff-auth';

test('isolated demo refuses normal mode and arbitrary identity; rotates roles and preserves secure cookies',async t=>{
 const path=join(mkdtempSync(join(tmpdir(),'role-demo-')),'isolated-role-demo.db');
 const url='file:'+path.replaceAll('\\','/');
 execFileSync(process.execPath,[resolve('node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{env:{...process.env,DATABASE_URL:url},stdio:'pipe'});
 const db=new PrismaClient({datasources:{db:{url}}});t.after(()=>db.$disconnect());
 await db.serviceProvider.create({data:{id:'provider-a',name:'Synthetic',city:'深圳',kind:'construction',tagsJson:'[]'}});
 await db.user.createMany({data:[{id:'demo-owner',name:'Demo',role:'owner'},{id:'demo-provider-account',name:'Demo',role:'provider',providerId:'provider-a'},{id:'isolated-demo-admin',name:'Demo',role:'admin'},{id:'isolated-demo-marker',name:'isolated-role-demo-v1',role:'system'}]});
 const mod=await import('../src/lib/isolated-demo-login').catch(()=>null);
 assert.ok(mod,'isolated demo login handler must exist');
 const req=(body:unknown,cookie='',origin='https://demo.example')=>new Request('https://demo.example/api/auth/experience',{method:'POST',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 const api=mod.createIsolatedDemoHandlers(db,{enabled:true,databaseUrl:url});
 assert.equal((await mod.createIsolatedDemoHandlers(db,{enabled:false,databaseUrl:url}).POST(req({role:'admin'}))).status,404);
 assert.equal((await api.POST(req({role:'owner',userId:'another'}))).status,400);
 assert.equal((await api.POST(req({role:'admin'},'','https://evil.example'))).status,403);
 let previous='';
 for(const role of ['owner','provider','admin'] as const){
  const response=await api.POST(req({role},previous));assert.equal(response.status,200);
  const cookies=response.headers.getSetCookie();
  const live=cookies.find(c=>c.startsWith('__Host-ai_home_'+role+'_session=')&&!c.includes('Max-Age=0'))!;
  assert.ok(live);assert.match(live,/HttpOnly; Secure; SameSite=Strict/);
  if(previous){const oldReq=new Request('https://demo.example',{headers:{cookie:previous}});assert.equal((await readOwnerSessionState(oldReq,db)).status,'signed_out');assert.equal(await readStaffSession(oldReq,db,'provider'),null);}
  previous=live.split(';')[0];
  const r=new Request('https://demo.example',{headers:{cookie:previous}});
  if(role==='owner')assert.equal((await readOwnerSessionState(r,db)).status,'signed_in');
  else assert.equal((await readStaffSession(r,db,role))?.identity.role,role);
 }
 await db.ownerCredential.create({data:{userId:'demo-owner',login:'unexpected-real-account',passwordHash:'not-a-real-hash'}});
 assert.equal((await api.POST(req({role:'admin'}))).status,404);
});
