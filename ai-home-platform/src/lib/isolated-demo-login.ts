import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {PrismaClient,Prisma} from '@prisma/client';
import {prisma} from './prisma';
import {isSameOrigin} from './demo-provider-session';
import {issueOwnerSession} from './owner-auth';
import {issueStaffSession} from './staff-auth';

const input=z.object({role:z.enum(['owner','provider','admin'])}).strict();
const ids={owner:'demo-owner',provider:'demo-provider-account',admin:'isolated-demo-admin'};
const cookies=['__Host-ai_home_owner_session','__Host-ai_home_provider_session','__Host-ai_home_admin_session'];
const headers={'Cache-Control':'private, no-store',Vary:'Cookie'};
type Config={enabled:boolean;databaseUrl:string};
export function createIsolatedDemoHandlers(db:PrismaClient=prisma,config:Config={enabled:process.env.ISOLATED_DEMO==='true',databaseUrl:process.env.DATABASE_URL??''}){
 const configured=()=>config.enabled&&/[/\\]isolated-role-demo\.db$/.test(config.databaseUrl);
 async function isolated(tx:Pick<Prisma.TransactionClient,'user'|'ownerCredential'>){
  if(!configured())return false;
  const marker=await tx.user.findUnique({where:{id:'isolated-demo-marker'}});
  return marker?.role==='system'&&marker.name==='isolated-role-demo-v1'&&await tx.ownerCredential.count()===0;
 }
 const fail=(status:number,message:string)=>Response.json({ok:false,error:{code:'DEMO_UNAVAILABLE',message}},{status,headers});
 return {
  async GET(){try{return Response.json({ok:true,data:{enabled:await isolated(db)},meta:{source:'mock'}},{headers});}catch{return fail(503,'演示状态暂不可用');}},
  async POST(request:Request){
   if(!configured())return fail(404,'此入口未启用');
   if(new URL(request.url).protocol!=='https:'||!isSameOrigin(request))return fail(403,'请使用本站HTTPS演示入口');
   let value:z.infer<typeof input>;
   try{
    const reader=request.body?.getReader();if(!reader)return fail(400,'请选择演示角色');
    let size=0;const chunks:Uint8Array[]=[];
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>256){await reader.cancel();return fail(400,'请求过大');}chunks.push(part.value);}}finally{reader.releaseLock();}
    value=input.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
   }catch{return fail(400,'请选择有效的演示角色');}
   try{
    const issued=await db.$transaction(async tx=>{
     if(!await isolated(tx))return null;
     const account=await tx.user.findUnique({where:{id:ids[value.role]}});
     if(account?.role!==value.role||(value.role==='provider'&&account.providerId!=='provider-a'))return null;
     const hashes=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).flatMap(s=>{const i=s.indexOf('=');const k=s.slice(0,i),v=s.slice(i+1);return cookies.includes(k)&&/^[a-f0-9]{64}$/.test(v)?[createHash('sha256').update(v).digest('hex')]:[];});
     await tx.ownerSession.updateMany({where:{tokenHash:{in:hashes},revokedAt:null},data:{revokedAt:new Date()}});
     return value.role==='owner'?issueOwnerSession({userId:ids.owner,role:'owner',providerId:null},tx):issueStaffSession(request,tx,ids[value.role],value.role,new Date());
    });
    if(!issued)return fail(404,'仅支持独立演示数据库');
    const response=Response.json({ok:true,data:{role:value.role,demo:true},meta:{source:'mock'}},{headers});
    for(const name of cookies)if(name!=='__Host-ai_home_'+value.role+'_session')response.headers.append('Set-Cookie',`${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    response.headers.append('Set-Cookie','ai_home_demo_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    response.headers.append('Set-Cookie',issued.cookie);return response;
   }catch{return fail(503,'演示登录暂不可用，请重试');}
  }
 };
}
