import { ChatInput, ChatResult } from "@/contracts";
import { dataResponse } from "@/lib/api-response";
import { clarifyDemand, LlmUnavailableError } from "@/lib/llm";
export async function POST(request:Request) {
 let json:unknown;
 try { json=await request.json(); } catch { return Response.json({ok:false,error:{code:"INVALID_JSON",message:"请求不是有效 JSON"}},{status:400}); }
 const input=ChatInput.safeParse(json);
 if(!input.success) return Response.json({ok:false,error:{code:"VALIDATION_ERROR",message:"对话格式不符合契约"}},{status:400});
 try {
   const result = await clarifyDemand(input.data);
   return dataResponse(ChatResult.parse(result.data), result.source);
 } catch (error) {
   const message = error instanceof LlmUnavailableError ? error.message : "AI 服务未配置或不可用";
   return Response.json({ok:false,error:{code:"AI_UNAVAILABLE",message}},{status:503});
 }
}
