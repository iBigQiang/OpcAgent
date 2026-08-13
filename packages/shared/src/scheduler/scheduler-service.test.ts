import { describe, expect, it, jest } from 'bun:test';
import { SchedulerService } from './scheduler-service.ts';

describe('SchedulerService', () => {
  it('uses the injected clock and serializes slow ticks', async () => {
    let resolveTick: (() => void) | undefined;
    const ticks: string[] = [];
    const scheduler = new SchedulerService(async payload => {
      ticks.push(payload.timestamp);
      await new Promise<void>(resolve => { resolveTick = resolve; });
    }, () => new Date('2026-08-12T01:02:03.000Z'));

    const first = scheduler.tickForTest();
    await Promise.resolve();
    await scheduler.tickForTest();
    expect(ticks).toEqual(['2026-08-12T01:02:03.000Z']);
    resolveTick?.();
    await first;
  });

  it('stop is idempotent before start', () => {
    const scheduler = new SchedulerService(async () => {});
    scheduler.stop();
    scheduler.stop();
  });

  it('does not create duplicate timers and can restart after stop', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-12T01:02:03.000Z'));
    const scheduler = new SchedulerService(async () => {});

    scheduler.start();
    scheduler.start();
    expect(jest.getTimerCount()).toBe(1);

    scheduler.stop();
    expect(jest.getTimerCount()).toBe(0);
    scheduler.start();
    expect(jest.getTimerCount()).toBe(1);
    scheduler.stop();
    jest.useRealTimers();
  });

  it('does not install an interval after stop races with alignment', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-12T01:02:59.999Z'));
    const scheduler = new SchedulerService(async () => {});

    scheduler.start();
    scheduler.stop();
    jest.advanceTimersByTime(1);

    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
