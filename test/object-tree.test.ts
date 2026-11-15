import type { StateObject } from "../src/lib/types.js";
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { discover } from "../src/lib/entities.js";
test("object tree preserves channels, stable IDs and same-prefix siblings", async () => {
  const { makeTree, visibleNodes } = await import("../frontend/object-tree.js");
  const items = [
    { id: "a", path: "hm-rpc.0.abc.STATE" },
    { id: "b", path: "hm-rpc.0.abcd.STATE" },
    { id: "c", path: "zigbee.0.lamp.state" },
  ];
  const tree = makeTree(items);
  assert.equal(visibleNodes(tree, new Set()).length, 2);
  const rows = visibleNodes(tree, new Set(), true);
  assert.deepEqual(
    rows.filter((x) => x.node.item).map((x) => x.node.item!.id),
    ["a", "b", "c"],
  );
  assert.equal(rows.find((x) => x.node.id === "hm-rpc.0")!.node.count, 2);
});
test("search combines words, role and room and supports every result", async () => {
  const { matches, makeTree, visibleNodes } =
    await import("../frontend/object-tree.js");
  const item = {
    id: "x",
    path: "alias.0.living.temperature",
    label: "Wohnzimmer",
    role: "value.temperature",
    room: "enum.rooms.living",
  };
  assert.ok(
    matches(item, "wohn temp", "value.temperature", "enum.rooms.living"),
  );
  assert.ok(!matches(item, "wohn", "switch", ""));
  const items = Array.from({ length: 500 }, (_, i) => ({
    ...item,
    id: String(i),
    path: `test.0.channel${i}.value`,
  }));
  assert.equal(
    visibleNodes(makeTree(items), new Set(), true).filter((x) => x.node.item)
      .length,
    500,
  );
});
test("discovery exposes object metadata but masks secret previews", () => {
  const obj = (id: string, role: string, type: string): StateObject => ({
    _id: id,
    type: "state",
    common: { name: id, role, type, read: true },
  });
  const result = discover(
    {
      "device.0.token": obj("device.0.token", "text", "string"),
      "device.0.temp": obj("device.0.temp", "value.temperature", "number"),
      "home3d.0.storage": obj("home3d.0.storage", "json", "string"),
    },
    {},
    { "device.0.token": { val: "private" }, "device.0.temp": { val: 22 } },
  );
  assert.equal(result.length, 2);
  assert.equal(result[0]._meta!.value, "••••");
  assert.equal(result[1]._meta!.role, "value.temperature");
  assert.equal(result[1]._meta!.value, 22);
});
test("distributed frontend contains no original developer web destinations", () => {
  for (const file of fs
    .readdirSync("www/vendor")
    .filter((f) => f.endsWith(".js"))) {
    const text = fs.readFileSync(`www/vendor/${file}`, "utf8");
    assert.doesNotMatch(
      text,
      /https?:\/\/(?:[a-z0-9-]+\.)*mastershort\.de|https?:\/\/github\.com\/Mastershort\/home3d|https?:\/\/discord\.gg\/SSdVVFsev7/i,
      file,
    );
  }
  assert.ok(fs.readFileSync("LICENSE", "utf8").includes("Mastershort"));
});

test("rebuilt locating bundle retains custom element registration", () => {
  const bundle = fs.readFileSync("www/vendor/home3d-locate.js", "utf8");
  assert.match(bundle, /customElements\.define\("fp3d-locate-setup"/);
});
