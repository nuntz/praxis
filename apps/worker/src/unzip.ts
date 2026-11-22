import { failure, success, type ToolResult } from "@praxis/domain";

/**
 * Reading the zip an Export or a Backup is (section 10.1), to restore it. Praxis writes its files
 * stored, uncompressed; a zip the person made again from them, as a system's own archiver does,
 * may deflate them and put them in a folder, with files of the archiver's own beside them, and is
 * read too. Names are UTF-8, as Praxis writes them.
 */

const CENTRAL_FILE = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;
const LOCAL_FILE = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** The bytes the screen sent in base64, or null when they are not base64. */
export function fromBase64(text: string): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** Each file a zip holds, its path and its text as UTF-8, or why it cannot be read. */
export async function unzip(
  bytes: Uint8Array,
): Promise<ToolResult<{ path: string; text: string }[]>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = endOfCentral(view);
  if (end === null) return notAZip();
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const files: { path: string; text: string }[] = [];
  try {
    for (let n = 0; n < count; n += 1) {
      if (view.getUint32(at, true) !== CENTRAL_FILE) return notAZip();
      const method = view.getUint16(at + 10, true);
      const size = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const extra = view.getUint16(at + 30, true);
      const comment = view.getUint16(at + 32, true);
      const local = view.getUint32(at + 42, true);
      const path = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLength));
      at += 46 + nameLength + extra + comment;
      // A folder's own line, as an archiver adds, holds nothing.
      if (path.endsWith("/")) continue;
      if (view.getUint32(local, true) !== LOCAL_FILE) return notAZip();
      const start =
        local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const held = bytes.subarray(start, start + size);
      const content = method === STORED ? held : method === DEFLATED ? await inflated(held) : null;
      if (content === null) {
        return failure(
          "invalid_input",
          `The zip holds ${path} compressed in a way Praxis does not read: give the zip as Praxis made it.`,
        );
      }
      files.push({ path, text: utf8.decode(content) });
    }
  } catch {
    return notAZip();
  }
  return success(asExported(files));
}

/**
 * The files as the Export has them: without what an archiver adds of its own, its `__MACOSX`
 * folder and hidden files such as `.DS_Store`, and out of the one folder it put them all in.
 */
function asExported(files: { path: string; text: string }[]): { path: string; text: string }[] {
  const exported = files.filter(
    ({ path }) =>
      !path.startsWith("__MACOSX/") && !path.split("/").some((part) => part.startsWith(".")),
  );
  const [first] = exported;
  const folder = first?.path.includes("/") ? `${first.path.split("/")[0]}/` : null;
  if (folder === null || !exported.every(({ path }) => path.startsWith(folder))) return exported;
  return exported.map((file) => ({ ...file, path: file.path.slice(folder.length) }));
}

/** Where the zip's end of central directory starts, searched for back from the end, or null. */
function endOfCentral(view: DataView): number | null {
  // It is 22 bytes, then a comment of at most 65535.
  const last = view.byteLength - 22;
  for (let at = last; at >= 0 && at >= last - 0xffff; at -= 1) {
    if (view.getUint32(at, true) === END_OF_CENTRAL) return at;
  }
  return null;
}

async function inflated(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function notAZip(): ToolResult<never> {
  return failure("invalid_input", "This is not an Export Praxis can restore: it is not a zip.");
}
