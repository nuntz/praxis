/**
 * The one place the real clock is read: when a request or an alarm reaches the Worker, and the
 * platform's own timings. Everything below is handed the time, so domain and tool code never
 * read the clock and tests set it.
 */
export function arrivalTime(): number {
  return Date.now();
}

/** Starts timing something for the platform's logs. Calling the result gives milliseconds. */
export function startTimer(): () => number {
  const started = performance.now();
  return () => Math.round(performance.now() - started);
}
