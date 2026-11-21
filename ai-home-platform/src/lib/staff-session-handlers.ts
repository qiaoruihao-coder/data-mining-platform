import {createHash} from 'node:crypto';
import {prisma} from '@/lib/prisma';
import {OwnerLoginInput} from '@/contracts';
import {verifyOwnerPassword} from '@/lib/owner-password';
import {isSameOrigin} from '@/lib/demo-provider-session';
import {readStaffSession,issueStaffSession,staffHash,staffCookie,type StaffRole} from '@/lib/staff-auth';
const headers={'Cache-Control':'private, no-store',Vary:'Cookie'};
const fail=(status:number,message:string)=>Response.json({ok:false,error:{code:status===401?'INVALID_CREDENTIALS':status===429?'RATE_LIMITED':'AUTH_ERROR',message}},{status,headers});
const ok=(data:unknown)=>Response.json({ok:true,data,meta:{source:'live'}},{headers});
export function createStaffSessionHandlers(role:StaffRole){return {
 async GET(req:Request){try{const s=await readStaffSession(req,prisma,role);return ok(s?{status:'signed_in',...s}:{status:'signed_out'});}catch{return fail(503,'登录服务暂不可用');}},
 async POST(req:Request){
  const url=new URL(req.url);if(!isSameOrigin(req)||(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname)))return fail(403,'请在本站安全连接登录');
  let input;
  try{if(!req.body)return fail(400,'缺少登录信息');const reader=req.body.getReader();let body='';let size=0;const decoder=new TextDecoder();try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();return fail(400,'请求过大');}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();}finally{reader.releaseLock();}input=OwnerLoginInput.parse(JSON.parse(body));}catch{return fail(400,'账号或密码格式错误');}
  const key='staff:'+role+':'+createHash('sha256').update(input.login).digest('hex');const now=new Date();
  try{
   const prior=await prisma.ownerLoginAttempt.findUnique({where:{key}});if(prior&&prior.resetsAt>now&&prior.count>=5)return fail(429,'尝试过于频繁，请15分钟后重试');
   const credential=await prisma.ownerCredential.findUnique({where:{login:input.login},include:{user:true}});
   const verified=await verifyOwnerPassword(input.password,credential?.passwordHash??null);
   if(!verified||!credential||credential.user.role!==role){await prisma.$transaction(async tx=>{await tx.ownerLoginAttempt.deleteMany({where:{key,resetsAt:{lte:now}}});await tx.ownerLoginAttempt.upsert({where:{key},create:{key,count:1,resetsAt:new Date(now.getTime()+900000)},update:{count:{increment:1}}});});return fail(401,'账号或密码不正确');}
   const issued=await prisma.$transaction(async tx=>{
    const attempt=await tx.ownerLoginAttempt.findUnique({where:{key}});if(attempt&&attempt.resetsAt>now&&attempt.count>=5)throw new Error('locked');
    const current=await tx.ownerCredential.findUnique({where:{login:input.login},include:{user:true}});
    if(!current||current.passwordHash!==credential.passwordHash||current.userId!==credential.userId||current.user.role!==role)throw new Error('changed');
    const result=await issueStaffSession(req,tx,current.userId,role,now);await tx.ownerLoginAttempt.deleteMany({where:{key}});return result;
   },{isolationLevel:'Serializable'});
   const response=ok(issued.data);response.headers.set('Set-Cookie',issued.cookie);return response;
  }catch{return fail(503,'暂时无法确认登录，请重试');}
 },
 async DELETE(req:Request){if(!isSameOrigin(req))return fail(403,'请求来源不符');try{const hash=staffHash(req,role);if(hash)await prisma.ownerSession.updateMany({where:{tokenHash:hash,revokedAt:null},data:{revokedAt:new Date()}});const response=ok({status:'signed_out'});response.headers.set('Set-Cookie',`${staffCookie(role)}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);return response;}catch{return fail(503,'退出失败，请重试');}}
};}
