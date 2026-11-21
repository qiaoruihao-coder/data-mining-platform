import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendDemands} from '../src/lib/provider-recommendations';
import {ProviderRecommendationQuery,type DemandDTO} from '../src/contracts';
const candidates=['深圳','上海','杭州市'].map((city,i)=>({id:'city-test-'+i,city,description:'厨房改造',areaM2:80,budgetMinCents:3000000,budgetMaxCents:5000000,renovationType:'partial',desiredDays:30,status:'published'} as DemandDTO));
const profile={id:'provider-a',city:'深圳',tags:['厨房']};
test('all cities includes cross-city candidates without changing account city',()=>{const r=recommendDemands(profile,candidates,[],'live',{scope:'all'});assert.equal(r.items.length,3);assert.equal(profile.city,'深圳');assert.ok(r.items.find(x=>x.demand.city==='上海')?.reasons.some(x=>x.includes('跨城')));});
test('multiple cities normalize suffix and preserve old default',()=>{const r=recommendDemands(profile,candidates,[],'live',{scope:'selected',cities:'上海，杭州'});assert.deepEqual(new Set(r.items.map(x=>x.demand.city)),new Set(['上海','杭州市']));assert.equal(recommendDemands(profile,candidates,[],'live').items.length,1);});
test('invalid city scopes fail validation',()=>{for(const q of [{scope:'selected'},{scope:'selected',cities:'上海,,杭州'},{scope:'all',cities:'上海'},{scope:'unknown'}])assert.equal(ProviderRecommendationQuery.safeParse(q).success,false);});
