import { ProviderRecommendations, type DemandDTO, type OrderSummaryDTO, type SourceDTO } from '@/contracts';

type Profile = { id: string; city: string; tags: string[] };
type History = { order: OrderSummaryDTO; demand: DemandDTO };
const types = ['elderly', 'partial', 'repair'] as const;
const labels = { elderly: '适老改造', partial: '局部改造', repair: '维修' };
const topics = ['厨房', '卫生间', '收纳', '防滑', '扶手', '照明', '漏水', '书房'];
const cityKey = (s: string) => s.trim().replace(/市$/, '');
const dist = (a: number[], b: number[]) => a.reduce((n, v, i) => n + (v - b[i]) ** 2, 0);
const nearest = (v: number[], cs: number[][]) => cs.reduce((best, c, i) => dist(v, c) < dist(v, cs[best]) ? i : best, 0);
function features(d: DemandDTO) {
  return [Math.log1p(d.areaM2), Math.log1p((d.budgetMinCents + d.budgetMaxCents) / 2), Math.log1p(d.desiredDays),
    ...types.map(t => t === d.renovationType ? 2 : 0), ...topics.map(t => d.description.includes(t) ? .5 : 0)];
}

/** Deterministic farthest-first initialization, then Lloyd updates; no fabricated category labels. */
function cluster(vectors: number[][]) {
  if (!vectors.length) return { assignments: [] as number[], centers: [] as number[][] };
  let centers = [[...vectors[0]]];
  const k = Math.min(3, Math.max(1, Math.floor(Math.sqrt(vectors.length))));
  while (centers.length < k) {
    let farthest = 0, distance = 0;
    vectors.forEach((v, i) => { const d = dist(v, centers[nearest(v, centers)]); if (d > distance) { distance = d; farthest = i; } });
    if (distance < 1e-10) break;
    centers.push([...vectors[farthest]]);
  }
  for (let step = 0; step < 50; step++) {
    const groups = centers.map((_, i) => vectors.filter(v => nearest(v, centers) === i));
    const next = groups.filter(g => g.length).map(g => g[0].map((_, j) => g.reduce((n, v) => n + v[j], 0) / g.length));
    const converged = next.length === centers.length && next.every((c, i) => dist(c, centers[i]) < 1e-10);
    centers = next;
    if (converged) break;
  }
  return { centers, assignments: vectors.map(v => nearest(v, centers)) };
}

export function recommendDemands(profile: Profile, candidates: DemandDTO[], records: History[], source: SourceDTO, region: {scope?: "profile"|"selected"|"all";cities?:string} = {}) {
  const history = records.filter(({order, demand}) => order.providerId === profile.id && order.source === source
    && order.status === 'completed' && demand.status === 'completed' && order.demandId === demand.id);
  const uniqueHistory = [...new Map(history.map(h => [h.demand.id, h])).values()].sort((a,b)=>a.demand.id.localeCompare(b.demand.id));
  const pastIds = new Set(uniqueHistory.map(h=>h.demand.id));
  const published = [...new Map(candidates.filter(d => d.status === 'published' && d.id !== 'demo-demand' && !pastIds.has(d.id)).map(d=>[d.id,d])).values()].sort((a,b)=>a.id.localeCompare(b.id));
  const rows = [...published, ...uniqueHistory.map(h=>h.demand)];
  const vectors = rows.map(features);
  // Standardize numeric dimensions only; categorical and topic weights remain interpretable.
  for (let j = 0; j < 3; j++) {
    const mean = vectors.reduce((n,v)=>n+v[j],0) / (vectors.length || 1);
    const sd = Math.sqrt(vectors.reduce((n,v)=>n+(v[j]-mean)**2,0)/(vectors.length || 1)) || 1;
    vectors.forEach(v=>{v[j]=(v[j]-mean)/sd;});
  }
  const { assignments, centers } = cluster(vectors);
  const historyGroups = assignments.slice(published.length);
  const historyVectors = vectors.slice(published.length);
  const clusters = centers.map((_, id) => {
    const members = rows.filter((_,i)=>assignments[i]===id);
    const counts = types.map(t=>({t,n:members.filter(d=>d.renovationType===t).length})).sort((a,b)=>b.n-a.n);
    return { id, label: `${labels[counts[0].t]}为主`, minArea: Math.min(...members.map(d=>d.areaM2)), maxArea: Math.max(...members.map(d=>d.areaM2)),
      publishedCount: published.filter((_,i)=>assignments[i]===id).length, historyCount: historyGroups.filter(g=>g===id).length };
  });
  const items = published.flatMap((d,i) => {
    const allowed=region.scope==="selected" ? (region.cities??"").split(/[,，]/).map(cityKey) : [cityKey(profile.city)];
    if (region.scope!=="all" && !allowed.includes(cityKey(d.city))) return [];
    const clusterId = assignments[i];
    const similarOrderCount = historyGroups.filter(g=>g===clusterId).length;
    const typeLabel = labels[d.renovationType];
    const expertise = profile.tags.some(t => (d.description+' '+typeLabel).includes(t) || (t.includes('适老') && d.renovationType==='elderly')) ? 1 : 0;
    const similarities = historyVectors.map(v=>Math.exp(-dist(v,vectors[i])/6)).sort((a,b)=>b-a).slice(0,3);
    const similarity = similarities.reduce((n,v)=>n+v,0)/(similarities.length||1);
    const score = Math.round(100 * (uniqueHistory.length ? .75*similarity+.2*similarOrderCount/uniqueHistory.length+.05*expertise : .6+.4*expertise));
    return [{ demand: d, clusterId, score, similarOrderCount, reasons: [
      cityKey(d.city)===cityKey(profile.city) ? `本地需求：${d.city}` : `跨城需求：${d.city}，接单前确认服务范围`,
      ...(uniqueHistory.length ? [`与 ${similarOrderCount} 个已完成${source==='mock'?'模拟':''}订单属于同一需求群体`, '按面积、预算、工期、类型与施工关键词比较历史相似度'] : ['暂无所选来源的已完成订单，使用城市与专长冷启动']),
      ...(expertise ? ['需求内容与服务方专长相符'] : []),
    ] }];
  }).sort((a,b)=>b.score-a.score||a.demand.id.localeCompare(b.demand.id));
  return ProviderRecommendations.parse({ providerCity: profile.city, historySource: source, historyCount: uniqueHistory.length,
    mode: uniqueHistory.length ? 'history' : 'cold_start', algorithm: 'standardized-kmeans-history-v1', clusters, items });
}
