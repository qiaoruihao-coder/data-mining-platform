import type { PrismaClient } from '@prisma/client';
import { ProviderRecommendationQuery, ProviderRecommendations, envelope } from '@/contracts';
import { prisma } from '@/lib/prisma';
import { readDemoVerifiedSession } from '@/lib/demo-provider-session';
import { toDemandDTO } from '@/lib/demand';
import { orderSummaryFromRecord } from '@/lib/order';
import { recommendDemands } from '@/lib/provider-recommendations';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const fail = (status: number, code: string, message: string) => Response.json({ok:false,error:{code,message}},{status,headers});
export async function handleProviderRecommendations(request: Request, db: Pick<PrismaClient,'$transaction'> = prisma) {
  const params = new URL(request.url).searchParams;
  const query = ProviderRecommendationQuery.safeParse(Object.fromEntries(params));
  if (request.method !== 'GET' || !query.success || [...params.keys()].length !== new Set(params.keys()).size) return fail(400,'VALIDATION_ERROR','推荐查询参数无效。');
  try {
    return await db.$transaction(async tx => {
      const identity = await readDemoVerifiedSession(request,tx);
      if (!identity || identity.role !== 'provider' || !identity.providerId) return fail(401,'UNAUTHENTICATED','请先登录服务方，再刷新推荐。');
      const provider = await tx.serviceProvider.findUnique({where:{id:identity.providerId}});
      if (!provider) return fail(401,'UNAUTHENTICATED','服务方资料不存在。');
      const tags: unknown = JSON.parse(provider.tagsJson);
      if (!Array.isArray(tags) || tags.some(t=>typeof t!=='string')) throw new Error('Invalid tags');
      const orders = await tx.serviceOrder.findMany({where:{providerId:identity.providerId,status:'completed',source:query.data.historySource},include:{demand:true,acceptedQuote:true}});
      const history = orders.map(row=>({order:orderSummaryFromRecord(row),demand:toDemandDTO(row.demand)}));
      // Public published records only; never pull another provider's private order history into training.
      const rows = await tx.demandOrder.findMany({where:{status:'published',serviceOrder:{is:null}},orderBy:{id:'asc'}});
      const data = recommendDemands({id:provider.id,city:provider.city,tags},rows.map(toDemandDTO),history,query.data.historySource,query.data);
      const source = query.data.historySource==='mock' || rows.some(r=>r.description.includes('演示')) ? 'mock' : 'live';
      return Response.json(envelope(ProviderRecommendations).parse({ok:true,data,meta:{source}}),{headers});
    },{isolationLevel:'Serializable'});
  } catch { return fail(503,'RECOMMENDATIONS_UNAVAILABLE','暂时无法读取推荐，请刷新重试；不会用示例结果替代失败。'); }
}
