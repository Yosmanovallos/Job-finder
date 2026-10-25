/** Computrabajo does not currently provide a permitted per-posting status
 * check. Its listing timestamp is not evidence that the destination is open.
 */
export function isAvailabilityUnverified(source: string): boolean {
  return source === "Computrabajo";
}
