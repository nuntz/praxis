/**
 * The one place the real clock is read: when a request reaches the Worker. Everything below is
 * handed this time, so domain and tool code never read the clock and tests set it.
 */
export function arrivalTime(): number {
  return Date.now();
}
