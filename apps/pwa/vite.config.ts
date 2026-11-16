import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import { colors, tokensCss } from "./src/design/tokens.ts";

const TOKENS = "virtual:tokens.css";

/** What the app ships from outside: Lucide's icons and the Figtree typeface, each with its licence. */
const SHIPPED = [
  ["Lucide icons", "lucide-solid"],
  ["Figtree", "@fontsource-variable/figtree"],
] as const;

function licenses(): string {
  return SHIPPED.map(([name, pkg]) => {
    const text = readFileSync(join(import.meta.dirname, "node_modules", pkg, "LICENSE"), "utf8");
    return `${name}\n${"=".repeat(name.length)}\n\n${text.trim()}\n`;
  }).join("\n\n");
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
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "licenses.txt", source: licenses() });
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

export default defineConfig({
  plugins: [solid(), tokens()],
  build: { outDir: "dist", emptyOutDir: true },
});
