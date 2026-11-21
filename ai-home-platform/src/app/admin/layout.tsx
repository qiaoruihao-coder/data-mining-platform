import {headers} from 'next/headers';
import Link from 'next/link';

export const dynamic='force-dynamic';
export default async function AdminLayout({children}:{children:React.ReactNode}){
 const incoming=headers();
 const response=await fetch((process.env.INTERNAL_APP_URL??'http://127.0.0.1:3100')+'/api/auth/admin',{headers:{cookie:incoming.get('cookie')??''},cache:'no-store'});
 const body=await response.json();const session=response.ok&&body.ok&&body.data.status==='signed_in';
 if(!session)return <section className="rounded border border-line bg-white p-6"><h1>请登录平台运营账号</h1><p>点击右上角登录入口，选择“平台运营账号登录”。角色导航不会授予管理权限。</p><Link href="/">返回首页</Link></section>;
 return <>{children}</>;
}
