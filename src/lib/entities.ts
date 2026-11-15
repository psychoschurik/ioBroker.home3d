import type {
  Mapping,
  Binding,
  StateObject,
  StateValue,
  RoomObject,
  IoAccess,
  ProtocolRecord,
} from "./types.js";
import { createHash } from "node:crypto";
const nameOf = (
  o:
    | { _id?: string; common?: { name?: string | Record<string, string> } }
    | undefined,
): string =>
  typeof o?.common?.name === "object"
    ? o.common.name.de || o.common.name.en || o._id || ""
    : o?.common?.name || o?._id || "";
function fail(message: string): never {
  throw Object.assign(new Error(message), { code: "invalid_mapping" });
}
function validateMappings(
  mappings: Mapping[],
  objects: Record<string, StateObject>,
): Mapping[] {
  if (!Array.isArray(mappings) || mappings.length > 10000)
    fail("Zuordnungen müssen eine Liste sein (max. 10000).");
  const seen = new Set();
  for (const m of mappings) {
    if (
      !m ||
      !/^(light|switch|sensor|binary_sensor|cover|climate|media_player|camera|scene|button|number|select|fan|vacuum|lock|person|weather)\.[a-z0-9_]+$/.test(
        m.entity_id,
      ) ||
      seen.has(m.entity_id)
    )
      fail("Ungültige oder doppelte entity_id.");
    seen.add(m.entity_id);
    if (!objects[m.state]?.common || objects[m.state].type !== "state")
      fail(`Datenpunkt fehlt: ${m.state}`);
    for (const binding of Object.values(m.attributes || {}))
      if (typeof binding === "object" && binding?.id && !objects[binding.id])
        fail(`Attribut-Datenpunkt fehlt: ${binding.id}`);
    for (const rules of Object.values(m.actions || {})) {
      if (!Array.isArray(rules)) fail("Aktionen müssen Listen sein.");
      for (const r of rules) {
        const o = objects[r.id];
        if (!o || o.type !== "state" || o.common?.write !== true)
          fail(`Datenpunkt nicht schreibbar: ${r.id}`);
        if (r.field === undefined && !Object.hasOwn(r, "value") && !r.toggle)
          fail("Aktion braucht field, value oder toggle.");
        for (const key of ["scale", "offset"] as const)
          if (r[key] !== undefined && !Number.isFinite(r[key]))
            fail(`${key} muss eine Zahl sein.`);
      }
    }
  }
  return mappings;
}
function transformed(value: unknown, binding: Binding): any {
  if (binding?.map && Object.hasOwn(binding.map, String(value)))
    return binding.map[String(value)];
  if (binding?.scale !== undefined || binding?.offset !== undefined)
    return Number(value) * (binding.scale ?? 1) + (binding.offset ?? 0);
  return value;
}
function entities(
  mappings: Mapping[],
  states: Record<string, StateValue>,
  objects: Record<string, StateObject>,
) {
  const out: Record<
    string,
    {
      entity_id: string;
      state: string;
      attributes: ProtocolRecord;
      last_changed: string;
      last_updated: string;
    }
  > = {};
  for (const m of mappings) {
    const s = states[m.state];
    const attributes: ProtocolRecord = {
      friendly_name: m.name || nameOf(objects[m.state]),
      iobroker_id: m.state,
      iobroker_role: objects[m.state]?.common?.role || "",
      iobroker_type: objects[m.state]?.common?.type || "",
    };
    for (const [key, binding] of Object.entries(m.attributes || {}))
      attributes[key] =
        binding && typeof binding === "object" && binding.id
          ? transformed(states[binding.id]?.val, binding)
          : binding;
    let value = transformed(s?.val, m);
    if (typeof value === "boolean") value = value ? "on" : "off";
    out[m.entity_id] = {
      entity_id: m.entity_id,
      state:
        !s || s.val === null || (s.q && s.q !== 0)
          ? "unavailable"
          : String(value),
      attributes,
      last_changed: new Date(s?.lc || s?.ts || 0).toISOString(),
      last_updated: new Date(s?.ts || 0).toISOString(),
    };
  }
  return out;
}
function discover(
  objects: Record<string, StateObject>,
  rooms: Record<string, RoomObject> = {},
  states: Record<string, StateValue> = {},
): Mapping[] {
  return Object.values(objects)
    .filter(
      (o): o is StateObject & { _id: string } =>
        typeof o._id === "string" &&
        o.type === "state" &&
        o.common?.read !== false &&
        !o._id.startsWith("system.") &&
        !/^(?:home3d|3d-home)\.\d+\.storage$/.test(o._id),
    )
    .map((o) => {
      const c = o.common,
        role = c.role || "";
      let domain =
        c.type === "boolean"
          ? c.write
            ? "switch"
            : "binary_sensor"
          : "sensor";
      if (/^switch\.light/.test(role)) domain = "light";
      const raw = states[o._id]?.val;
      const secret =
        c.type === "string" &&
        /password|token|secret|credential|apikey/i.test(o._id + " " + role);
      const m: Mapping & { attributes: Record<string, any> } = {
        entity_id: `${domain}.${createHash("sha256").update(o._id).digest("hex").slice(0, 24)}`,
        name: nameOf(o),
        state: o._id,
        attributes: {},
        actions: {},
        _meta: {
          role,
          type: c.type,
          read: c.read !== false,
          write: c.write === true,
          value: secret
            ? "••••"
            : typeof raw === "string"
              ? raw.slice(0, 120)
              : raw,
        },
      };
      if (c.unit) m.attributes.unit_of_measurement = c.unit;
      const classes = {
        temperature: "temperature",
        humidity: "humidity",
        power: "power",
        energy: "energy",
        motion: "motion",
        window: "window",
        door: "door",
        smoke: "smoke",
      };
      for (const [part, value] of Object.entries(classes))
        if (role.split(".").includes(part)) m.attributes.device_class = value;
      const room = Object.values(rooms).find((r) =>
        r.common?.members?.some(
          (id) => o._id === id || o._id.startsWith(id + "."),
        ),
      );
      if (room) m.area_id = room._id;
      if (c.type === "boolean" && c.write === true)
        m.actions = {
          turn_on: [{ id: o._id, value: true }],
          turn_off: [{ id: o._id, value: false }],
          toggle: [{ id: o._id, toggle: true }],
        };
      return m;
    });
}
async function execute(
  mappings: Mapping[],
  domain: string,
  service: string,
  data: ProtocolRecord,
  io: IoAccess,
) {
  const ids = Array.isArray(data.entity_id) ? data.entity_id : [data.entity_id];
  if (!ids.length || ids.some((id) => typeof id !== "string"))
    fail("entity_id erforderlich.");
  const writes: [string, any][] = [];
  for (const id of ids) {
    const m = mappings.find((item) => item.entity_id === id);
    if (!m || (domain !== "homeassistant" && id.split(".")[0] !== domain))
      fail(`Unbekanntes Gerät: ${id}`);
    const rules = m.actions?.[service];
    if (!rules?.length)
      fail(`Aktion ${service} für ${m.name || id} nicht zugeordnet.`);
    for (const r of rules) {
      if (r.field && !Object.hasOwn(data, r.field)) {
        if (r.optional) continue;
        fail(`Parameter ${r.field} fehlt.`);
      }
      const o = await io.getObject(r.id);
      if (o?.type !== "state" || o.common?.write !== true)
        fail(`Nicht schreibbar: ${r.id}`);
      let value = r.toggle
        ? !(await io.getState(r.id))?.val
        : r.field
          ? data[r.field]
          : r.value;
      value = transformed(value, r);
      if (typeof value !== o.common.type)
        fail(`Falscher Werttyp für ${r.id}: erwartet ${o.common.type}.`);
      if (
        typeof value === "number" &&
        (!Number.isFinite(value) ||
          (o.common.min !== undefined && value < o.common.min) ||
          (o.common.max !== undefined && value > o.common.max))
      )
        fail(`Wert außerhalb des Bereichs: ${r.id}`);
      writes.push([r.id, value]);
    }
  }
  // Validate all commands before the first physical write. Adapter errors still propagate to the UI.
  for (const [id, value] of writes) await io.setState(id, value);
  return { written: writes.length };
}
export { validateMappings, entities, discover, execute, nameOf };
