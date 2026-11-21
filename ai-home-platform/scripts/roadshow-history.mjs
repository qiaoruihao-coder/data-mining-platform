import fs from 'node:fs';
const base = 'http://127.0.0.1:3100';
const file = 'docs/experiments/roadshow-history.json';
const entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
const save = () => fs.writeFileSync(file, JSON.stringify(entries, null, 2));
async function request(path, body, cookie = '', key) {
  const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie, ...(key ? { 'Idempotency-Key': key } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const b = await r.json();
  if (!r.ok || !b.ok) throw new Error(path + ' ' + r.status + ' ' + b.error?.code);
  return { data: b.data, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const owner = await request('/api/auth/owner', { login: 'roadshow.owner', password: process.env.OWNER_PASS });
const provider = await request('/api/auth/provider', { login: 'roadshow.provider', password: process.env.PROVIDER_PASS });
try {
  const specs = [
    [58,3,5,'elderly',28,'老人浴室防滑、扶手与夜间照明'],
    [65,4,6,'elderly',32,'两居适老化，拓宽轮椅通道'],
    [72,5,8,'elderly',35,'老人卧室照明及卫生间无门槛'],
    [50,3,4.5,'elderly',25,'老旧住宅适老改造，防滑扶手'],
    [85,6,9,'elderly',40,'三口之家适老化，收纳与通道'],
    [60,3.5,5.5,'elderly',30,'浴室安全扶手与厨房低位收纳'],
    [90,10,15,'partial',45,'原木风两居局改，餐厅收纳'],
    [110,15,22,'partial',55,'三居客厅与书房更新'],
    [12,.8,1.5,'repair',7,'厨房漏水修复与防水检修'],
    [18,1,2,'repair',10,'卫生间渗漏与墙面修补'],
  ];
  const existing = (await request('/api/demand', undefined, owner.cookie)).data;
  for (let i = 0; i < specs.length; i++) {
    const [areaM2, min, max, renovationType, desiredDays, text] = specs[i];
    const marker = `【路演历史-${String(i + 1).padStart(2, '0')}】`;
    const entry = entries[i] ?? {};
    if (!entry.demandId) {
      const d = existing.find(d => d.description.startsWith(marker)) ?? (await request('/api/demand', {
        description: marker + text + '。合成历史演示，非真实客户、施工或付款记录。', city: '深圳', areaM2,
        budgetMinCents: Math.round(min * 1000000), budgetMaxCents: Math.round(max * 1000000), renovationType, desiredDays,
      }, owner.cookie)).data;
      entry.demandId = d.id; entries[i] = entry; save();
    }
    if (!entry.quoteId) {
      const q = (await request('/api/quote', { demandId: entry.demandId, estimatedDays: desiredDays, items: [
        { code: 'demo-history', name: '历史演示施工与材料', unit: 'job', quantity: 1, unitPriceCents: Math.round((min + max) / 2 * 1000000), note: '合成成交历史，用于推荐演示，非真实交易。' },
      ] }, provider.cookie, `roadshow-history-20261118-${i}`)).data;
      entry.quoteId = q.id; save();
    }
    let order = (await request('/api/order', { demandId: entry.demandId, quoteId: entry.quoteId, confirmed: true }, owner.cookie)).data;
    entry.orderId = order.id; save();
    for (const action of ['start', 'complete']) {
      if (order.status === 'completed' || (action === 'start' && order.status === 'in_progress')) continue;
      order = (await request('/api/order/progress', { demandId: entry.demandId, orderId: order.id, action, confirmed: true, scheduleVersion: null }, owner.cookie)).data.order;
    }
    entry.status = order.status; entry.source = order.source; entry.description = text;
    save();
  }
  console.log(JSON.stringify({ completed: entries.filter(e => e.status === 'completed').length, mock: entries.every(e => e.source === 'mock') }));
} finally {
  for (const [role, session] of [['owner', owner], ['provider', provider]]) await fetch(base + '/api/auth/' + role, { method: 'DELETE', headers: { Origin: base, Cookie: session.cookie } });
}
