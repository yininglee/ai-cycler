export const ONELAP_BATCH_MAX_FILES = 200;
export const ONELAP_BATCH_MAX_MB = 100;
export const ONELAP_BATCH_MAX_BYTES = ONELAP_BATCH_MAX_MB * 1024 * 1024;

export type OnelapBatchResult = {
  added: number;
  duplicate: number;
  failed: number;
  rideIds: string[];
  failures: { fileName: string; message: string }[];
};

export function onelapBatchKind(files: readonly { name: string }[]): "fit" | "zip" | null {
  if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) return "zip";
  return files.length > 0 && files.every(file => /\.fit$/i.test(file.name)) ? "fit" : null;
}
