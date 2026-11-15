import type { IoAccess, StateObject } from "../src/lib/types.js";
import type { AddressInfo } from "node:net";
import test from "node:test";
import assert from "node:assert/strict";
import { Backend, empty } from "../src/lib/backend.js";
import { entities, execute, validateMappings } from "../src/lib/entities.js";
import { createServer } from "../src/lib/server.js";
const objects: Record<string, StateObject> = {
  "lamp.power": { type: "state", common: { type: "boolean", write: true } },
  "lamp.dim": {
    type: "state",
    common: { type: "number", min: 0, max: 100, write: true },
  },
  "sensor.temp": { type: "state", common: { type: "number", write: false } },
};
const mapping = {
  entity_id: "light.living",
  state: "lamp.power",
  actions: {
    turn_on: [
      { id: "lamp.power", value: true },
      { id: "lamp.dim", field: "brightness", scale: 100 / 255, optional: true },
    ],
    turn_off: [{ id: "lamp.power", value: false }],
  },
};
function fixture(persist = async () => {}) {
  const writes: [string, unknown][] = [];
  const io: IoAccess = {
    objects: async () => objects,
    rooms: async () => ({}),
    states: async () => ({}),
    getObject: async (id) => objects[id],
    getState: async () => ({ val: false }),
    setState: async (id, value) => writes.push([id, value]),
  };
  return { backend: new Backend(io, null, persist), io, writes };
}
test("concurrent saves: stale revision cannot overwrite a newer floor plan", async () => {
  const { backend } = fixture();
  const b = empty();
  b.settings.north = 42;
  const results = await Promise.allSettled([
    backend.call({
      type: "home3d/building/save",
      base_revision: 0,
      building: b,
    }),
    backend.call({
      type: "home3d/building/save",
      base_revision: 0,
      building: empty(),
    }),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  if (results[1].status === "rejected")
    assert.equal(results[1].reason.code, "stale_plan");
  assert.equal(backend.data.plans.main.building.settings.north, 42);
});
test("persistence failure rolls back revisions, data and event queue", async () => {
  const { backend } = fixture(async () => {
    throw Error("disk full");
  });
  await assert.rejects(
    backend.call({ type: "home3d/building/save", building: empty() }),
    /disk full/,
  );
  assert.equal(backend.data.plans.main.revision, 0);
  assert.equal(backend.events.length, 0);
});
test("snapshots restore previous content and increment the current revision", async () => {
  const { backend } = fixture();
  await backend.call({ type: "home3d/history/snapshot" });
  const b = empty();
  b.settings.north = 90;
  await backend.call({ type: "home3d/building/save", building: b });
  await backend.call({
    type: "home3d/history/restore",
    snapshot_id: backend.data.plans.main.snapshots[0].id,
  });
  assert.equal(backend.data.plans.main.building.settings.north, 0);
  assert.equal(backend.data.plans.main.revision, 2);
});
test("plan copy, trash and restore preserve independent buildings", async () => {
  const { backend } = fixture();
  const { plan } = await backend.call({
    type: "home3d/plans/create",
    copy_of: "main",
    name: "Garage",
  });
  await backend.call({ type: "home3d/plans/delete", plan });
  assert.equal(backend.list().trash.length, 1);
  await backend.call({ type: "home3d/plans/restore", plan });
  assert.equal(backend.list().plans.length, 2);
  assert.notEqual(
    backend.data.plans.main.building,
    backend.data.plans[plan].building,
  );
});
test("device actions scale brightness and reject out-of-range values before any write", async () => {
  const { io, writes } = fixture();
  await execute(
    [mapping],
    "light",
    "turn_on",
    { entity_id: mapping.entity_id, brightness: 127.5 },
    io,
  );
  assert.deepEqual(writes, [
    ["lamp.power", true],
    ["lamp.dim", 50],
  ]);
  writes.length = 0;
  await assert.rejects(
    execute(
      [mapping],
      "light",
      "turn_on",
      { entity_id: mapping.entity_id, brightness: 500 },
      io,
    ),
    /Bereich/,
  );
  assert.equal(writes.length, 0);
});
test("unmapped services, read-only states and wrong types are rejected", async () => {
  const { io } = fixture();
  await assert.rejects(
    execute(
      [mapping],
      "light",
      "explode",
      { entity_id: mapping.entity_id },
      io,
    ),
    /nicht zugeordnet/,
  );
  assert.throws(
    () =>
      validateMappings(
        [{ ...mapping, actions: { x: [{ id: "sensor.temp", value: 5 }] } }],
        objects,
      ),
    /nicht schreibbar/,
  );
  await assert.rejects(
    execute(
      [{ ...mapping, actions: { x: [{ id: "lamp.power", value: "true" }] } }],
      "light",
      "x",
      { entity_id: mapping.entity_id },
      io,
    ),
    /Werttyp/,
  );
});
test("state conversion preserves quality, units and scaled attributes", () => {
  const m = {
    ...mapping,
    attributes: {
      brightness: { id: "lamp.dim", scale: 2.55 },
      unit_of_measurement: "%",
    },
  };
  const state = entities(
    [m],
    { "lamp.power": { val: true }, "lamp.dim": { val: 100 } },
    objects,
  );
  assert.equal(state["light.living"].state, "on");
  assert.ok(
    Math.abs(state["light.living"].attributes.brightness - 255) < 0.001,
  );
  assert.equal(entities([m], {}, objects)["light.living"].state, "unavailable");
});
test("malformed backup leaves existing plans unchanged", async () => {
  const { backend } = fixture();
  await assert.rejects(
    backend.call({
      type: "home3d/backup/import",
      building: empty(),
      plans: [{ id: "__proto__", building: empty() }],
    }),
    /ID/,
  );
  assert.equal(backend.data.plans.main.revision, 0);
});
test("HTTP API enforces login, origin and valid session; static assets load", async (t) => {
  const { backend } = fixture();
  const server = createServer(backend, "test-access-token-1234");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  assert.equal((await fetch(url + "/api/bootstrap")).status, 401);
  assert.equal((await fetch(url + "/")).status, 200);
  const login = await fetch(url + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "test-access-token-1234" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (await fetch(url + "/api/bootstrap", { headers: { Cookie: cookie } }))
      .status,
    200,
  );
  const denied = await fetch(url + "/api/call", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "https://attacker.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(denied.status, 403);
});
