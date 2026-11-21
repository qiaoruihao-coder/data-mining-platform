"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import type { ProviderDTO } from "@/contracts";
import { StatusBadge } from "@/components/StatusBadge";
import { Button, C, Empty, Explainer, PageHeader } from "@/components/ui";
import { ProviderAvailability } from "./ProviderAvailability";
import { adminProviderDetailFailureState, loadAdminProviderDetail, providerKindLabels, type AdminProviderDetailState } from "./admin-provider-detail";

const linkClass = "text-[15px] font-medium hover:underline";

export function AdminProviderDetailContent({ providerId, state, onReload }: {
  providerId: ProviderDTO["id"];
  state: AdminProviderDetailState;
  onReload: () => void;
}) {
  const result = state.status === "ready" ? state.result : null;
  const provider = result?.provider;
  const tags = provider?.tags.filter(tag => tag.trim().length > 0) ?? [];

  return (
    <section aria-labelledby="admin-provider-title" className="space-y-6">
      <nav aria-label="管理端返回导航">
        <Link href="/admin/tickets" className={linkClass}>返回售后工单</Link>
      </nav>
      <PageHeader
        id="admin-provider-title"
        title="服务方资料"
        subtitle={<span className="break-all">服务方编号：{providerId}</span>}
        aside={
          <Button onClick={onReload} variant="secondary" disabled={state.status === "loading"}>
            {state.status === "loading" ? "正在加载…" : state.status === "error" ? "重新加载" : "刷新资料"}
          </Button>
        }
      />
      <Explainer summary="资料说明">
        <p>公开资料仅供参考，资质与工单责任需另行核实。</p>
        <p>查看资料不会改变工单。</p>
      </Explainer>

      {state.status === "loading" && <div className={C.card} role="status" aria-live="polite">正在读取服务方资料，请稍候…</div>}
      {state.status === "error" && (
        <div className={`${C.card} border-danger/30`} role="alert">
          <h2 className={C.sectionTitle}>暂时无法加载服务方资料</h2>
          <p className="!mb-0">{state.message}</p>
        </div>
      )}
      {result && (
        <>
          <div role="status" aria-live="polite">
            <StatusBadge label={result.source === "mock" ? "资料查询来源：模拟标识（mock）" : "资料查询来源：已保存记录"} />
            <p className={`${C.meta} mt-2 !mb-0`}>
              {result.source === "mock"
                ? "本次服务方目录查询含模拟资料；基础资料与档期分别标明来源，模拟内容仅供演示。"
                : "本次服务方列表由实时接口返回，来源标识不代表已认证或已核实资料。"}
            </p>
          </div>
          {provider ? (
            <article aria-labelledby="admin-provider-name" className={`${C.card} min-w-0`}>
              <h2 id="admin-provider-name" className={`${C.sectionTitle} whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>
                {provider.name.trim() ? provider.name : "名称未填写"}
              </h2>
              <div className="mt-3">
                <StatusBadge label={provider.source === "mock" ? "基础资料来源：模拟标识（mock）" : provider.source === "live" ? "基础资料来源：已保存记录" : "基础资料来源未知"} />
                <p className={`${C.meta} mt-2 !mb-0`}>{provider.source === "mock"
                  ? "基础资料仅供演示，不代表真实机构或认证结果。"
                  : provider.source === "live" ? "基础资料由实时接口返回，不代表已认证或已核实资料。" : "接口未提供基础资料来源，不能由目录查询来源推断。"}</p>
              </div>
              <dl className="mt-4 grid gap-6 sm:grid-cols-2">
                <div className="min-w-0"><dt className={C.meta}>所在城市</dt><dd className="m-0 mt-1 break-words [overflow-wrap:anywhere]">{provider.city.trim() ? provider.city : "城市未填写"}</dd></div>
                <div><dt className={C.meta}>服务类型</dt><dd className="m-0 mt-1">{providerKindLabels[provider.kind]}</dd></div>
                <div className="min-w-0 sm:col-span-2">
                  <dt className={C.meta}>资料标签</dt>
                  <dd className="mt-2">
                    {tags.length > 0 ? <ul aria-label="服务方资料标签" className="flex flex-wrap gap-2">
                      {tags.map((tag, index) => <li key={index} className={`${C.badge} ${C.badgeNeutral} min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}>{tag}</li>)}
                    </ul> : "暂未提供标签"}
                  </dd>
                </div>
              </dl>
              <ProviderAvailability availability={provider.availability} />
            </article>
          ) : (
            <div role="status" aria-live="polite">
              <Empty title="未找到服务方" hint="未查到资料，请核对编号或刷新。" />
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AdminProviderDetailLoader({ providerId }: { providerId: ProviderDTO["id"] }) {
  const [state, setState] = useState<AdminProviderDetailState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    loadAdminProviderDetail(providerId).then(
      result => { if (active) setState({ status: "ready", result }); },
      (error: unknown) => { if (active) setState(adminProviderDetailFailureState(error)); },
    );
    return () => { active = false; };
  }, [providerId, reloadKey]);

  function reload() {
    setState({ status: "loading" });
    setReloadKey(previous => previous + 1);
  }
  return <AdminProviderDetailContent providerId={providerId} state={state} onReload={reload} />;
}

export function AdminProviderDetail({ providerId }: { providerId: ProviderDTO["id"] }) {
  // Reset immediately when navigating between IDs; ignore results after unmount.
  return <AdminProviderDetailLoader key={providerId} providerId={providerId} />;
}
