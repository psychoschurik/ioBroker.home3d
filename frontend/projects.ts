// Several projects, like the projects of vis-2: each has its own floor plans, pictures, models, restore points,
// device mappings and house settings, in its own folder of the files of home3d.0: `<id>/data.json`, `<id>/images/`,
// `<id>/history/`, `<id>/models/`; the default project in `default/`. The page opens one by its link
// (`index.html?project=<id>`, missing: the default project); switching is a new page load.
import type { FileAccess, IoAccess } from './model.js';
import { DATA_FILE, Store, projectName } from './store.js';
import { t } from './lang.js';

/** The project a page opens without `?project=`; it always stays. */
export const DEFAULT_PROJECT = 'default';
/** Exported files (a floor plan, a whole project) saved in ioBroker; no project may have this ID. */
export const EXPORTS_FOLDER = 'exports';
/** What belongs to a project besides `data.json`: the folders it copies. */
const PROJECT_DIRS = ['images', 'history', 'models'];
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function fail(code: string, message: string): never {
    throw Object.assign(new Error(message), { code });
}

export function isProjectId(id: unknown): id is string {
    return typeof id === 'string' && ID.test(id) && id !== EXPORTS_FOLDER;
}

/** The folder of a project's files below home3d.0: its ID. */
export function projectFolder(id: string): string {
    if (!isProjectId(id)) {
        fail('bad_project', t('project_bad_id', { id: String(id) }));
    }
    return id;
}

/** The project a page address asks for (`?project=<id>`); missing or empty: the default project. */
export function projectFromUrl(search: string): string {
    const id = new URLSearchParams(search).get('project');
    if (!id) {
        return DEFAULT_PROJECT;
    }
    if (!isProjectId(id)) {
        fail('bad_project', t('project_bad_id', { id }));
    }
    return id;
}

/**
 * A page address for a project, relative (web serves the page under /home3d/), with further parameters
 * (`kiosk`: empty string, `view: 'card'`); the default project needs none.
 */
export function projectLink(id: string, params: Record<string, string> = {}): string {
    const query = Object.entries(params).map(([k, v]) => (v === '' ? k : `${k}=${encodeURIComponent(v)}`));
    if (id !== DEFAULT_PROJECT) {
        query.push(`project=${encodeURIComponent(id)}`);
    }
    return query.length ? `index.html?${query.join('&')}` : 'index.html';
}

/** A name in lowercase letters, digits and dashes (umlauts spelled out); '' when nothing of it is left. */
function slug(name: string): string {
    return name
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFKD')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
        .replace(/-+$/, '');
}

/**
 * The ID of a new project from its name: lowercase letters, digits and dashes, not taken (also by another folder of
 * home3d.0), never `default` or `exports`.
 */
export function newProjectId(name: string, taken: Iterable<string>): string {
    const used = new Set([...taken, DEFAULT_PROJECT, EXPORTS_FOLDER, '']);
    const base = slug(name) || 'project';
    if (!used.has(base)) {
        return base;
    }
    for (let n = 2; ; n++) {
        if (!used.has(`${base}-${n}`)) {
            return `${base}-${n}`;
        }
    }
}

/** The files of a folder below home3d.0, with names relative to it (the store of one project). */
export function inFolder(files: FileAccess, folder: string): FileAccess {
    if (!folder) {
        return files;
    }
    const at = (name: string): string => `${folder}/${name}`;
    return {
        readText: name => files.readText(at(name)),
        writeText: (name, text) => files.writeText(at(name), text),
        readDataUrl: name => files.readDataUrl(at(name)),
        writeBinary: (name, bytes) => files.writeBinary(at(name), bytes),
        remove: name => files.remove(at(name)),
    };
}

/** What the project list needs of the file storage of home3d.0 besides reading and writing files. */
export interface ProjectStorage extends FileAccess {
    /** The entries of a folder ('' for the root); empty if it is not there. */
    list(folder: string): Promise<{ file: string; isDir: boolean }[]>;
    /** Removes a folder with everything in it. */
    removeFolder(folder: string): Promise<void>;
    /** Copies one file, its bytes as they are. */
    copy(from: string, to: string): Promise<void>;
    /** Moves one file. */
    move(from: string, to: string): Promise<void>;
}

export interface ProjectInfo {
    id: string;
    /** null: no name of its own (the default project shows as "Standardprojekt", another one by its ID) */
    name: string | null;
    plans: number;
    devices: number;
    /** `data.json` could not be read. */
    broken?: boolean;
}

/** The name shown for a project. */
export function projectLabel(p: { id: string; name: string | null }): string {
    return p.name || (p.id === DEFAULT_PROJECT ? t('default_project') : p.id);
}

/** A backup file (the whole project, `home3d-backup`) as an import reads it. */
export interface ProjectBackup {
    format: 'home3d-backup';
    building: unknown;
    name?: unknown;
    [key: string]: unknown;
}

/** Reads a backup file of a whole project; throws `not_json` or `not_backup`. */
export function readBackup(text: string): ProjectBackup {
    let d: unknown;
    try {
        d = JSON.parse(text);
    } catch {
        fail('not_json', t('not_json'));
    }
    const b = d as Partial<ProjectBackup> | null;
    if (!b || b.format !== 'home3d-backup' || !b.building || typeof b.building !== 'object') {
        fail('not_backup', t('no_backup'));
    }
    return b as ProjectBackup;
}

/** A file name for a project's export: `home3d-project-<name>-<date>.json`. */
export function backupFileName(name: string, date = new Date()): string {
    return `home3d-project-${slug(name) || 'project'}-${date.toISOString().slice(0, 10)}.json`;
}

export class Projects {
    constructor(
        private storage: ProjectStorage,
        private io: IoAccess,
    ) {}

    /** The store of one project (loaded by the caller). */
    store(id: string): Store {
        return new Store(this.io, inFolder(this.storage, projectFolder(id)));
    }

    private async info(id: string): Promise<ProjectInfo | null> {
        let text: string | null;
        try {
            text = await this.storage.readText(`${projectFolder(id)}/${DATA_FILE}`);
        } catch {
            return { id, name: null, plans: 0, devices: 0, broken: true };
        }
        if (!text) {
            // the default project before its first start; another folder without data.json is no project
            return id === DEFAULT_PROJECT ? { id, name: null, plans: 1, devices: 0 } : null;
        }
        try {
            const d = JSON.parse(text) as {
                name?: unknown;
                plans?: Record<string, { deleted_at?: number }>;
                mappings?: unknown[];
            };
            return {
                id,
                name: projectName(d.name),
                plans: Object.values(d.plans ?? {}).filter(p => p && !p.deleted_at).length,
                devices: Array.isArray(d.mappings) ? d.mappings.length : 0,
            };
        } catch {
            return { id, name: null, plans: 0, devices: 0, broken: true };
        }
    }

    /** All projects: the folders of home3d.0 with a `data.json`, the default project first, then by name. */
    async list(): Promise<ProjectInfo[]> {
        const ids = (await this.storage.list(''))
            .filter(e => e.isDir && isProjectId(e.file) && e.file !== DEFAULT_PROJECT)
            .map(e => e.file);
        const all = (await Promise.all([DEFAULT_PROJECT, ...ids].map(id => this.info(id)))).filter(
            (p): p is ProjectInfo => !!p,
        );
        const [first, ...rest] = all;
        return [first, ...rest.sort((a, b) => projectLabel(a).localeCompare(projectLabel(b)))];
    }

    private async freeId(name: string): Promise<string> {
        // no folder of home3d.0 is taken over (a deleted project's remains, exports/)
        const taken = (await this.storage.list('')).map(e => e.file);
        return newProjectId(name, taken);
    }

    /** A new, empty project (one floor plan). Returns its ID. */
    async create(name: string): Promise<string> {
        const clean = projectName(name);
        if (!clean) {
            fail('bad_name', t('project_name_missing'));
        }
        const id = await this.freeId(clean);
        const store = this.store(id);
        await store.load();
        await store.call({ type: 'home3d/iobroker/project/name', name: clean });
        return id;
    }

    /** A copy of a project with everything it has (floor plans, trash, pictures, models, restore points, devices). */
    async copy(from: string, name: string): Promise<string> {
        const clean = projectName(name);
        if (!clean) {
            fail('bad_name', t('project_name_missing'));
        }
        const source = projectFolder(from);
        const text = await this.storage.readText(`${source}/${DATA_FILE}`);
        if (!text) {
            fail('not_found', t('project_missing'));
        }
        const target = projectFolder(await this.freeId(clean));
        try {
            for (const dir of PROJECT_DIRS) {
                for (const e of await this.storage.list(`${source}/${dir}`)) {
                    if (!e.isDir) {
                        await this.storage.copy(`${source}/${dir}/${e.file}`, `${target}/${dir}/${e.file}`);
                    }
                }
            }
            // last: the folder is a project only with its data.json
            await this.storage.writeText(
                `${target}/${DATA_FILE}`,
                JSON.stringify({ ...JSON.parse(text), name: clean }),
            );
        } catch (e) {
            await this.storage.removeFolder(target).catch(() => {});
            throw e;
        }
        return target;
    }

    async rename(id: string, name: string): Promise<void> {
        const store = this.store(id);
        await store.load(false);
        await store.call({ type: 'home3d/iobroker/project/name', name });
    }

    /** Deletes a project with all its files; the default project stays. */
    async remove(id: string): Promise<void> {
        if (id === DEFAULT_PROJECT) {
            fail('default_project', t('default_project_stays'));
        }
        await this.storage.removeFolder(projectFolder(id));
    }

    /** A whole project as a backup file (also what the editor's "Sicherung" restores), with its name and settings. */
    async exportFile(id: string): Promise<{ name: string; text: string }> {
        const store = this.store(id);
        await store.load(false);
        const backup = await store.call({ type: 'home3d/backup/export' });
        const name = projectLabel({ id, name: store.data.name ?? null });
        return {
            name: backupFileName(name),
            text: JSON.stringify({ ...backup, exported_at: new Date().toISOString(), name }, null, 1),
        };
    }

    /** A backup file as a new project. Returns its ID and what was left out. */
    async importFile(text: string, name: string): Promise<{ id: string; skipped: { id: string; reason: string }[] }> {
        const backup = readBackup(text);
        const id = await this.create(name);
        try {
            const store = this.store(id);
            await store.load(false);
            const res = await store.call({ type: 'home3d/backup/import', ...backup });
            return { id, skipped: res.skipped ?? [] };
        } catch (e) {
            await this.remove(id).catch(() => {});
            throw e;
        }
    }

    /**
     * Before there were project folders, the one project lay at the root of home3d.0 (`data.json`, `images/` …) and
     * floor plan exports in `projects/`: they move to `default/` and `exports/`, once. Returns whether there was
     * anything to move.
     */
    async adoptRoot(): Promise<boolean> {
        const root = await this.storage.list('');
        const has = (file: string, isDir: boolean): boolean => root.some(e => e.file === file && e.isDir === isDir);
        const moves: [string, string][] = [];
        const filesOf = async (dir: string): Promise<string[]> =>
            has(dir, true) ? (await this.storage.list(dir)).filter(e => !e.isDir).map(e => e.file) : [];
        // the root's data.json only while the default project has none of its own
        if (has(DATA_FILE, false) && !(await this.storage.readText(`${DEFAULT_PROJECT}/${DATA_FILE}`))) {
            for (const dir of PROJECT_DIRS) {
                for (const file of await filesOf(dir)) {
                    moves.push([`${dir}/${file}`, `${DEFAULT_PROJECT}/${dir}/${file}`]);
                }
            }
            // last: the default project is complete once its data.json is there
            moves.push([DATA_FILE, `${DEFAULT_PROJECT}/${DATA_FILE}`]);
        }
        // not when `projects` is a project of its own now (one named "Projects")
        const exported = await filesOf('projects');
        if (!exported.includes(DATA_FILE)) {
            for (const file of exported.filter(f => /\.json$/i.test(f))) {
                moves.unshift([`projects/${file}`, `${EXPORTS_FOLDER}/${file}`]);
            }
        }
        for (const [from, to] of moves) {
            await this.storage.move(from, to);
        }
        return moves.length > 0;
    }
}
