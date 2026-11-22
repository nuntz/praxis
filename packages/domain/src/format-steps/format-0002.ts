/**
 * Format 2 added `moving` to a Context's file, each unit on its way out of the Context: a file of
 * format 1 held no unit on its way out.
 */
export default function formatStep2(file: Record<string, unknown>): Record<string, unknown> {
  return file.kind === "context" ? { ...file, moving: [] } : file;
}
