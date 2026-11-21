"use client";

import { useState, type ChangeEvent } from "react";
import { ApiClientError } from "@/lib/api-client";
import { Button, C, Card, Note, SectionHead } from "./ui";
import {
  formatInspectionResult,
  inspectionSourceLabel,
  PHOTO_INSPECTION_HINTS,
  photoInspectionSelectionError,
  photoInspectionStatus,
  submitPhotoInspection,
  uploadInspectionImages,
  type PhotoInspectionPhase,
  type PhotoInspectionResponse,
  type InspectionUploadResponse,
} from "./photo-inspection";

/**
 * 施工照片上传与辅助检查入口。
 * 图片先由 D 的真实存储接口保存，再以短期引用请求检查；501 仍只表示分析未接通。
 */
export function PhotoInspectionPanel({ demandId }: { demandId: string }) {
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<PhotoInspectionPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PhotoInspectionResponse | null>(null);
  const [uploaded, setUploaded] = useState<InspectionUploadResponse | null>(null);

  const onSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const names = selected.map((file) => file.name);
    const selectionError = photoInspectionSelectionError(names);
    setFiles(selected);
    setPhase(selectionError ? "invalid" : names.length > 0 ? "selected" : "idle");
    setError(selectionError);
    setResult(null);
    setUploaded(null);
  };

  const submit = async () => {
    if (files.length === 0 || phase === "invalid" || phase === "submitting") return;
    setPhase("submitting");
    setError(null);
    setResult(null);
    setUploaded(null);
    try {
      const upload = await uploadInspectionImages(demandId, files);
      setUploaded(upload);
      const response = await submitPhotoInspection(demandId, upload.data.images.map(image => image.imageRef));
      setResult(response);
      setPhase("ready");
    } catch (cause) {
      setPhase(cause instanceof ApiClientError && cause.status === 501 ? "unavailable" : "failed");
      setError(cause instanceof Error ? cause.message : "照片检查请求失败，请重试。");
    }
  };

  return (
    <Card className="mt-4">
      <SectionHead title="照片辅助检查" />
      <p className={`mb-3 ${C.meta}`}>
        选择施工现场照片后可提交辅助检查。照片只能提示疑点，不能替代现场检测或证明施工合格。
      </p>

      <label className="grid gap-1.5 text-[14px] font-medium text-ink" htmlFor="photo-inspection-files">
        现场照片
        <input
          id="photo-inspection-files"
          type="file"
          accept="image/png,image/jpeg"
          multiple
          onChange={onSelect}
          className="block w-full rounded-input border border-line bg-white px-3 py-2.5 text-[14px] file:mr-3 file:rounded-tag file:border-0 file:bg-brand-soft file:px-2.5 file:py-1 file:text-[13px] file:font-medium file:text-brand-hover"
        />
      </label>

      <p className={`mt-2 ${C.meta}`} role="status">{photoInspectionStatus(phase, files.length)}</p>

      {files.length > 0 ? (
        <ul className="mt-2 grid gap-1 text-[14px] text-ink-2" aria-label="已选择的照片">
          {files.map((file, index) => <li key={`${file.name}-${index}`} className="truncate">{file.name}</li>)}
        </ul>
      ) : null}

      {uploaded ? (
        <Note tone="info" title={`照片已上传（来源：${inspectionSourceLabel(uploaded.source)}）`}>
          <p className="!mb-0">已取得 {uploaded.data.images.length} 个短期图片引用，辅助检查将只使用这些引用。</p>
        </Note>
      ) : null}

      <div className="mt-3 grid gap-2 sm:flex sm:items-center">
        <Button variant="secondary" onClick={submit} disabled={files.length === 0 || phase === "invalid"}>
          {phase === "submitting" ? "提交中…" : "提交辅助检查"}
        </Button>
        <span className={C.meta}>需求 {demandId}，当前不会自动确认验收</span>
      </div>

      <Note tone="info" title="人工复核提示">
        <ul className="grid gap-1">
          {PHOTO_INSPECTION_HINTS.map((hint) => <li key={hint}>{hint}。</li>)}
        </ul>
      </Note>

      {phase === "ready" && result ? (
        <div className="mt-3">
          <Note tone="ok" title={`辅助检查结果（来源：${inspectionSourceLabel(result.source)}）`}>
            <pre className="mb-2 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-control bg-canvas p-3 text-[14px] leading-relaxed text-ink">{formatInspectionResult(result.data)}</pre>
            <p className="!mb-0">以上内容只提示疑点，不能代替现场检测，也不等于验收合格。</p>
          </Note>
        </div>
      ) : null}

      {phase === "invalid" ? (
        <div className="mt-3">
          <Note tone="warn" title="照片选择需要调整">
            {error ?? photoInspectionStatus(phase, files.length)}
          </Note>
        </div>
      ) : null}

      {phase === "unavailable" ? (
        <div className="mt-3">
          <Note tone="warn">
            {error ?? "照片检查接口尚未开放（501）。"} 图片已上传但未生成检查结论；本页不会把照片或排期状态改成「已验收」，请由施工负责人现场确认。
          </Note>
        </div>
      ) : null}

      {phase === "failed" ? (
        <div className="mt-3">
          <Note tone="danger" title="照片辅助检查失败">
            <p>{error ?? "照片检查请求失败，请重试。"}</p>
            <Button variant="secondary" size="sm" onClick={() => void submit()}>重试</Button>
          </Note>
        </div>
      ) : null}
    </Card>
  );
}
