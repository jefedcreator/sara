import { getChildId } from "@/utils/getChildId";
import { HttpException } from "./exceptions";

import { cn } from "./cn";

/**
 *
 * @param error
 * @returns
 */
function parseHttpError(error: any) {
  if (error instanceof HttpException || error.statusCode) {
    return error.message;
  }
  return error?.response?.message ?? error?.cause ?? error?.toString();
}

/**
 * Logs one request/response line. Called by `withMiddleware` after every
 * response — never call it manually from a handler.
 */
function logRequest(
  method: string,
  url: string,
  statusCode: number,
  duration: number,
  payload?: any,
) {
  let statusColor = "\x1b[32m"; // green  2xx
  if (statusCode >= 300) statusColor = "\x1b[36m"; // cyan   3xx
  if (statusCode >= 400) statusColor = "\x1b[33m"; // yellow 4xx
  if (statusCode >= 500) statusColor = "\x1b[31m"; // red    5xx
  const resetColor = "\x1b[0m";

  const message = `${method} ${url} ${statusColor}${statusCode}${resetColor} - ${duration}ms`;

  if (statusCode >= 500) {
    console.error(message);
  } else {
    console.log(message);
  }

  if (payload && Object.keys(payload).length > 0) {
    const sanitized = JSON.parse(JSON.stringify(payload));
    ["password", "token", "creditCard"].forEach((key) => {
      if (sanitized[key]) sanitized[key] = "*****";
    });
    console.debug(`Payload: ${JSON.stringify(sanitized)}`);
  }
}

/** Format total minutes → "1h 23m" or "45m" */
function formatDuration(minutes: number | null): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export {
  cn,
  formatDuration,
  getChildId,
  HttpException,
  logRequest,
  parseHttpError,
};
