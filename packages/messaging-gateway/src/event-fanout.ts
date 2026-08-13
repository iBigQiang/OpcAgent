/** Compose event sinks without letting a messaging listener break the base server sink. */
export function createFanOutSink<T extends (...args: any[]) => void>(base: T, messaging: T): T { return ((...args: Parameters<T>) => { base(...args); try { messaging(...args) } catch {} }) as T }
