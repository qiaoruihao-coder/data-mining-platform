import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProviderRecommendations } from '../src/lib/provider-recommendation-handler';
import type { PrismaClient } from '@prisma/client';
import { PrismaClient as Client } from '@prisma/client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { issueStaffSession } from '../src/lib/staff-auth';

test('推荐接口拒绝匿名，不读历史或返回缓存', async () => {
  const db = { $transaction: async (fn: (tx: object)=>unknown) => fn({}) } as unknown as PrismaClient;
  const r = await handleProviderRecommendations(new Request('http://localhost/api/provider/recommendations'),db);
  assert.equal(r.status,401);
  assert.equal(r.headers.get('Cache-Control'),'private, no-store');
});

test('隔离数据库验证服务方会话、本人历史与来源隔离，坏成交关系拒绝推荐', async t => {
  const root=resolve(tmpdir()), dir=mkdtempSync(join(root,'ai-home-recommendation-'));
  const url='file:'+join(dir,'test.db').replaceAll('\\','/');
  const db=new Client({datasources:{db:{url}}});
  t.after(async()=>{await db.$disconnect();assert.equal(dirname(resolve(dir)),root);rmSync(dir,{recursive:true,force:true});});
  execFileSync(process.execPath,[resolve('node_modules/prisma/build/index.js'),'db','push','--schema',resolve('prisma/schema.prisma'),'--skip-generate'],{env:{...process.env,DATABASE_URL:url},stdio:'pipe',timeout:30000});
  await db.serviceProvider.createMany({data:['p1','p2'].map(id=>({id,name:id,city:'深圳',kind:'construction',tagsJson:'["适老化"]'}))});
  await db.user.createMany({data:[{id:'owner',name:'owner',role:'owner'},...['p1','p2'].map(id=>({id:'u'+id,name:id,role:'provider',providerId:id}))]});
  for(const [id,providerId,source] of [['h1','p1','mock'],['h2','p2','mock'],['h3','p1','live']]){
    await db.demandOrder.create({data:{id,ownerId:'owner',city:'深圳',description:'合成测试',areaM2:60,budgetMinCents:3000000,budgetMaxCents:5000000,desiredDays:30,renovationType:'elderly',status:'completed'}});
    await db.quote.create({data:{id:'q'+id,demandId:id,providerId,source,status:'accepted',knownTotalCents:0,itemsJson:'[]',pendingItemsJson:'[]',estimatedDays:30}});
    await db.serviceOrder.create({data:{id:'o'+id,demandId:id,providerId,source,status:'completed',acceptedQuoteId:'q'+id}});
  }
  await db.demandOrder.create({data:{id:'new',ownerId:'owner',city:'深圳',description:'测试待接',areaM2:60,budgetMinCents:3000000,budgetMaxCents:5000000,desiredDays:30,renovationType:'elderly',status:'published'}});
  const session=await db.$transaction(tx=>issueStaffSession(new Request('https://localhost'),tx,'up1','provider',new Date()));
  const read=(source:string)=>handleProviderRecommendations(new Request('https://localhost/api/provider/recommendations?historySource='+source,{headers:{Cookie:session.cookie.split(';')[0]}}),db);
  for(const source of ['mock','live']){
    const response=await read(source); assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.data.historyCount,1);assert.deepEqual(body.data.items.map((i:{demand:{id:string}})=>i.demand.id),['new']);
    assert.doesNotMatch(JSON.stringify(body),/ownerId|tokenHash|h2/);
  }
  await db.quote.update({where:{id:'qh1'},data:{status:'rejected'}});
  assert.equal((await read('mock')).status,503);
});
test('拒绝客户端冒用 providerId、重复参数与错误来源', async () => {
  const db = { $transaction: () => { throw new Error('must not query'); } } as unknown as PrismaClient;
  for (const query of ['?providerId=other','?historySource=both','?historySource=live&historySource=mock']) {
    const r = await handleProviderRecommendations(new Request('http://localhost/api/provider/recommendations'+query),db);
    assert.equal(r.status,400);
  }
});
