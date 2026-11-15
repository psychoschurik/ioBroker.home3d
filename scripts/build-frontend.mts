import { build, type Plugin } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "vendor-src/home3d/src");
const version = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
).version;
function replaceRequired(
  text: string,
  pattern: string | RegExp,
  replacement: string,
  name: string,
) {
  const next = text.replace(pattern, replacement);
  if (next === text)
    throw new Error(`Upstream patch no longer matches: ${name}`);
  return next;
}
const localLinks = (text: string) =>
  text
    .replace(
      /https?:\/\/(?:[a-z0-9-]+\.)*mastershort\.de/gi,
      "/help.html#guide",
    )
    .replace(
      /https?:\/\/github\.com\/mastershort\/home3d/gi,
      "/help.html#project",
    )
    .replace(/https?:\/\/discord\.gg\/SSdVVFsev7/gi, "/help.html#help");
const plugin: Plugin = {
  name: "iobroker-ui",
  setup(builder) {
    builder.onLoad({ filter: /\.ts$/ }, async ({ path: file }) => {
      if (!file.startsWith(src)) return;
      let code = await fs.readFile(file, "utf8");
      const name = path.relative(src, file).replaceAll("\\", "/");
      if (name === "components/entity-picker.ts")
        code = (
          await fs.readFile(
            path.join(root, "frontend/entity-picker.ts"),
            "utf8",
          )
        ).replace("./picker-styles.js", "../styles.ts");
      if (name === "styles.ts") {
        const colors = {
          "#070b14": "#18212b",
          "#0d1424": "#202c38",
          "#0f1729": "#263544",
          "#37e0ff": "#4aa4df",
          "#041018": "#ffffff",
          "#5b7cff": "#58a6d3",
          "#e6eefc": "#edf2f6",
          "#8a9bb8": "#a4b4c2",
          "#ffb547": "#f5a623",
          "rgba(14, 21, 38, 0.86)": "rgba(38, 53, 68, 0.96)",
          "rgba(120, 170, 255, 0.16)": "rgba(180, 200, 220, 0.20)",
          "rgba(55, 224, 255, 0.06)": "rgba(74, 164, 223, 0.08)",
        };
        for (const [a, b] of Object.entries(colors))
          code = code.replaceAll(a, b);
        code = code
          .replaceAll("border-radius: 999px;", "border-radius: 5px;")
          .replaceAll(
            '"Bricolage Grotesque", "Figtree", system-ui, sans-serif',
            '"Segoe UI", Roboto, system-ui, sans-serif',
          )
          .replaceAll(
            "0 8px 30px rgba(0, 0, 0, 0.5)",
            "0 3px 12px rgba(0, 0, 0, 0.22)",
          );
      }
      if (name === "panel.ts") {
        code = replaceRequired(
          code,
          /<button role="tab" class="fp3d-tab-ext"[\s\S]*?<\/button>/,
          "",
          "extensions tab",
        );
        code = replaceRequired(
          code,
          "private renderGift() {",
          "private renderGift() { return nothing; }\n  private unusedGift() {",
          "gift",
        );
        code = replaceRequired(
          code,
          "private renderExtensions() {",
          'private renderExtensions() { return html`<div class="fp3d-empty"><h2>ioBroker 3D Home</h2><p>Geräte werden über den Objektbaum verbunden.</p><a class="fp3d-btn" href="/help.html" target="_blank">Lokale Hilfe öffnen</a></div>`; }\n  private unusedExtensions() {',
          "extensions page",
        );
        code = code.replaceAll("3D Home", "3D Home");
      }
      if (name === "components/editor.ts") {
        code = replaceRequired(
          code,
          /private renderHelpLinks\(\) \{[\s\S]*?\n  \}/,
          'private renderHelpLinks() { return html`<section class="fp3d-help"><h3>ioBroker</h3><p class="fp3d-sub">Geräte über den Objektbaum auswählen. Die Zuordnung verwendet deine ioBroker-Datenpunkt-IDs.</p><a class="fp3d-btn" href="/help.html" target="_blank">Hilfe & Bedienung</a></section>`; }',
          "help",
        );
        code = replaceRequired(
          code,
          "private renderProCard() {",
          "private renderProCard() { return nothing; }\n  private unusedProCard() {",
          "pro teaser",
        );
        code = code.replaceAll(
          "./images/solar-pro.jpg",
          "/assets/connected-home.svg",
        );
      }
      // Host-language wording changes only literal human-readable names, never protocol IDs.
      code = localLinks(code)
        .replaceAll("Home Assistant", "ioBroker")
        .replaceAll("3D Home", "3D Home");
      return { contents: code, loader: "ts", resolveDir: path.dirname(file) };
    });
  },
};
const defines: Record<string, string> = Object.fromEntries(
  [
    "VIEWER",
    "EDITOR",
    "CARD_EDITOR",
    "TIMETRAVEL",
    "FUN",
    "VOICE",
    "LOCATE",
    "LANG",
  ].map((k) => [`__FP3D_${k}_HASH__`, JSON.stringify(`iobroker-${version}`)]),
);
defines.__FP3D_VERSION__ = JSON.stringify(version);
const entries = {
  home3d: "main.ts",
  "home3d-3d": "viewer/viewer3d.ts",
  "home3d-editor": "components/editor.ts",
  "home3d-card-editor": "card-editor.ts",
  "home3d-timetravel": "timetravel/entry.ts",
  "home3d-fun": "fun/entry.ts",
  "home3d-voice": "voice/entry.ts",
  "home3d-locate": "locate/entry.ts",
};
for (const [out, entry] of Object.entries(entries))
  await build({
    entryPoints: [path.join(src, entry)],
    outfile: path.join(root, `www/vendor/${out}.js`),
    bundle: true,
    format: "esm",
    target: ["safari15", "chrome94"],
    minify: true,
    legalComments: "none",
    define: defines,
    plugins: [plugin],
    nodePaths: [path.join(root, "node_modules")],
    logLevel: "warning",
  });
for (const file of await fs.readdir(path.join(root, "www/vendor/lang"))) {
  const target = path.join(root, "www/vendor/lang", file);
  await fs.writeFile(
    target,
    localLinks(await fs.readFile(target, "utf8")).replaceAll(
      "Home Assistant",
      "ioBroker",
    ),
  );
}
console.log(
  `ioBroker UI ${version}: 8 bundles built; local help links, theme and object picker applied.`,
);
// The obsolete shop illustration is replaced by our own SVG and is no longer shipped.
await fs.rm(path.join(root, "www/vendor/images/solar-pro.jpg"), {
  force: true,
});
