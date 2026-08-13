/**
 * SchedulerService - Emits SchedulerTick events every minute
 *
 * Aligned to minute boundaries for consistent timing.
 * Automations can subscribe using cron expressions in automations.json.
 */

export interface SchedulerTickPayload {
  /** ISO 8601 UTC timestamp */
  timestamp: string;
  /** HH:MM in local time */
  localTime: string;
  /** Hour (0-23) */
  hour: number;
  /** Minute (0-59) */
  minute: number;
  /** Day of week (0-6, Sunday = 0) */
  dayOfWeek: number;
  /** Day name abbreviation (Sun, Mon, Tue, etc.) */
  dayName: string;
}

export class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private alignmentTimer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private running = false;
  private readonly onTick: (payload: SchedulerTickPayload) => Promise<void>;
  private readonly now: () => Date;

  constructor(onTick: (payload: SchedulerTickPayload) => Promise<void>, now: () => Date = () => new Date()) {
    this.onTick = onTick;
    this.now = now;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Align to next minute boundary for consistent timing
    const now = this.now();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    this.alignmentTimer = setTimeout(() => {
      this.alignmentTimer = null;
      if (!this.running) return;
      this.tick();
      if (this.running) this.timer = setInterval(() => this.tick(), 60_000);
    }, msUntilNextMinute);
  }

  stop(): void {
    this.running = false;
    if (this.alignmentTimer) {
      clearTimeout(this.alignmentTimer);
      this.alignmentTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tickForTest(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.isTicking) {
      console.warn('[SchedulerService] Previous tick still running, skipping');
      return;
    }
    this.isTicking = true;

    try {
      const now = this.now();
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

      const payload: SchedulerTickPayload = {
        timestamp: now.toISOString(),
        localTime: now.toTimeString().slice(0, 5), // HH:MM
        hour: now.getHours(),
        minute: now.getMinutes(),
        dayOfWeek: now.getDay(),
        dayName: days[now.getDay()]!, // getDay() always returns 0-6
      };

      console.log('[SchedulerService] TICK at', payload.localTime, 'UTC:', payload.timestamp);

      await this.onTick(payload);
      console.log('[SchedulerService] TICK callback completed');
    } catch (error) {
      console.error('[SchedulerService] Tick failed:', error);
    } finally {
      this.isTicking = false;
    }
  }
}
