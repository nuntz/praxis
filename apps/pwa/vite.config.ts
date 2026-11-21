import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin, type ResolvedConfig, type Rolldown } from "vite";
import solid from "vite-plugin-solid";
import { colors, tokensCss } from "./src/design/tokens.ts";

const TOKENS = "virtual:tokens.css";

/**
 * What the app ships from outside, each with its licence (section 8.11): every package whose code
 * is in the bundle, found from the bundle itself so none is missed, and the Figtree typeface,
 * which comes by its stylesheet, named here too so it ships however that is bundled.
 */
const TYPEFACES = ["@fontsource-variable/figtree"] as const;

const NODE_MODULES = "/node_modules/";

/** Each package with code in the bundle, by its name, and the folder it was read from. */
function packagesIn(bundle: Rolldown.OutputBundle): Map<string, string> {
  const found = new Map<string, string>();
  for (const output of Object.values(bundle)) {
    if (output.type !== "chunk") continue;
    for (const id of Object.keys(output.modules)) {
      const path = id.replace(/^\0/, "").replace(/\?.*$/, "");
      const at = path.lastIndexOf(NODE_MODULES);
      if (at < 0) continue;
      const [scope, name] = path.slice(at + NODE_MODULES.length).split("/");
      const pkg = scope?.startsWith("@") ? `${scope}/${name}` : scope;
      if (pkg) found.set(pkg, path.slice(0, at + NODE_MODULES.length) + pkg);
    }
  }
  return found;
}

/** A package's licence, from its folder. A package shipped with none fails the build. */
function licenseOf(pkg: string, folder: string): string {
  const file = readdirSync(folder).find((each) => /^licen[cs]e/i.test(each));
  if (!file) throw new Error(`${pkg} ships in the bundle with no licence file in ${folder}`);
  return readFileSync(join(folder, file), "utf8").trim();
}

function licenses(bundle: Rolldown.OutputBundle): string {
  const shipped = packagesIn(bundle);
  for (const pkg of TYPEFACES) {
    if (!shipped.has(pkg)) shipped.set(pkg, join(import.meta.dirname, "node_modules", pkg));
  }
  return [...shipped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pkg, folder]) => `${pkg}\n${"=".repeat(pkg.length)}\n\n${licenseOf(pkg, folder)}\n`)
    .join("\n\n");
}

/**
 * The design tokens are the source (section 8.11): the stylesheet of custom properties, the
 * browser's theme colour and the manifest's colours are all made from them at build time.
 */
function tokens(): Plugin {
  return {
    name: "praxis-tokens",
    resolveId: (id) => (id === TOKENS ? `\0${TOKENS}` : undefined),
    load: (id) => (id === `\0${TOKENS}` ? tokensCss() : undefined),
    transformIndexHtml: () =>
      (["light", "dark"] as const).map((theme) => ({
        tag: "meta",
        attrs: {
          name: "theme-color",
          media: `(prefers-color-scheme: ${theme})`,
          content: colors.ground[theme],
        },
        injectTo: "head",
      })),
    generateBundle(_options, bundle) {
      this.emitFile({ type: "asset", fileName: "licenses.txt", source: licenses(bundle) });
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: JSON.stringify(
          {
            name: "Praxis",
            short_name: "Praxis",
            start_url: "/",
            display: "standalone",
            background_color: colors.ground.light,
            theme_color: colors.ground.light,
            // The hammer on a dark neutral tile, which never takes a Context's accent.
            icons: [
              { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
              { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
              { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
              {
                src: "/icon-maskable-512.png",
                sizes: "512x512",
                type: "image/png",
                purpose: "maskable",
              },
            ],
          },
          null,
          2,
        ),
      });
    },
  };
}

/** The service worker's source, which the build writes out with its release's files. */
const SERVICE_WORKER = join(import.meta.dirname, "sw.js");

/** The line of the service worker the build fills in (sw.js). */
const SCREEN_LINE = /^const SCREEN = .*;$/m;

/** Every file under a folder, by its path from it. */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((each) => each.isFile())
    .map((each) => relative(folder, join(each.parentPath, each.name)));
}

/**
 * The service worker, written with the release it keeps (section 8.8): every file the build made
 * and every file of public/, as the Worker serves them, the screen at "/", and a name for the
 * release made from all of them, so a release that changes any is a new service worker, which
 * the browser takes in place of the last and which keeps only its own.
 */
function serviceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "praxis-service-worker",
    apply: "build",
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle(_options, bundle) {
      const contents = new Map<string, string | Uint8Array>();
      for (const output of Object.values(bundle)) {
        contents.set(output.fileName, output.type === "chunk" ? output.code : output.source);
      }
      for (const file of config.publicDir ? filesUnder(config.publicDir) : []) {
        contents.set(file, readFileSync(join(config.publicDir, file)));
      }
      const release = createHash("sha256");
      const files = [...contents.keys()].sort();
      for (const file of files)
        release
          .update(file)
          .update("\0")
          .update(contents.get(file) ?? "");
      const source = readFileSync(SERVICE_WORKER, "utf8");
      if (!SCREEN_LINE.test(source)) throw new Error(`${SERVICE_WORKER} has no SCREEN to fill in`);
      release.update(source);
      const screen = {
        release: release.digest("hex").slice(0, 16),
        files: files.map((file) => (file === "index.html" ? "/" : `/${file}`)),
      };
      writeFileSync(
        join(config.build.outDir, "sw.js"),
        source.replace(SCREEN_LINE, `const SCREEN = ${JSON.stringify(screen)};`),
      );
    },
  };
}

export default defineConfig({
  plugins: [solid(), tokens(), serviceWorker()],
  build: { outDir: "dist", emptyOutDir: true },
});
