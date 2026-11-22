import type { DeploymentFile, Export } from "@praxis/domain";
import { DEPLOYMENT_FILE, exportZip } from "@praxis/domain";
import { hand, type newDeployment, value } from "./seam.ts";

// Restoring an Export as a test does it (section 10.2): its zip given to `restore_export` as the
// screen gives it, and the Export a Deployment restored from it is then held to make.

type Deployment = ReturnType<typeof newDeployment>;

/** The zip of an Export as `restore_export` takes it: its bytes in base64, as the screen sends them. */
export function fileOf(made: Export): string {
  return base64(exportZip(made));
}

/** Bytes in base64, as the screen sends a file it was given. */
export function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** Restore an Export into a Deployment, as the person's hand does during setup. */
export function restore(deployment: Deployment, made: Export) {
  return deployment.call(hand, "restore_export", { file: fileOf(made) });
}

/** The Deployment's file of an Export. */
export function deploymentFile(made: Export): DeploymentFile {
  const file = made.files.find((f) => f.path === DEPLOYMENT_FILE);
  if (file?.content.kind !== "deployment") throw new Error("No Deployment file.");
  return file.content;
}

/**
 * An Export as a Deployment restored from it would make it at `at`: every Context under the id of
 * its object there, since only the platform mints an object's id, and stamped with that time.
 */
export function asRestored(made: Export, contexts: Map<string, string>, at: string): Export {
  let text = JSON.stringify(made);
  for (const [was, is] of contexts) text = text.replaceAll(was, is);
  const moved = JSON.parse(text) as Export;
  return {
    ...moved,
    made_at: at,
    files: moved.files.map(({ path, content }) => ({ path, content: { ...content, made_at: at } })),
  };
}

/** The ids the restored Deployment lists each Context by, from the one it was made from. */
export async function restoredIds(from: Export, into: Deployment): Promise<Map<string, string>> {
  const listed = value(await into.call(hand, "list_contexts", {})).items;
  return new Map(
    deploymentFile(from).contexts.map((context, place) => [context.id, listed[place]?.id ?? ""]),
  );
}
