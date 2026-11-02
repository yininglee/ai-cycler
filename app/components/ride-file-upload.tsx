"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

type UploadState = "idle" | "uploading" | "error";

export function RideFileUpload({ onImported }: { onImported?: (id: string, duplicate: boolean) => void } = {}) {
  const [result, setResult] = useState<{ id: string; duplicate: boolean } | null>(null);
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [selectedFileName, setSelectedFileName] = useState<string>();
  const [error, setError] = useState<string>();

  function selectFile(): void {
    setResult(null);
    setError(undefined);
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setSelectedFileName(undefined);
      return;
    }
    if (!/\.(fit|gpx)$/i.test(file.name)) {
      setSelectedFileName(undefined);
      setError("当前只支持 .fit 和 .gpx 文件。");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setSelectedFileName(undefined);
      setError("文件超过 50 MB 限制。");
      return;
    }
    setSelectedFileName(file.name);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const file = fileInput.current?.files?.[0];
    if (state === "uploading") return;
    if (!file || !selectedFileName) {
      setError("请选择一个 FIT 或 GPX 文件。");
      return;
    }

    setResult(null);
    setState("uploading");
    setError(undefined);
    try {
      const data = new FormData();
      data.set("file", file);
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
    <section className="upload-card" aria-label="导入 FIT 或 GPX 文件">
      <div className="upload-icon" aria-hidden="true"><span>+</span></div>
      <div><h2>导入 FIT / GPX</h2><p>上传后仅保留用于展示和解读的标准化骑行数据。</p></div>
      <form className="upload-form" onSubmit={submit}>
        <label className="file-picker">
          <span>选择 FIT 或 GPX 文件</span>
          <input ref={fileInput} type="file" name="file" accept=".fit,.gpx,application/octet-stream,application/gpx+xml" disabled={state === "uploading"} onChange={selectFile} />
        </label>
        <p className="upload-file-name" aria-live="polite">{selectedFileName ?? "最大 50 MB"}</p>
        {error && <p className="upload-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={state === "uploading"}>{state === "uploading" ? "正在解析骑行数据…" : state === "error" ? "重试导入" : "导入文件"}</button>
      </form>
      {result && <><p role="status">{result.duplicate ? "该文件已导入，已找到原记录，没有重复创建。" : "已真实导入 1 条骑行记录。"}</p>{!onImported && <div className="ux-actions"><Link href="/import">查看骑行记录</Link></div>}</>}
      <p className="upload-privacy-note">原始文件不发送给 AI；仅保存脱敏后的标准化数据，重启服务后仍可恢复。</p>
    </section>
  );
}
