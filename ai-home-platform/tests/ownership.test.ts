import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerOf } from '../scripts/ownership.mjs';
test('业主目录内匹配和报价专属于 B，其他业主页面属于 A', () => {
 assert.equal(ownerOf('src/app/owner/matches/[id]/page.tsx'), 'B');
 assert.equal(ownerOf('src/app/owner/quotes/[id]/page.tsx'), 'B');
 assert.equal(ownerOf('src/app/owner/demand/chat/page.tsx'), 'A');
});
test('共享契约与配置归 D，业务 API 和私有组件按角色划分', () => {
 assert.equal(ownerOf('src/contracts/index.ts'), 'D');
 assert.equal(ownerOf('package-lock.json'), 'D');
 assert.equal(ownerOf('src/app/api/quote/route.ts'), 'B');
 assert.equal(ownerOf('src/app/api/demand/route.ts'), 'D');
 assert.equal(ownerOf('src/app/admin/tickets/page.tsx'), 'C');
 assert.equal(ownerOf('src/features/a/Composer.tsx'), 'A');
 assert.equal(ownerOf('docs/requests/C-ticket.md'), 'C');
});
