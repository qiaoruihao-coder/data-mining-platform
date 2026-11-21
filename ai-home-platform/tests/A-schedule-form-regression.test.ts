import test from 'node:test';
import assert from 'node:assert/strict';
import {nextTaskId,parseScheduleCreateRows} from '../src/features/a/schedule-editor';
const row={id:'task-2',name:'新工序',startDay:'0',durationDays:'1',dependsOn:'task-1'};
test('screenshot missing dependency is explained; clearing dependency allows save',()=>{const r=parseScheduleCreateRows('demand-test',[row]);assert.equal(r.ok,false);if(!r.ok)assert.match(r.error,/task-1 不存在/);assert.equal(parseScheduleCreateRows('demand-test',[{...row,dependsOn:''}]).ok,true);});
test('delete then add cannot duplicate task-2',()=>{assert.equal(nextTaskId([row]),'task-3');});
test('Chinese comma accepted and dependency timing explained',()=>{const a={...row,id:'task-1',dependsOn:''};const b={...row,id:'task-2',dependsOn:'',startDay:'0'};const c={...row,id:'task-3',dependsOn:'task-1，task-2',startDay:'1'};assert.equal(parseScheduleCreateRows('demand-test',[a,b,c]).ok,true);const r=parseScheduleCreateRows('demand-test',[a,{...c,startDay:'0',dependsOn:'task-1'}]);assert.equal(r.ok,false);if(!r.ok)assert.match(r.error,/至少为 1/);});
