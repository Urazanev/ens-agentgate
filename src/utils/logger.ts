type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function current(): Level {
  const v = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return order[v] ? v : "info";
}

function log(level: Level, msg: string, meta?: Record<string, unknown>): void {
  if (order[level] < order[current()]) return;
  const line = { ts: new Date().toISOString(), level, msg, ...meta };
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(JSON.stringify(line));
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) => log("debug", m, meta),
  info: (m: string, meta?: Record<string, unknown>) => log("info", m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => log("warn", m, meta),
  error: (m: string, meta?: Record<string, unknown>) => log("error", m, meta),
};
