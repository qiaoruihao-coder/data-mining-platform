import {createIsolatedDemoHandlers} from '@/lib/isolated-demo-login';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const {GET,POST}=createIsolatedDemoHandlers();
