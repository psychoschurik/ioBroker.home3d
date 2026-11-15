import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
await rm(path.join(root, "build"), { recursive: true, force: true });
execFileSync(
  process.execPath,
  [path.join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
  { cwd: root, stdio: "inherit" },
);
await mkdir(path.join(root, "www"), { recursive: true });
await build({
  entryPoints: ["bridge", "device-dialog", "object-tree", "dom"].map((name) =>
    path.join(root, "frontend", name + ".ts"),
  ),
  outdir: path.join(root, "www"),
  format: "esm",
  target: ["safari15", "chrome94"],
  sourcemap: true,
});
console.error("TypeScript adapter and browser shell built.");
