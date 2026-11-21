// Export and import of a project: one floor plan with its pictures and the ioBroker datapoints of its devices.
// The file is an export file of the 3D frontend (`format: "home3d"`) with an `iobroker` part, so the plan import of
// the editor still reads its building; our import also takes plain export files of the 3D frontend.
import type { Building, Mapping, ModelEntry, ProtocolRecord } from './model.js';
import { t } from './lang.js';
import { MODEL_EXTS, modelSize } from './vendor-ext/model-files.js';

export const PROJECT_FORMAT = 'home3d';
export const PROJECT_VERSION = 1;

export interface ProjectFile {
    format: typeof PROJECT_FORMAT;
    version: 1;
    exported_at: string;
    building: Building;
    iobroker: {
        project: typeof PROJECT_VERSION;
        plan: { name: string | null; icon: string | null; site: unknown };
        /** image ID → data URL */
        images: Record<string, string>;
        /** The device mappings the building uses, without the cached `_meta`. */
        mappings: Mapping[];
        /** Own 3D objects: model ID → what it is and its file as a data URL (missing before 0.5.0). */
        models?: Record<string, ProjectModel>;
    };
}

/** A model of an own 3D object in a project or backup file. */
export type ProjectModel = Omit<ModelEntry, 'file'> & { data: string };

export interface Project {
    name: string | null;
    icon: string | null;
    site: unknown;
    building: Building;
    images: Record<string, string>;
    mappings: Mapping[];
    models: Record<string, ProjectModel>;
}

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** Every string of a value: values and object keys (a module may keep settings by entity ID). */
export function strings(value: unknown, out = new Set<string>()): Set<string> {
    if (typeof value === 'string') {
        out.add(value);
    } else if (Array.isArray(value)) {
        for (const v of value) {
            strings(v, out);
        }
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            out.add(k);
            strings(v, out);
        }
    }
    return out;
}

/** A copy in which strings that equal a key of `map` (values and object keys) are replaced. */
export function renamed<T>(value: T, map: Map<string, string>): T {
    if (!map.size) {
        return structuredClone(value);
    }
    const walk = (v: unknown): unknown => {
        if (typeof v === 'string') {
            return map.get(v) ?? v;
        }
        if (Array.isArray(v)) {
            return v.map(walk);
        }
        if (v && typeof v === 'object') {
            return Object.fromEntries(Object.entries(v).map(([k, x]) => [map.get(k) ?? k, walk(x)]));
        }
        return v;
    };
    return walk(value) as T;
}

/** A mapping as it is stored, without the values cached for the device dialog. */
export function plainMapping(m: Mapping): Mapping {
    const { _meta, ...rest } = m;
    return structuredClone(rest);
}

/** The pictures, device mappings and models of own 3D objects a building refers to. */
export function usedBy(
    building: Building,
    images: Record<string, string>,
    mappings: Mapping[],
    models: Record<string, unknown> = {},
): { images: string[]; mappings: Mapping[]; models: string[] } {
    const used = strings(building);
    return {
        images: Object.keys(images).filter(id => used.has(id)),
        mappings: mappings.filter(m => used.has(m.entity_id)).map(plainMapping),
        models: Object.keys(models).filter(id => used.has(id)),
    };
}

/** The models of a project or backup file that can be stored: a known file type, a size and the file's data. */
export function readModels(value: unknown): Record<string, ProjectModel> {
    const out: Record<string, ProjectModel> = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return out;
    }
    for (const [id, raw] of Object.entries(value)) {
        const m = raw as Partial<ProjectModel> | null;
        const size = modelSize(m?.size);
        if (
            UNSAFE.has(id) ||
            !/^[A-Za-z0-9_-]{1,80}$/.test(id) ||
            !m ||
            typeof m.data !== 'string' ||
            !(MODEL_EXTS as readonly string[]).includes(String(m.ext)) ||
            !size
        ) {
            continue;
        }
        out[id] = {
            name: typeof m.name === 'string' && m.name.trim() ? m.name.trim().slice(0, 80) : id,
            ext: m.ext as ModelEntry['ext'],
            bytes: typeof m.bytes === 'number' ? m.bytes : 0,
            tris: typeof m.tris === 'number' ? m.tris : 0,
            size,
            data: m.data,
        };
    }
    return out;
}

export function projectFile(
    plan: { name: string | null; icon: string | null; site: unknown; building: Building },
    images: Record<string, string>,
    mappings: Mapping[],
    models: Record<string, ProjectModel> = {},
): ProjectFile {
    return {
        format: PROJECT_FORMAT,
        version: 1,
        exported_at: new Date().toISOString(),
        building: structuredClone(plan.building),
        iobroker: {
            project: PROJECT_VERSION,
            plan: { name: plan.name, icon: plan.icon, site: plan.site ?? null },
            images,
            mappings: mappings.map(plainMapping),
            ...(Object.keys(models).length ? { models } : {}),
        },
    };
}

function fail(code: string, message: string): never {
    throw Object.assign(new Error(message), { code });
}

/**
 * Reads a project file, an export file of the 3D frontend (only the building) or a bare building.
 * Throws with the code `not_json` or `not_plan`.
 */
export function readProject(data: unknown): Project {
    let d = data;
    if (typeof d === 'string') {
        try {
            d = JSON.parse(d);
        } catch {
            fail('not_json', t('not_json'));
        }
    }
    const file = d as Partial<ProjectFile> & ProtocolRecord;
    const building = (file?.format === PROJECT_FORMAT ? file.building : file) as Building | undefined;
    if (!building || building.version !== 1 || !Array.isArray(building.floors) || !building.settings) {
        fail('not_plan', t('no_project'));
    }
    const extra: Partial<ProjectFile['iobroker']> =
        file.format === PROJECT_FORMAT && file.iobroker && typeof file.iobroker === 'object' ? file.iobroker : {};
    const images: Record<string, string> = {};
    for (const [id, url] of Object.entries(extra.images ?? {})) {
        if (!UNSAFE.has(id) && typeof url === 'string') {
            images[id] = url;
        }
    }
    const plan = extra.plan ?? { name: null, icon: null, site: null };
    return {
        name: typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim().slice(0, 100) : null,
        icon: typeof plan.icon === 'string' ? plan.icon : null,
        site: plan.site ?? null,
        building: { ...structuredClone(building), presence: Array.isArray(building.presence) ? building.presence : [] },
        images,
        mappings: Array.isArray(extra.mappings) ? extra.mappings.filter(m => m && typeof m === 'object') : [],
        models: readModels(extra.models),
    };
}

/** `light.wohnzimmer` → `light.wohnzimmer_2` (or the next free number). */
export function freeEntityId(id: string, taken: Set<string>): string {
    const base = id.replace(/_\d+$/, '');
    for (let n = 2; ; n++) {
        const next = `${base}_${n}`;
        if (!taken.has(next)) {
            return next;
        }
    }
}

/** A file name from a plan name: `home3d-projekt-<name>-<date>.json`. */
export function projectFileName(name: string | null, date = new Date()): string {
    const slug =
        (name || 'grundriss')
            .toLowerCase()
            .replace(/ä/g, 'ae')
            .replace(/ö/g, 'oe')
            .replace(/ü/g, 'ue')
            .replace(/ß/g, 'ss')
            .normalize('NFKD')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'grundriss';
    return `home3d-projekt-${slug}-${date.toISOString().slice(0, 10)}.json`;
}
