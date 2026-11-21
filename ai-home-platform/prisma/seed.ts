import { PrismaClient } from "@prisma/client";
import { DEMO_PROVIDER_ID, DEMO_PROVIDER_USER_ID } from "../src/contracts";
import { demoDemand, demoCompletedDemands, demoCompletedQuotes, demoCompletedOrders, demoCompletedReviews,
 providers, quotes, schedule, payments, tickets } from "../src/lib/mock-data";
const db=new PrismaClient();
async function main() {
 await db.user.upsert({where:{id:"demo-owner"},update:{},create:{id:"demo-owner",name:"演示业主",role:"owner"}});
 await db.demandOrder.upsert({where:{id:demoDemand.id},update:{},create:{...demoDemand,ownerId:"demo-owner"}});
 for(const demand of demoCompletedDemands) await db.demandOrder.upsert({where:{id:demand.id},update:{},create:{...demand,ownerId:"demo-owner"}});
 for(const provider of providers) {
  const {tags,availability: _availability,...rest}=provider;
  await db.serviceProvider.upsert({where:{id:provider.id},update:{},create:{...rest,tagsJson:JSON.stringify(tags)}});
 }
 await db.user.upsert({where:{id:DEMO_PROVIDER_USER_ID},update:{},create:{id:DEMO_PROVIDER_USER_ID,name:"演示服务方账号",role:"provider",providerId:DEMO_PROVIDER_ID}});
 for(const quote of quotes) {
  const {items,pendingItems,...rest}=quote;
  await db.quote.upsert({where:{id:quote.id},update:{},create:{...rest,itemsJson:JSON.stringify(items),pendingItemsJson:JSON.stringify(pendingItems)}});
 }
 for(const quote of demoCompletedQuotes) {
  const {items,pendingItems,...rest}=quote;
  await db.quote.upsert({where:{id:quote.id},update:{},create:{...rest,itemsJson:JSON.stringify(items),pendingItemsJson:JSON.stringify(pendingItems)}});
 }
 for(const order of demoCompletedOrders) await db.serviceOrder.upsert({where:{id:order.id},update:{},create:order});
 for(const review of demoCompletedReviews) await db.review.upsert({where:{id:review.id},update:{},create:review});
 await db.schedule.upsert({where:{demandId_version:{demandId:schedule.demandId,version:schedule.version}},update:{},create:{demandId:schedule.demandId,version:schedule.version,tasksJson:JSON.stringify(schedule.tasks)}});
 for(const row of payments) await db.payment.upsert({where:{id:row.id},update:{},create:row});
 for(const row of tickets) await db.ticket.upsert({where:{id:row.id},update:{},create:row});
 console.log("演示数据已准备好；重复运行不会覆盖现有记录。");
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.$disconnect());
