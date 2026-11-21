import test from "node:test";
import assert from "node:assert/strict";
import { DemandInput, Demand, Money, Quote, envelope } from "../src/contracts";
import { demoDemand, quotes } from "../src/lib/mock-data";
test("金额拒绝小数、负数及不安全整数",()=>{for(const v of [-1,1.1,Number.MAX_SAFE_INTEGER+1])assert.equal(Money.safeParse(v).success,false);});
test("需求拒绝倒置预算和未知字段",()=>{
 const {id,status,...input}=demoDemand; void id; void status;
 assert.equal(DemandInput.safeParse(input).success,true);
 assert.equal(DemandInput.safeParse({...input,budgetMinCents:6000000}).success,false);
 assert.equal(DemandInput.safeParse({...input,price:1}).success,false);
});
test("模拟响应必须有来源标识",()=>{
 assert.equal(envelope(Demand).safeParse({ok:true,data:demoDemand}).success,false);
 assert.equal(envelope(Demand).safeParse({ok:true,data:demoDemand,meta:{source:"mock"}}).success,true);
});
test("报价保留未知费用而非转成零",()=>{const parsed=Quote.parse(quotes[0]);assert.equal(parsed.items[1].amountCents,null);assert.ok(parsed.pendingItems.includes("垃圾清运"));});
