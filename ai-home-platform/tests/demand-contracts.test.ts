import test from "node:test";
import assert from "node:assert/strict";
import * as contracts from "../src/contracts";
const input = { description: " repair ", city: " 深圳 ", areaM2: 20, budgetMinCents: 0, budgetMaxCents: 10000, renovationType: "repair", desiredDays: 2 };
test("需求写入规范化文本并拒绝空白和无限面积", () => {
  assert.equal(contracts.DemandInput.parse(input).city, "深圳");
  for (const invalid of [{description:" "}, {city:" "}, {areaM2:Infinity}])
    assert.equal(contracts.DemandInput.safeParse({...input,...invalid}).success, false);
});
test("更新完整校验预算且禁止客户端设置状态和 ID", () => {
  assert.ok("DemandUpdateInput" in contracts, "缺少更新契约");
  const schema = contracts.DemandUpdateInput;
  assert.equal(schema.safeParse(input).success, true);
  for (const invalid of [{budgetMinCents:10001}, {budgetMaxCents:-1}, {budgetMaxCents:1.5}, {budgetMaxCents:Number.MAX_SAFE_INTEGER+1}, {status:"published"}, {id:"custom"}, {city:undefined}])
    assert.equal(schema.safeParse({...input,...invalid}).success, false);
});
test("详情路径和删除结果契约可校验", () => {
  assert.ok("DemandIdParams" in contracts, "缺少详情路径契约");
  assert.ok("DemandDeleteResult" in contracts, "缺少删除结果契约");
  assert.equal(contracts.DemandIdParams.safeParse({id:"demand-1"}).success,true);
  for (const id of ["", " "]) assert.equal(contracts.DemandIdParams.safeParse({id}).success,false);
  assert.equal(contracts.DemandIdParams.safeParse({id:"d",status:"draft"}).success,false);
  assert.equal(contracts.DemandDeleteResult.safeParse({id:"d",deleted:true}).success,true);
  for (const data of [{id:"d",deleted:false},{id:"d"},{id:"",deleted:true}])
    assert.equal(contracts.DemandDeleteResult.safeParse(data).success,false);
});
test("详情响应必须声明来源且 501 不能解析为成功", () => {
  const schema = contracts.envelope(contracts.Demand);
  const data = {...input,id:"demand-1",status:"draft"};
  assert.equal(schema.safeParse({ok:true,data,meta:{source:"live"}}).success,true);
  assert.equal(schema.safeParse({ok:true,data}).success,false);
  assert.equal(schema.safeParse({ok:false,error:{code:"NOT_IMPLEMENTED",message:"未实现"}}).success,false);
});
