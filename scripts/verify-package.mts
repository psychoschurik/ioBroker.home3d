import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Backend as BackendType } from "../src/lib/backend.js";
import type { createServer as ServerFactory } from "../src/lib/server.js";

const root = path.resolve(import.meta.dirname, "..");
const metadata = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const filename = `${metadata.name}-${metadata.version}.tgz`;
const temporary = await mkdtemp(path.join(tmpdir(), "3d-home-package-"));
const require = createRequire(import.meta.url);
try {
  execFileSync("tar", ["-xf", path.join(root, filename), "-C", temporary]);
  const unpacked = path.join(temporary, "package");
  const pkg = JSON.parse(
    await readFile(path.join(unpacked, "package.json"), "utf8"),
  );
  const io = JSON.parse(
    await readFile(path.join(unpacked, "io-package.json"), "utf8"),
  );
  assert.equal(pkg.main, "build/main.js");
  assert.equal(io.common.main, pkg.main);
  assert.equal(pkg.version, io.common.version);
  await readFile(path.join(unpacked, pkg.main));
  await readFile(path.join(unpacked, "admin", io.common.icon));
  const { Backend } = require(path.join(unpacked, "build/lib/backend.js")) as {
    Backend: typeof BackendType;
  };
  const { createServer } = require(
    path.join(unpacked, "build/lib/server.js"),
  ) as { createServer: typeof ServerFactory };
  const backend = new Backend(
    {
      objects: async () => ({}),
      rooms: async () => ({}),
      states: async () => ({}),
      getObject: async () => null,
      getState: async () => null,
      setState: async () => {},
    },
    null,
    async () => {},
  );
  const server = createServer(backend, "package-smoke-test-key");
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const asset of [
      "/",
      "/bridge.js",
      "/device-dialog.js",
      "/object-tree.js",
      "/dom.js",
      "/vendor/home3d.js",
    ]) {
      const response = await fetch(origin + asset);
      assert.equal(response.status, 200, asset);
      assert.ok((await response.text()).length > 0, asset);
    }
    assert.equal((await fetch(origin + "/api/bootstrap")).status, 401);
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "package-smoke-test-key" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const response = await fetch(origin + "/api/call", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ type: "home3d/building/get" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).version, pkg.version);
    console.log(
      `Verified ${filename}: compiled backend, authentication and browser assets.`,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
} finally {
  // Only remove the unique directory returned by mkdtemp, never a supplied path.
  await rm(temporary, { recursive: true, force: true });
}
