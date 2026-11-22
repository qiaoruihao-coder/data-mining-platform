import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {PrismaClient} from '@prisma/client';
async function main(){
 const url=process.env.DATABASE_URL??'';
 if(!/^file:.*[/\\]isolated-role-demo\.db$/.test(url))throw new Error('Use a dedicated absolute isolated-role-demo.db path');
 const db=new PrismaClient();
 try{
  if(existsSync(url.slice(5))){
   const marker=await db.user.findUnique({where:{id:'isolated-demo-marker'}});
   if(marker?.name!=='isolated-role-demo-v1'||marker.role!=='system'||await db.ownerCredential.count()!==0)throw new Error('Refusing an unmarked or credential-bearing database');
  }
  execFileSync(process.execPath,[resolve('node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{stdio:'inherit'});
  execFileSync(process.execPath,[resolve('node_modules/tsx/dist/cli.mjs'),'prisma/seed.ts'],{stdio:'inherit'});
  await db.user.upsert({where:{id:'isolated-demo-marker'},update:{},create:{id:'isolated-demo-marker',name:'isolated-role-demo-v1',role:'system'}});
  await db.user.upsert({where:{id:'isolated-demo-admin'},update:{},create:{id:'isolated-demo-admin',name:'演示平台运营',role:'admin'}});
  console.log('Isolated role demo prepared; original database untouched.');
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
