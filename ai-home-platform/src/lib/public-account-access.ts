import type { PrismaClient } from '@prisma/client';
import { prisma } from './prisma';
import { isSameOrigin } from './demo-provider-session';
import { issueOwnerSession, readOwnerSessionState, revokeOwnerSession } from './owner-auth';
import { issueStaffSession, readStaffSession } from './staff-auth';

type Role = 'owner' | 'provider' | 'admin';
type Config = { enabled: boolean; accounts: Record<Role, string> };
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
export function createPublicAccountAccess(db: PrismaClient = prisma, config: Config = {
  enabled: process.env.PUBLIC_ACCOUNT_ACCESS === 'true' && process.env.ISOLATED_DEMO !== 'true',
  accounts: { owner: process.env.PUBLIC_OWNER_ID ?? '', provider: process.env.PUBLIC_PROVIDER_ID ?? '', admin: process.env.PUBLIC_ADMIN_ID ?? '' },
}) {
  return async function POST(request: Request) {
    const fail = (status: number, message: string) => Response.json({ ok: false, error: { code: 'PUBLIC_ACCESS_UNAVAILABLE', message } }, { status, headers });
    if (!config.enabled) return fail(404, '原账号自动登录未开启');
    const url = new URL(request.url);
    if (!isSameOrigin(request) || (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return fail(403, '请从本站安全入口访问');
    let role: Role;
    try {
      const text = await request.text();
      if (text.length > 128) return fail(400, '请求过大');
      const input = JSON.parse(text);
      if (!input || Object.keys(input).length !== 1 || !['owner', 'provider', 'admin'].includes(input.role)) return fail(400, '请选择有效角色');
      role = input.role;
    } catch { return fail(400, '请选择有效角色'); }
    const userId = config.accounts[role];
    if (!userId) return fail(503, '原账号尚未配置');
    try {
      const result = await db.$transaction(async tx => {
        const account = await tx.user.findUnique({ where: { id: userId } });
        if (!account || account.role !== role) throw new Error('Account unavailable');
        const state = role === 'owner' ? await readOwnerSessionState(request, tx) : await readStaffSession(request, tx, role);
        const identity = state && 'identity' in state ? state.identity : null;
        if (identity?.userId === userId) return { changed: false, cookie: null };
        if (role === 'owner') await revokeOwnerSession(request, tx);
        const issued = role === 'owner'
          ? await issueOwnerSession({ userId, role, providerId: null }, tx)
          : await issueStaffSession(request, tx, userId, role, new Date());
        return { changed: true, cookie: issued.cookie };
      });
      const response = Response.json({ ok: true, data: { role, userId, changed: result.changed }, meta: { source: 'live' } }, { headers });
      for (const other of ['owner', 'provider', 'admin']) if (other !== role) response.headers.append('Set-Cookie', `__Host-ai_home_${other}_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
      response.headers.append('Set-Cookie', 'ai_home_demo_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
      if (result.cookie) response.headers.append('Set-Cookie', result.cookie);
      return response;
    } catch { return fail(503, '无法登录原账号，请检查原数据库和账号配置'); }
  };
}
