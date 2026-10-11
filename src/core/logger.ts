import type { SwapErrorCode, SwapErrorStage } from "./errors";

export type SdkLogLevel = "debug" | "warn";

export interface SdkLogEntry {
  level: SdkLogLevel;
  event: "api.request" | "api.response";
  path: string;
  stage: SwapErrorStage;
  status?: number;
  durationMs?: number;
  code?: SwapErrorCode;
}

export interface SdkLogger {
  log(entry: SdkLogEntry): void;
}
