import {spawn} from 'node:child_process';
import path from 'node:path';
import {prisma} from '@/lib/prisma';
import {readStaffSession} from '@/lib/staff-auth';
import {isSameOrigin} from '@/lib/demo-provider-session';
export const dynamic='force-dynamic';
const globalJob=globalThis as typeof globalThis & {caseRefresh?:{status:string;message:string;started:number}};
export async function GET(){return Response.json({ok:true,data:globalJob.caseRefresh??{status:'idle',message:'',started:0}},{headers:{'Cache-Control':'no-store'}});}
export async function POST(req:Request){
 if(!isSameOrigin(req))return Response.json({ok:false,error:{message:'请求来源不符'}},{status:403});
 if(!await readStaffSession(req,prisma,'admin'))return Response.json({ok:false,error:{message:'请先登录平台运营账号'}},{status:401});
 const old=globalJob.caseRefresh;if(old&&(old.status==='running'||Date.now()-old.started<60000))return Response.json({ok:false,error:{message:'更新正在进行或刚刚完成，请稍后再试'}},{status:409});
 globalJob.caseRefresh={status:'running',message:'采集设计本并重新聚类…',started:Date.now()};
 const env:NodeJS.ProcessEnv={...process.env,PYTHONIOENCODING:'utf-8',OMP_NUM_THREADS:'4',OPENBLAS_NUM_THREADS:'4',MKL_NUM_THREADS:'4'};delete env.PYTHONPATH;
 const child=spawn(path.join(process.cwd(),'.venv-mining/Scripts/python.exe'),['experiments/mining/domestic.py','--refresh'],{cwd:process.cwd(),env,windowsHide:true,stdio:'ignore'});
 const timer=setTimeout(()=>{child.kill();},180000);
 child.on('error',()=>{clearTimeout(timer);globalJob.caseRefresh={...globalJob.caseRefresh!,status:'error',message:'采集程序启动失败，原数据保留'};});
 child.on('close',code=>{clearTimeout(timer);globalJob.caseRefresh={...globalJob.caseRefresh!,status:code===0?'done':'error',message:code===0?'已更新':'更新失败，原数据保留'};});
 return Response.json({ok:true,data:globalJob.caseRefresh},{status:202});
}
