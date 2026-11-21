import test from 'node:test';
import assert from 'node:assert/strict';
import { recommendDemands } from '../src/lib/provider-recommendations';
import type { DemandDTO, OrderSummaryDTO } from '../src/contracts';
const provider = { id: 'p1', city: '深圳', tags: ['适老化', '防滑'] };
const demand = (id: string, patch: Partial<DemandDTO> = {}): DemandDTO => ({ id, city: '深圳', description: '防滑扶手', areaM2: 60, budgetMinCents: 3000000, budgetMaxCents: 5000000, renovationType: 'elderly', desiredDays: 30, status: 'published', ...patch });
const history = (id: string, patch: Partial<OrderSummaryDTO> = {}, d: Partial<DemandDTO> = {}) => ({ order: { id: 'o-'+id, providerId: 'p1', demandId: id, acceptedQuoteId: 'q-'+id, source: 'mock' as const, status: 'completed' as const, ...patch }, demand: demand(id, { status: 'completed', ...d }) });

test('仅使用本人、已完成且所选来源一致的历史，过滤异地与已成交需求', () => {
  const r = recommendDemands(provider, [demand('new'), demand('other', { city:'上海' }), demand('done', {status:'completed'})], [history('h'), history('foreign',{providerId:'p2'}), history('live',{source:'live'}), history('pending',{status:'contracted'})], 'mock');
  assert.equal(r.historyCount, 1);
  assert.deepEqual(r.items.map(x=>x.demand.id), ['new']);
  assert.equal(r.items[0].similarOrderCount, 1);
  assert.equal(r.mode,'history');
});
test('历史偏好改变会改变排名，不把报价或其他来源当作成交偏好', () => {
  const repair = { renovationType:'repair' as const, areaM2:10, budgetMinCents:500000, budgetMaxCents:1000000, desiredDays:5, description:'漏水维修' };
  const candidates = [demand('elderly'),demand('repair',repair)];
  assert.equal(recommendDemands(provider,candidates,[history('h')],'mock').items[0].demand.id,'elderly');
  assert.equal(recommendDemands(provider,candidates,[history('h',{},repair)],'mock').items[0].demand.id,'repair');
  const cold = recommendDemands(provider,candidates,[history('h')],'live');
  assert.equal(cold.historyCount,0); assert.equal(cold.mode,'cold_start');
  assert.ok(cold.items.every(x=>x.similarOrderCount===0));
});
test('聚类分开明显不同空间，顺序变化不改变结果，新增需求参与新快照', () => {
  const ds = [demand('a'),demand('b',{areaM2:61}),demand('c',{areaM2:12,renovationType:'repair',desiredDays:5,budgetMinCents:500000,budgetMaxCents:800000}),demand('d',{areaM2:13,renovationType:'repair',desiredDays:6,budgetMinCents:500000,budgetMaxCents:900000})];
  const r = recommendDemands(provider,ds,[],'live');
  assert.deepEqual(r,recommendDemands(provider,[...ds].reverse(),[],'live'));
  assert.notEqual(r.items.find(x=>x.demand.id==='a')?.clusterId,r.items.find(x=>x.demand.id==='c')?.clusterId);
  assert.equal(r.clusters.reduce((n,c)=>n+c.publishedCount,0),4);
  assert.equal(recommendDemands(provider,[...ds,demand('new')],[],'live').items.length,5);
});
test('重复特征与空数据不产生 NaN、空簇或虚假历史', () => {
  const r = recommendDemands(provider,[demand('a'),demand('b')],[],'live');
  assert.equal(r.clusters.length,1);
  assert.ok(r.items.every(x=>Number.isFinite(x.score)&&x.score>=0&&x.score<=100));
  assert.deepEqual(recommendDemands(provider,[],[],'live').items,[]);
});
