import { NextResponse } from "next/server";
import type { SourceDTO } from "@/contracts";
export function mockResponse<T>(data:T) { return NextResponse.json({ok:true,data,meta:{source:"mock" as const}}); }
export function dataResponse<T>(data:T, source: SourceDTO, status = 200) {
 return NextResponse.json({ok:true,data,meta:{source}},{status});
}
export function liveResponse<T>(data:T, status = 200) {
 return dataResponse(data, "live", status);
}
export function notImplemented() { return NextResponse.json({ok:false,error:{code:"NOT_IMPLEMENTED",message:"这是开工骨架，此操作尚未实现。"}},{status:501}); }
