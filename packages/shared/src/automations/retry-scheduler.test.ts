import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RetryScheduler } from './retry-scheduler.ts';
import { AUTOMATIONS_RETRY_QUEUE_FILE } from './constants.ts';
import type { WebhookActionResult } from './types.ts';

const webhookExecutor = mock(async (): Promise<WebhookActionResult> => ({
  type: 'webhook' as const,
  url: 'https://1.1.1.1/hook',
  statusCode: 200,
  success: true,
  durationMs: 1,
}));

describe('RetryScheduler', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'retry-scheduler-test-'));
    webhookExecutor.mockReset().mockResolvedValue({
      type: 'webhook', url: 'https://1.1.1.1/hook', statusCode: 200, success: true, durationMs: 1,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('persists an expanded failed request for restart-safe deferred retry', async () => {
    const scheduler = new RetryScheduler({ workspaceRootPath: tempDir, webhookExecutor });
    await scheduler.enqueue('matcher-1', { type: 'webhook', url: 'https://1.1.1.1/hook' }, 'https://1.1.1.1/hook', 'timeout');

    const entries = readFileSync(join(tempDir, AUTOMATIONS_RETRY_QUEUE_FILE), 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ matcherId: 'matcher-1', deferredAttempt: 0, lastError: 'timeout' });
    expect(entries[0].nextRetryAt).toBeGreaterThan(entries[0].createdAt);
    scheduler.dispose();
  });

  it('advances deferred failures using the bounded 5m, 30m and 1h backoff schedule', async () => {
    const queuePath = join(tempDir, AUTOMATIONS_RETRY_QUEUE_FILE);
    const now = Date.now();
    writeFileSync(queuePath, JSON.stringify({
      id: 'retry-1', matcherId: 'matcher-1', action: { type: 'webhook', url: 'https://1.1.1.1/hook' },
      expandedUrl: 'https://1.1.1.1/hook', deferredAttempt: 0, nextRetryAt: now - 1, createdAt: now,
    }) + '\n');
    webhookExecutor.mockResolvedValue({ type: 'webhook', url: 'https://1.1.1.1/hook', statusCode: 503, success: false, error: 'HTTP 503' });
    const scheduler = new RetryScheduler({ workspaceRootPath: tempDir, webhookExecutor });

    await scheduler.tickForTest();

    const [entry] = readFileSync(queuePath, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    expect(entry.deferredAttempt).toBe(1);
    expect(entry.nextRetryAt).toBeGreaterThanOrEqual(now + 30 * 60_000 - 1_000);
    scheduler.dispose();
  });

  it('uses one processing lock when ticks overlap', async () => {
    const queuePath = join(tempDir, AUTOMATIONS_RETRY_QUEUE_FILE);
    const now = Date.now();
    writeFileSync(queuePath, JSON.stringify({
      id: 'retry-1', matcherId: 'matcher-1', action: { type: 'webhook', url: 'https://1.1.1.1/hook' },
      expandedUrl: 'https://1.1.1.1/hook', deferredAttempt: 0, nextRetryAt: now - 1, createdAt: now,
    }) + '\n');
    let resolveRequest!: () => void;
    let requestStarted!: () => void;
    const requestStartedPromise = new Promise<void>(resolve => { requestStarted = resolve; });
    webhookExecutor.mockImplementation(() => new Promise(resolve => {
      requestStarted();
      resolveRequest = () => resolve({ type: 'webhook', url: 'https://1.1.1.1/hook', statusCode: 200, success: true });
    }));
    const scheduler = new RetryScheduler({ workspaceRootPath: tempDir, webhookExecutor });

    const first = scheduler.tickForTest();
    await requestStartedPromise;
    const second = scheduler.tickForTest();
    expect(webhookExecutor).toHaveBeenCalledTimes(1);
    resolveRequest();
    await Promise.all([first, second]);
    scheduler.dispose();
  });

  it('makes repeated start and dispose safe without retaining the startup timer', () => {
    const scheduler = new RetryScheduler({ workspaceRootPath: tempDir });
    scheduler.start();
    scheduler.start();
    scheduler.dispose();
    scheduler.dispose();
    scheduler.start();
  });
});
