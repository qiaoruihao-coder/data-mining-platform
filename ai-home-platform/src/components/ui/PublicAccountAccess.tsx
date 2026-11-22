'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
export function PublicAccountAccess({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const role = path.startsWith('/admin') ? 'admin' : path.startsWith('/provider') ? 'provider' : 'owner';
  const [ready, setReady] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    fetch('/api/auth/public-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !body.ok) throw new Error(body.error?.message ?? '自动登录失败');
        if (!active) return;
        // Reload once after issuance so server components read the new cookie too.
        if (body.data.changed) { window.location.reload(); return; }
        setReady(role);
      }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '自动登录失败'); });
    return () => { active = false; };
  }, [role, retry]);
  return <><section className="mx-auto max-w-7xl px-6 py-3 text-sm" aria-label="原账号自动登录">
    <strong>原账号自动登录</strong><p>公开体验入口，使用原有需求和成交记录。持有链接的人可查看和修改这些记录。</p>
    {error && <p role="alert">{error} <button onClick={() => setRetry(value => value + 1)}>重试</button></p>}
  </section>{ready === role ? children : !error && <p className="p-6" role="status">正在登录原账号…</p>}</>;
}
