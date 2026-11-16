import { failure, PAGE_SIZE, type ToolResult } from "@praxis/domain";

/** A page of rows read newest first, and the cursor to the next, or null on the last page. */
export type RowPage<R> = { rows: R[]; next_cursor: string | null };

/**
 * One page of a list read newest first by order of arrival (`seq`), 50 to a page, from a cursor
 * this list gave. `read` gives the rows before a `seq`, newest first, and `keep` narrows them
 * where SQL cannot, such as a name whatever its case and accents. Rows are read only until a page
 * and one more are kept, to learn whether another page follows.
 */
export function newestFirst<R extends { seq: number }>(
  list: string,
  cursor: string | undefined,
  read: (before: number) => Iterable<R>,
  keep: (row: R) => boolean = () => true,
): ToolResult<RowPage<R>> {
  let before = Number.MAX_SAFE_INTEGER;
  if (cursor !== undefined) {
    const position = decodeCursor(list, cursor);
    if (position === null) return failure("invalid_input", "The cursor is not one this list gave.");
    before = position;
  }
  const kept: R[] = [];
  for (const row of read(before)) {
    if (!keep(row)) continue;
    kept.push(row);
    if (kept.length > PAGE_SIZE) break;
  }
  const rows = kept.slice(0, PAGE_SIZE);
  const last = rows.at(-1);
  return {
    ok: true,
    value: {
      rows,
      next_cursor: kept.length > PAGE_SIZE && last ? encodeCursor(list, last.seq) : null,
    },
  };
}

function encodeCursor(list: string, seq: number): string {
  return btoa(JSON.stringify([list, seq]));
}

function decodeCursor(list: string, cursor: string): number | null {
  try {
    const value: unknown = JSON.parse(atob(cursor));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value[0] === list &&
      Number.isSafeInteger(value[1]) &&
      value[1] >= 0
    ) {
      return value[1];
    }
  } catch {
    // Not base64 or not JSON: not a cursor this list gave.
  }
  return null;
}
