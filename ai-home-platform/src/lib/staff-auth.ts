import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
export type StaffRole = 'provider' | 'admin';
export const staffCookie = (role: StaffRole) => `__Host-ai_home_${role}_session`;
export function staffHash(request: Request, role: StaffRole) {
 const name=staffCookie(role);const values=(request.headers.get('cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 const token=values.length===1?values[0].slice(name.length+1):'';
 return /^[a-f0-9]{64}$/.test(token)?createHash('sha256').update(token).digest('hex'):null;
}
export async function readStaffSession(request:Request,tx:Pick<Prisma.TransactionClient,'ownerSession'>,role:StaffRole,now=new Date()){
 const hash=staffHash(request,role);if(!hash)return null;
 const row=await tx.ownerSession.findUnique({where:{tokenHash:hash},include:{user:{include:{provider:true}}}});
 if(!row||row.revokedAt||row.expiresAt<=now||row.user.role!==role)return null;
 if(role==='provider'&&(!row.user.providerId||row.user.provider?.id!==row.user.providerId))return null;
 return {identity:{userId:row.userId,role,providerId:row.user.providerId},expiresAt:row.expiresAt.toISOString()};
}
export async function issueStaffSession(request:Request,tx:Prisma.TransactionClient,userId:string,role:StaffRole,now:Date){
 const user=await tx.user.findUnique({where:{id:userId},include:{provider:true}});
 if(!user||user.role!==role||(role==='provider'&&(!user.providerId||!user.provider)))throw new Error('Invalid account');
 const previous=staffHash(request,role);if(previous)await tx.ownerSession.updateMany({where:{tokenHash:previous,revokedAt:null},data:{revokedAt:now}});
 const token=randomBytes(32).toString('hex');const expiresAt=new Date(now.getTime()+30*24*60*60*1000);
 await tx.ownerSession.create({data:{tokenHash:createHash('sha256').update(token).digest('hex'),userId,createdAt:now,expiresAt}});
 return {data:{status:'signed_in',identity:{userId,role,providerId:user.providerId},expiresAt:expiresAt.toISOString()},cookie:`${staffCookie(role)}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`};
}
