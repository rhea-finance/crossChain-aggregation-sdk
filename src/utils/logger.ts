/**
 * Simple logger utility with log level control
 * Can be controlled via environment variable LOG_LEVEL
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LOG_LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function getLogLevel(): LogLevel {
  if (typeof process !== "undefined" && process.env?.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL.toLowerCase() as LogLevel;
    if (LOG_LEVELS[level] !== undefined) {
      return level;
    }
  }
  // Default to 'warn' in production, 'debug' in development
  return typeof process !== "undefined" && process.env?.NODE_ENV === "production"
    ? "warn"
    : "debug";
}

const currentLogLevel = getLogLevel();
const currentLevelValue = LOG_LEVELS[currentLogLevel];

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= currentLevelValue;
}

export const logger = {
  debug: (...args: any[]) => {
    if (shouldLog("debug")) {
      console.debug(...args);
    }
  },
  info: (...args: any[]) => {
    if (shouldLog("info")) {
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    if (shouldLog("warn")) {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    if (shouldLog("error")) {
      console.error(...args);
    }
  },
};
