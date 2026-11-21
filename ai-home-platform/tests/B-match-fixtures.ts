import type { SuiteContext, TestContext } from "node:test";
import { Demand, Provider } from "../src/contracts";
import { providers } from "../src/lib/mock-data";

// B 读取协议测试专用数据，不从 D 的运行样例复制候选或评分，不写共享文件/数据库。
export const MATCH_FIXTURE_NOW = Date.parse("2026-11-15T04:00:00Z");
export const matchDemandFixture = Demand.parse({
  id: "demo-demand", description: "B 合成需求，仅用于读取协议测试", city: "深圳", areaM2: 60,
  budgetMinCents: 3000000, budgetMaxCents: 5000000, renovationType: "elderly", desiredDays: 30, status: "published",
});
export const matchProviderFixtures = Provider.array().parse([
  { id: "fixture-a", name: "B 合成适老团队", city: "深圳", kind: "construction", tags: ["适老化", "局部改造"], rating: 4.8, source: "mock", availability: null },
  { id: "fixture-b", name: "B 合成维修团队", city: "深圳", kind: "construction", tags: ["适老化", "维修"], rating: 4.6, source: "mock", availability: null },
  { id: "fixture-remote", name: "B 合成异地团队", city: "广州", kind: "construction", tags: ["局部改造"], rating: 4.7, source: "mock", availability: null },
  { id: "fixture-design", name: "B 合成设计团队", city: "深圳", kind: "design", tags: ["适老化"], rating: 5, source: "mock", availability: null },
]);

/** 仅替换当前测试进程中的目录输入，每例结束恢复原对象；不改生产读取器。 */
export function installMatchProtocolFixture(t: TestContext | SuiteContext) {
  if (!("mock" in t)) throw new Error("匹配协议夹具只能用于逐测试 beforeEach。");
  const previous = providers.slice();
  providers.splice(0, providers.length, ...structuredClone(matchProviderFixtures));
  t.after(() => { providers.splice(0, providers.length, ...previous); });
  t.mock.method(Date, "now", () => MATCH_FIXTURE_NOW);
}
