import type { loadQuoteComparison } from "@/features/b/load-quotes";

/** 仅描述本次可展示的结果，不把读取完成说成提交成功或报价新增。 */
export function quoteReadFeedback(data: Awaited<ReturnType<typeof loadQuoteComparison>>): string {
  const count = data.response.data.length;
  const warning = data.providerWarning ? " 服务方资料未读取成功，名称待确认。" : "";
  return (count > 0
    ? `本次读取完成，展示 ${count} 份已提交或已接受的报价；来源逐份标注，模拟报价不代表真实市场报价。`
    : "本次读取完成，暂无可对比的已提交或已接受报价。") + warning;
}
