"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";
import { ONELAP_BATCH_MAX_BYTES, ONELAP_BATCH_MAX_FILES, ONELAP_BATCH_MAX_MB, onelapBatchKind, type OnelapBatchResult } from "../../src/imports/onelap-batch";
import { platformInfo, type ImportPlatformId } from "../../src/ux/platform-catalog";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

type UploadState = "idle" | "uploading" | "error";
type UploadResult = { id: string; duplicate: boolean } | { batch: OnelapBatchResult };

export function RideFileUpload({ onImported, onBatchImported, platform }: {
  onImported?: (id: string, duplicate: boolean) => void;
  onBatchImported?: (result: OnelapBatchResult) => void;
  platform?: ImportPlatformId;
} = {}) {
  const onelap = platform === "onelap";
  const [result, setResult] = useState<UploadResult | null>(null);
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [selection, setSelection] = useState<File[]>([]);
  const [error, setError] = useState<string>();

  function selectFile(): void {
    setResult(null);
    setError(undefined);
    setSelection([]);
    const files = Array.from(fileInput.current?.files ?? []);
    const file = files[0];
    if (!file) return;
    if (onelap && onelapBatchKind(files)) {
      if (files.length > ONELAP_BATCH_MAX_FILES) {
        setError(`每批最多导入 ${ONELAP_BATCH_MAX_FILES} 个 FIT 文件。`);
      } else if (files.reduce((total, item) => total + item.size, 0) > ONELAP_BATCH_MAX_BYTES) {
        setError(`单批文件总大小最多 ${ONELAP_BATCH_MAX_MB} MB，请分批导入。`);
      } else setSelection(files);
      return;
    }
    if (files.length !== 1 || !/\.(fit|gpx)$/i.test(file.name)) {
      setError(onelap ? "请选择一个 ZIP、一个或多个 FIT，或单个 GPX 文件。" : "当前只支持 .fit 和 .gpx 文件。");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("文件超过 50 MB 限制。");
      return;
    }
    setSelection(files);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const file = selection[0];
    if (state === "uploading") return;
    if (!file) {
      if (!error) setError(onelap ? "请选择要导入的文件。" : "请选择一个 FIT 或 GPX 文件。");
      return;
    }

    setResult(null);
    setState("uploading");
    setError(undefined);
    try {
      const data = new FormData();
      if (onelap && onelapBatchKind(selection)) {
        for (const item of selection) data.append("files", item);
        const response = await fetch("/api/rides/import/onelap-batch", { method: "POST", body: data });
        const payload = await response.json() as OnelapBatchResult & { message?: string };
        if (!response.ok) throw new Error(payload.message ?? "无法完成本次导入，请重试。");
        setState("idle");
        setResult({ batch: payload });
        router.refresh();
        onBatchImported?.(payload);
        return;
      }
      data.set("file", file);
      if (platform) data.set("platform", platform);
      const response = await fetch("/api/rides/import", { method: "POST", body: data });
      const payload = await response.json() as { rideId?: string; message?: string; duplicate?: boolean };
      if (!response.ok || !payload.rideId) throw new Error(payload.message ?? "文件暂时无法读取，请重试。");
      setState("idle");
      setResult({ id: payload.rideId, duplicate: !!payload.duplicate });
      router.refresh();
      onImported?.(payload.rideId, !!payload.duplicate);
    } catch (uploadError) {
      setState("error");
      setError(uploadError instanceof Error ? uploadError.message : "文件暂时无法读取，请重试。");
    }
  }

  return (
    <section className="upload-card" aria-label={onelap ? "导入顽鹿文件" : "导入 FIT 或 GPX 文件"}>
      <div className="upload-icon" aria-hidden="true"><span>+</span></div>
      <div><h2>{platform ? `导入${platformInfo(platform).name}文件` : "导入 FIT / GPX"}</h2>
        <p>{onelap ? "可上传 OTM 导出的 ZIP，也可多选 FIT 文件或上传一个 GPX。" : platform ? "选择从运动平台导出的 FIT 或 GPX 骑行文件。" : "上传后仅保留用于展示和解读的标准化骑行数据。"}</p></div>
      <form className="upload-form" onSubmit={submit}>
        <label className="file-picker">
          <span>{onelap ? "选择 ZIP、FIT 或 GPX" : "选择 FIT 或 GPX 文件"}</span>
          <input ref={fileInput} type="file" name="file" multiple={onelap}
            accept={onelap ? ".zip,.fit,.gpx,application/zip,application/octet-stream,application/gpx+xml" : ".fit,.gpx,application/octet-stream,application/gpx+xml"}
            disabled={state === "uploading"} onChange={selectFile} />
        </label>
        <p className="upload-file-name" aria-live="polite">{selection.length > 1 ? `已选 ${selection.length} 个文件` : selection[0]?.name ?? (onelap ? `单批 ${ONELAP_BATCH_MAX_MB} MB` : "最大 50 MB")}</p>
        {error && <p className="upload-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={state === "uploading"}>{state === "uploading" ? "正在解析骑行数据…" : state === "error" ? "重试导入" : "导入文件"}</button>
      </form>
      {result && ("batch" in result ? <div className="upload-batch-result">
        <p role="status">新增 {result.batch.added} 条 · 跳过重复 {result.batch.duplicate} 条 · 失败 {result.batch.failed} 条</p>
        {result.batch.failures.length > 0 && <details>
          <summary>查看失败文件</summary>
          <ul>{result.batch.failures.map((failure, index) => <li key={index}>
            <strong>{failure.fileName}</strong> {failure.message}
          </li>)}</ul>
        </details>}
        {!onBatchImported && result.batch.added + result.batch.duplicate > 0 && <div className="ux-actions"><Link href="/import">查看骑行记录</Link></div>}
      </div> : <><p role="status">{result.duplicate ? "该文件已导入，已找到原记录，没有重复创建。" : "已真实导入 1 条骑行记录。"}</p>{!onImported && <div className="ux-actions"><Link href="/import">查看骑行记录</Link></div>}</>)}
      <p className="upload-privacy-note">原始文件不发送给 AI；仅保存脱敏后的标准化数据，重启服务后仍可恢复。</p>
    </section>
  );
}
