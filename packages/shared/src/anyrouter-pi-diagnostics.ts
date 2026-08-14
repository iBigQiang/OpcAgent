import {
  appendFile,
  mkdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CONFIG_DIR } from './config/paths.ts';
import type { AnyRouterPiWireVariant } from './agent/backend/internal/anyrouter-pi-wire.ts';

export type AnyRouterPiDiagnosticEvent = 'request_start' | 'request_end' | 'request_error';

export interface AnyRouterPiDiagnosticInput {
  event: AnyRouterPiDiagnosticEvent;
  correlationId: string;
  sdkRetryHeader?: string | null;
  status?: number | null;
  durationMs: number;
  retryAfterHeader?: string | null;
  configuredModel: unknown;
  outboundModel: unknown;
  requestUrl: string;
  variant: AnyRouterPiWireVariant;
  maxTokens: unknown;
  outboundRetryHeader?: string | null;
}

export interface AnyRouterPiDiagnosticRecord {
  timestamp: string;
  event: AnyRouterPiDiagnosticEvent;
  correlationId: string;
  attempt: number | null;
  status: number | null;
  durationMs: number;
  retryAfter: number | null;
  configuredModel: string;
  outboundModel: string;
  requestPath: string;
  variant: AnyRouterPiWireVariant;
  maxTokens: number | null;
  retryHeader: number | null;
}

interface DiagnosticWriteOptions {
  enabled?: boolean;
  filePath?: string;
  maxBytes?: number;
  nowMs?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_PENDING_WRITES = 256;
const MODEL_PATTERN = /^[a-zA-Z0-9._:/\[\]-]{1,160}$/;
let disabledAfterFailure = false;
let pendingWrites = 0;
let writeQueue: Promise<void> = Promise.resolve();

function parseNonNegativeInteger(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sanitizeModel(value: unknown): string {
  const model = typeof value === 'string' ? value : '';
  return MODEL_PATTERN.test(model) ? model : '<invalid>';
}

function sanitizePositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function sanitizeStatus(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

function sanitizeDuration(value: number): number {
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function sanitizeRequestPath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return '<invalid>';
  }
}

function parseRetryAfter(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }
  const dateMs = Date.parse(trimmed);
  return Number.isFinite(dateMs) ? Math.max(0, Math.ceil((dateMs - nowMs) / 1000)) : null;
}

export function createAnyRouterPiDiagnosticRecord(
  input: AnyRouterPiDiagnosticInput,
  nowMs = Date.now(),
): AnyRouterPiDiagnosticRecord {
  const sdkRetryCount = parseNonNegativeInteger(input.sdkRetryHeader);
  return {
    timestamp: new Date(nowMs).toISOString(),
    event: input.event,
    correlationId: /^[0-9a-f-]{16,64}$/i.test(input.correlationId)
      ? input.correlationId
      : '<invalid>',
    attempt: sdkRetryCount === null ? null : sdkRetryCount + 1,
    status: sanitizeStatus(input.status),
    durationMs: sanitizeDuration(input.durationMs),
    retryAfter: parseRetryAfter(input.retryAfterHeader, nowMs),
    configuredModel: sanitizeModel(input.configuredModel),
    outboundModel: sanitizeModel(input.outboundModel),
    requestPath: sanitizeRequestPath(input.requestUrl),
    variant: input.variant,
    maxTokens: sanitizePositiveNumber(input.maxTokens),
    retryHeader: parseNonNegativeInteger(input.outboundRetryHeader),
  };
}

export function getAnyRouterPiDiagnosticsPath(): string {
  const fileName = `anyrouter-pi-diagnostics-${process.pid}.jsonl`;
  const sessionDir = process.env.OPCAGENT_SESSION_DIR?.trim();
  return sessionDir
    ? join(sessionDir, fileName)
    : join(CONFIG_DIR, 'logs', fileName);
}

export function writeAnyRouterPiDiagnostic(
  input: AnyRouterPiDiagnosticInput,
  options: DiagnosticWriteOptions = {},
): void {
  const enabled = options.enabled
    ?? process.env.OPCAGENT_ANYROUTER_PI_DIAGNOSTICS === '1';
  if (!enabled || disabledAfterFailure || pendingWrites >= MAX_PENDING_WRITES) return;

  const filePath = options.filePath ?? getAnyRouterPiDiagnosticsPath();
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const line = `${JSON.stringify(createAnyRouterPiDiagnosticRecord(input, options.nowMs))}\n`;

  pendingWrites += 1;
  const task = async (): Promise<void> => {
    if (disabledAfterFailure) return;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      const currentSize = await stat(filePath).then((value) => value.size).catch(() => 0);
      if (currentSize > 0 && currentSize + Buffer.byteLength(line) > maxBytes) {
        const previousPath = `${filePath}.1`;
        await unlink(previousPath).catch(() => undefined);
        await rename(filePath, previousPath);
      }
      await appendFile(filePath, line, 'utf8');
    } catch {
      // Diagnostics must never affect the provider request or stdout protocol.
      disabledAfterFailure = true;
    }
  };
  writeQueue = writeQueue.then(task, task).finally(() => {
    pendingWrites -= 1;
  });
}

export async function _flushAnyRouterPiDiagnosticsForTesting(): Promise<void> {
  await writeQueue;
}

export function _resetAnyRouterPiDiagnosticsForTesting(): void {
  disabledAfterFailure = false;
}
