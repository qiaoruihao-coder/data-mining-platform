/** 每次离开后返回只刷新一次，合并浏览器相邻的 focus/visibilitychange 事件。 */
export function subscribeQuotePageRefresh(
  refresh: () => void,
  viewport: EventTarget,
  page: EventTarget & Pick<Document, "visibilityState" | "hasFocus">,
) {
  let active = page.visibilityState === "visible" && page.hasFocus();
  const leave = () => { active = false; };
  const resume = () => {
    if (active || page.visibilityState !== "visible") return;
    active = true;
    refresh();
  };
  const visibilityChanged = () => {
    if (page.visibilityState === "hidden") leave();
    else resume();
  };
  const pageShown = (event: Event) => {
    // 普通首次加载由页面 effect 读取；仅处理浏览器前进/后退缓存恢复。
    if ((event as PageTransitionEvent).persisted) resume();
  };

  viewport.addEventListener("blur", leave);
  viewport.addEventListener("focus", resume);
  viewport.addEventListener("pagehide", leave);
  viewport.addEventListener("pageshow", pageShown);
  page.addEventListener("visibilitychange", visibilityChanged);
  return () => {
    viewport.removeEventListener("blur", leave);
    viewport.removeEventListener("focus", resume);
    viewport.removeEventListener("pagehide", leave);
    viewport.removeEventListener("pageshow", pageShown);
    page.removeEventListener("visibilitychange", visibilityChanged);
  };
}
