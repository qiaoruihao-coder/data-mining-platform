import {readFile} from 'node:fs/promises';
import path from 'node:path';
import initial from '@/contracts/domestic-recommendation.json';
export const dynamic='force-dynamic';
export async function GET(){
 let data=initial;
 try{data=JSON.parse(await readFile(path.join(process.cwd(),'experiments/source-audit/domestic-live.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')return Response.json({ok:false,error:{message:'案例数据读取失败'}},{status:503});}
 return Response.json({ok:true,data},{headers:{'Cache-Control':'no-store'}});
}
