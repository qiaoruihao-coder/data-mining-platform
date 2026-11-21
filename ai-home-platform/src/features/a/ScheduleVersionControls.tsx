"use client";

import { useState } from "react";
import { Button, C, Field } from "./ui";
import { parseScheduleVersion } from "./schedule-query";

export function ScheduleVersionControls({ version, onSelect }: {
  version?: number;
  onSelect: (version?: number) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <details className="group mb-5 rounded-control border border-line bg-white" open={version !== undefined ? true : undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[14px] font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="text-[11px] text-ink-3 transition-transform group-open:rotate-90">▶</span>
        {version === undefined ? "查看历史排期版本" : `正在查看排期版本 v${version}`}
      </summary>
      <div className="border-t border-line px-4 py-3">
      <p className={C.meta}>已知排期版本号时，可查看对应计划；版本是否存在以查询结果为准。</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
        event.preventDefault();
        const parsed = parseScheduleVersion(input);
        if (parsed === null) {
          setError("请输入有效的正整数版本号。");
          return;
        }
        setError(null);
        onSelect(parsed);
      }} noValidate>
        <Field label="排期版本号">
          <input className={C.input} value={input} inputMode="numeric" placeholder="例如 1"
            aria-invalid={error ? true : undefined} aria-describedby={error ? "schedule-version-error" : undefined}
            onChange={event => { setInput(event.target.value); setError(null); }} />
        </Field>
        <Button type="submit" variant="secondary">查看指定版本</Button>
        {version !== undefined ? <Button variant="ghost" onClick={() => {
          setInput("");
          setError(null);
          onSelect(undefined);
        }}>返回最新排期</Button> : null}
      </form>
      {error ? <p id="schedule-version-error" role="alert" className="mt-2 text-[14px] text-danger">{error}</p> : null}
      <p className={`!mb-0 mt-3 ${C.meta}`} role="status">
        {version === undefined ? "查询模式：最新排期。" : `查询模式：指定版本 v${version}；该版本不代表最新排期或当前现场进度。`}
      </p>
      </div>
    </details>
  );
}
