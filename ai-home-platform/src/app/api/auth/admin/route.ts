import {createStaffSessionHandlers} from '@/lib/staff-session-handlers';
export const dynamic='force-dynamic';
export const {GET,POST,DELETE}=createStaffSessionHandlers('admin');
