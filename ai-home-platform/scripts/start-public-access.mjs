import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
if (!process.env.DATABASE_URL || !process.env.PUBLIC_OWNER_ID || !process.env.PUBLIC_PROVIDER_ID || !process.env.PUBLIC_ADMIN_ID) {
  throw new Error('Set DATABASE_URL to the existing database and PUBLIC_OWNER_ID / PUBLIC_PROVIDER_ID / PUBLIC_ADMIN_ID to existing account IDs. Do not run db:setup on the original database.');
}
const port=process.env.PORT??'3101';
const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',port],{
  stdio:'inherit',env:{...process.env,PUBLIC_ACCOUNT_ACCESS:'true',ISOLATED_DEMO:'false',INTERNAL_APP_URL:`http://127.0.0.1:${port}`},
});
child.on('exit',code=>process.exit(code??1));
