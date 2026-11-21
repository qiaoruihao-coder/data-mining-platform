import { Demand, Provider, Quote, Schedule, Payment, Ticket, OrderSummary, Review } from "@/contracts";
export const demoDemand = Demand.parse({
 id: "demo-demand", description: "60 平米老房适老化改造，重点解决浴室防滑和通行便利。", city: "深圳",
 areaM2: 60, budgetMinCents: 3000000, budgetMaxCents: 5000000, renovationType: "elderly", desiredDays: 30, status: "published",
});
export const providers = Provider.array().parse([
 { id:"provider-a", name:"安心施工工作室（模拟）", city:"深圳", kind:"construction", tags:["适老化","局部改造"], rating:4.8,
   availability:{coverageStartDate:"2026-11-15",coverageEndDate:"2026-12-31",windows:[{startDate:"2026-11-18",endDate:"2026-11-30"},{startDate:"2026-12-05",endDate:"2026-12-20"}],updatedAt:"2026-11-14T00:00:00.000Z",validUntil:"2026-12-31T23:59:59.000Z",source:"mock"} },
 { id:"provider-b", name:"宜家改造工作室（模拟）", city:"深圳", kind:"construction", tags:["适老化","维修"], rating:4.8,
   availability:{coverageStartDate:"2026-11-15",coverageEndDate:"2026-12-31",windows:[{startDate:"2026-11-20",endDate:"2026-12-20"}],updatedAt:"2026-11-14T00:00:00.000Z",validUntil:"2026-12-31T23:59:59.000Z",source:"mock"} },
 { id:"provider-c", name:"明材供应商（模拟）", city:"深圳", kind:"materials", tags:["地砖","防滑"], rating:4.7,
   availability:{coverageStartDate:"2026-11-15",coverageEndDate:"2026-12-31",windows:[{startDate:"2026-11-22",endDate:"2026-12-01"}],updatedAt:"2026-11-14T00:00:00.000Z",validUntil:"2026-12-31T23:59:59.000Z",source:"mock"} },
 { id:"provider-d", name:"简居设计工作室（模拟）", city:"深圳", kind:"design", tags:["适老化"], rating:4.5,
   availability:{coverageStartDate:"2026-11-15",coverageEndDate:"2026-12-31",windows:[],updatedAt:"2026-11-14T00:00:00.000Z",validUntil:"2026-12-31T23:59:59.000Z",source:"mock"} },
 { id:"provider-e", name:"放心监理（模拟）", city:"深圳", kind:"supervision", tags:["验收"], rating:4.9, availability:null },
 { id:"provider-f", name:"邻城施工队（模拟）", city:"广州", kind:"construction", tags:["局部改造"], rating:4.7,
   availability:{coverageStartDate:"2026-11-15",coverageEndDate:"2026-12-31",windows:[{startDate:"2026-12-01",endDate:"2026-12-31"}],updatedAt:"2026-11-14T00:00:00.000Z",validUntil:"2026-12-31T23:59:59.000Z",source:"mock"} },
]);
export const quotes = Quote.array().parse([
 { id:"quote-a", demandId:"demo-demand", providerId:"provider-a", estimatedDays:25, status:"submitted", source:"mock",
 items:[{code:"floor",name:"防滑地面",unit:"m2",quantity:10,unitPriceCents:20000,amountCents:200000,note:"合成演示，计价方式不同，范围需确认"},{code:"haul",name:"垃圾清运",unit:"job",quantity:1,unitPriceCents:null,amountCents:null,note:"待商家补充"},{code:"bathroom-rest",name:"其余浴室改造",unit:"job",quantity:1,unitPriceCents:1000000,amountCents:1000000,note:"合成演示，实际范围需现场确认"}],knownTotalCents:1200000,pendingItems:["垃圾清运"] },
 { id:"quote-b", demandId:"demo-demand", providerId:"provider-b", estimatedDays:28, status:"submitted", source:"mock",
 items:[{code:"floor",name:"防滑地面",unit:"job",quantity:1,unitPriceCents:250000,amountCents:250000,note:"合成演示，计价方式不同，范围需确认"},{code:"bathroom-rest",name:"其余浴室改造",unit:"job",quantity:1,unitPriceCents:950000,amountCents:950000,note:"合成演示，实际范围需现场确认"},{code:"haul",name:"垃圾清运",unit:"job",quantity:1,unitPriceCents:50000,amountCents:50000,note:"含清运，合成演示"},{code:"protection",name:"成品保护",unit:"job",quantity:1,unitPriceCents:50000,amountCents:50000,note:"合成演示，仅本报价单独列明；另一报价是否包含需核对"}],knownTotalCents:1300000,pendingItems:[] },
]);
export const demoCompletedDemands = Demand.array().parse([
 { id:"demo-completed-a", description:"合成已完成厨房局部改造，用于演示评价汇总。", city:"深圳", areaM2:45, budgetMinCents:2000000, budgetMaxCents:3500000, renovationType:"partial", desiredDays:20, status:"completed" },
 { id:"demo-completed-b", description:"合成已完成浴室防滑改造，用于演示评价汇总。", city:"深圳", areaM2:35, budgetMinCents:1500000, budgetMaxCents:2800000, renovationType:"elderly", desiredDays:18, status:"completed" },
 { id:"demo-completed-c", description:"合成已完成墙面修补，用于演示评价汇总。", city:"深圳", areaM2:28, budgetMinCents:800000, budgetMaxCents:1600000, renovationType:"repair", desiredDays:12, status:"completed" },
 { id:"demo-completed-d", description:"合成已完成墙面维修，用于演示评价汇总。", city:"深圳", areaM2:60, budgetMinCents:1000000, budgetMaxCents:1800000, renovationType:"repair", desiredDays:25, status:"completed" },
]);
export const demoCompletedQuotes = Quote.array().parse(demoCompletedDemands.map((demand, index) => ({
 id:`demo-completed-quote-${String.fromCharCode(97 + index)}`, demandId:demand.id,
 providerId:index < 3 ? "provider-a" : "provider-b", estimatedDays:demand.desiredDays, status:"accepted", source:"mock",
 items:[{code:"completed-work",name:"合成已完成施工",unit:"job",quantity:1,unitPriceCents:demand.budgetMinCents,
   amountCents:demand.budgetMinCents,note:"固定演示数据，不代表真实施工或报价"}],
 knownTotalCents:demand.budgetMinCents,pendingItems:[],
})));
export const demoCompletedOrders = OrderSummary.array().parse([
 { id:"demo-completed-order-a", demandId:"demo-completed-a", providerId:"provider-a", acceptedQuoteId:"demo-completed-quote-a", status:"completed", source:"mock" },
 { id:"demo-completed-order-b", demandId:"demo-completed-b", providerId:"provider-a", acceptedQuoteId:"demo-completed-quote-b", status:"completed", source:"mock" },
 { id:"demo-completed-order-c", demandId:"demo-completed-c", providerId:"provider-a", acceptedQuoteId:"demo-completed-quote-c", status:"completed", source:"mock" },
 { id:"demo-completed-order-d", demandId:"demo-completed-d", providerId:"provider-b", acceptedQuoteId:"demo-completed-quote-d", status:"completed", source:"mock" },
]);
export const demoCompletedReviews = Review.array().parse([
 { id:"demo-completed-review-a", demandId:"demo-completed-a", orderId:"demo-completed-order-a", providerId:"provider-a", rating:5, comment:"合成演示评价，不代表真实业主意见。", source:"mock" },
 { id:"demo-completed-review-b", demandId:"demo-completed-b", orderId:"demo-completed-order-b", providerId:"provider-a", rating:4, comment:"合成演示评价，不代表真实业主意见。", source:"mock" },
 { id:"demo-completed-review-c", demandId:"demo-completed-c", orderId:"demo-completed-order-c", providerId:"provider-a", rating:5, comment:"合成演示评价，不代表真实业主意见。", source:"mock" },
 { id:"demo-completed-review-d", demandId:"demo-completed-d", orderId:"demo-completed-order-d", providerId:"provider-b", rating:4, comment:"合成演示评价，不代表真实业主意见。", source:"mock" },
]);
export const schedule = Schedule.parse({demandId:"demo-demand",version:1,tasks:[
 {id:"inspect",name:"现场勘查",startDay:0,durationDays:1,dependsOn:[],responsibleProviderId:"provider-a",status:"done"},
 {id:"demolition",name:"拆除",startDay:1,durationDays:2,dependsOn:["inspect"],responsibleProviderId:"provider-a",status:"active"},
 {id:"repair",name:"基层处理",startDay:3,durationDays:3,dependsOn:["demolition"],responsibleProviderId:"provider-a",status:"pending"},
]});
export const payments = Payment.array().parse([{id:"payment-demo",demandId:"demo-demand",stage:"签约节点",amountCents:390000,status:"pending",simulated:true}]);
export const tickets = Ticket.array().parse([{id:"ticket-demo",demandId:"demo-demand",description:"拆除后发现墙面潮湿，需要现场复核并调整施工安排（模拟）。",category:"quality",responsibleProviderId:"provider-a",status:"assigned"}]);
