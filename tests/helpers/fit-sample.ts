import { FitBaseType, FitEncoder } from "fit-file-parser";

const START = new Date("2026-08-17T06:00:00.000Z");

export interface FitSampleOptions {
  /** Dense synthetic ride for end-to-end interpretation, preserving default parser fixtures. */
  recordCount?: number;
  sportValue?: number;
  sessionCount?: number;
  allZeroPower?: boolean;
  allZeroHeartRate?: boolean;
  allZeroCadence?: boolean;
  includeCadenceZero?: boolean;
  includeGpsPlaceholder?: boolean;
  /** 全部记录写入真实坐标（矩阵 FIT-1：码表完整记录）。 */
  realGps?: boolean;
}

export function buildCyclingFitSample(options: FitSampleOptions = {}): Uint8Array {
  const encoder = new FitEncoder({ profileVersion: 2130 });
  const startTimestamp = FitEncoder.toFitTimestamp(START);
  const sportValue = options.sportValue ?? 2;
  const sessionCount = options.sessionCount ?? 1;
  const allZeroPower = options.allZeroPower ?? false;
  const allZeroHeartRate = options.allZeroHeartRate ?? false;
  const allZeroCadence = options.allZeroCadence ?? false;
  const includeCadenceZero = options.includeCadenceZero ?? false;
  const includeGpsPlaceholder = options.includeGpsPlaceholder ?? false;

  encoder.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 1, size: 2, baseType: FitBaseType.Uint16, value: 1 },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: 1000 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: startTimestamp },
  ], 0);

  const count = options.recordCount ?? 5;
  const distances = Array.from({ length: count }, (_, index) => Math.round(index * 3500 / (count - 1)));
  for (let index = 0; index < distances.length; index += 1) {
    const phase = index * 4 / (count - 1);
    encoder.writeMessage(20, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: startTimestamp + Math.round(index * 1200 / (count - 1)) },
      ...(options.realGps ? [
        { number: 0, size: 4, baseType: FitBaseType.Sint32, value: Math.round((23.16 + index * 0.001) * 2 ** 31 / 180) },
        { number: 1, size: 4, baseType: FitBaseType.Sint32, value: Math.round((113.33 + index * 0.002) * 2 ** 31 / 180) },
      ] : includeGpsPlaceholder ? [
        { number: 0, size: 4, baseType: FitBaseType.Sint32, value: index === 0 ? 0 : Math.round(23.16 * 2 ** 31 / 180) },
        { number: 1, size: 4, baseType: FitBaseType.Sint32, value: index === 0 ? 0 : Math.round(113.33 * 2 ** 31 / 180) },
      ] : []),
      { number: 3, size: 1, baseType: FitBaseType.Uint8, value: allZeroHeartRate ? 0 : Math.round(140 + phase * 2) },
      { number: 4, size: 1, baseType: FitBaseType.Uint8, value: allZeroCadence || (includeCadenceZero && index === 0) ? 0 : Math.round(80 + phase) },
      { number: 5, size: 4, baseType: FitBaseType.Uint32, value: distances[index]! * 100 },
      { number: 6, size: 2, baseType: FitBaseType.Uint16, value: index === 0 ? 0 : 2_917 },
      { number: 7, size: 2, baseType: FitBaseType.Uint16, value: allZeroPower ? 0 : Math.round(200 + phase * 5) },
    ], 1);
  }

  for (let index = 0; index < sessionCount; index += 1) {
    encoder.writeMessage(18, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: startTimestamp + 1_200 + index * 1_300 },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: startTimestamp + index * 1_300 },
      { number: 5, size: 1, baseType: FitBaseType.Enum, value: sportValue },
      { number: 6, size: 1, baseType: FitBaseType.Enum, value: 0 },
      { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 1_200_000 },
      { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 1_200_000 },
      { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 350_000 },
      { number: 11, size: 2, baseType: FitBaseType.Uint16, value: 320 },
      { number: 14, size: 2, baseType: FitBaseType.Uint16, value: 2_917 },
      { number: 15, size: 2, baseType: FitBaseType.Uint16, value: 5_000 },
      { number: 16, size: 1, baseType: FitBaseType.Uint8, value: allZeroHeartRate ? 0 : 145 },
      { number: 17, size: 1, baseType: FitBaseType.Uint8, value: allZeroHeartRate ? 0 : 175 },
      { number: 18, size: 1, baseType: FitBaseType.Uint8, value: allZeroCadence ? 0 : 82 },
      { number: 19, size: 1, baseType: FitBaseType.Uint8, value: allZeroCadence ? 0 : 120 },
      { number: 20, size: 2, baseType: FitBaseType.Uint16, value: allZeroPower ? 0 : 210 },
      { number: 21, size: 2, baseType: FitBaseType.Uint16, value: allZeroPower ? 0 : 225 },
      { number: 22, size: 2, baseType: FitBaseType.Uint16, value: 120 },
      { number: 34, size: 2, baseType: FitBaseType.Uint16, value: allZeroPower ? 0 : 225 },
    ], 2);
  }

  return encoder.close();
}
