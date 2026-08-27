"use client";

import { useRef, useState } from "react";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

type UploadState = "idle" | "uploading" | "error";

export function RideFileUpload() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>("idle");
  const [selectedFileName, setSelectedFileName] = useState<string>();
  const [error, setError] = useState<string>();

  function selectFile(): void {
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
    if (!file || state === "uploading") {
      setError("请选择一个 FIT 或 GPX 文件。");
      return;
    }

    setState("uploading");
    setError(undefined);
    try {
      const data = new FormData();
      data.set("file", file);
      const response = await fetch("/api/rides/import", { method: "POST", body: data });
      const payload = await response.json() as { rideId?: string; message?: string };
      if (!response.ok || !payload.rideId) throw new Error(payload.message ?? "文件暂时无法读取，请重试。");
      window.location.assign(`/rides/${payload.rideId}`);
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
          <input ref={fileInput} type="file" name="file" accept=".fit,.gpx,application/octet-stream,application/gpx+xml" onChange={selectFile} />
        </label>
        <p className="upload-file-name" aria-live="polite">{selectedFileName ?? "最大 50 MB"}</p>
        {error && <p className="upload-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={state === "uploading"}>{state === "uploading" ? "正在解析骑行数据" : "导入并查看骑行"}</button>
      </form>
      <p className="upload-privacy-note">原始文件不发送给 AI；解析成功后不在本机保存，重启服务后导入记录会清除。</p>
    </section>
  );
}
