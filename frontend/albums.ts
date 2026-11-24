// The albums of the adapter screensaver (ioBroker.screensaver) as pictures of the 3D view: a wall picture or a TV that
// is off shows the album as a slide show. The adapter keeps the albums (folders of the ioBroker files or of the server,
// Immich, Google Photos) and answers `sendTo`: `getAlbums` → `[{ value, label }]`, `list { album, limit }` →
// `{ pictures: [{ k }] }`, `picture { album, key, width, height }` → `{ url }`, a reduced copy in its file storage
// (`screensaver.0/cache/…`), served by web one level above this page. The picture shown changes every
// `ALBUM_STEP_MS`, by the clock: every screen and every browser shows the same picture at the same time.

/** How long a picture of an album stays. */
export const ALBUM_STEP_MS = 15_000;
/** The list of an album is asked again after this time (new pictures, the date filter of a new day). */
const LIST_MS = 15 * 60_000;
/** The size the adapter reduces a picture to: a screen in 3D needs no more. */
const WIDTH = 1280;
const HEIGHT = 960;
/** At most this many pictures per album; the adapter takes a sample of the day when there are more. */
const LIMIT = 500;

export interface AlbumAccess {
    /** The enabled instances of the adapter screensaver (`screensaver.0` …). */
    instances(): Promise<string[]>;
    /** `sendTo`; null when the instance does not answer in time. */
    sendTo<T>(instance: string, command: string, message: unknown): Promise<T | null>;
}

export interface AlbumOption {
    /** `<instance>/<album>`, e.g. `screensaver.0/family` */
    id: string;
    label: string;
}

interface Listed {
    at: number;
    keys: string[];
}

/** An album's id split into its instance and the album of that instance; null: not one. */
export function splitAlbum(id: string): { instance: string; album: string } | null {
    const m = /^(screensaver\.\d+)\/([\w-]+)$/.exec(id.trim());
    return m ? { instance: m[1], album: m[2] } : null;
}

/** A path of the adapter's file storage as a URL relative to this page (`/home3d/index.html`). */
export function storageUrl(path: string): string {
    return /^(?:https?:|data:|blob:)/i.test(path) ? path : `../${path.replace(/^\/+/, '')}`;
}

/** Which of `n` pictures shows at a time, and how long until the next one. */
export function albumStep(n: number, now: number): { index: number; wait: number } {
    const step = Math.floor(now / ALBUM_STEP_MS);
    return { index: n > 0 ? step % n : 0, wait: ALBUM_STEP_MS - (now % ALBUM_STEP_MS) };
}

export class Albums {
    private lists = new Map<string, Listed>();
    private listing = new Map<string, Promise<string[]>>();
    private urls = new Map<string, string>();

    constructor(
        private readonly access: AlbumAccess,
        private readonly now: () => number = () => Date.now(),
    ) {}

    /** The albums of all instances, for the editor. */
    async list(): Promise<{ albums: AlbumOption[] }> {
        const instances = await this.access.instances().catch(() => []);
        const answers = await Promise.all(
            instances.map(async instance => {
                const options = await this.access
                    .sendTo<{ value?: unknown; label?: unknown }[]>(instance, 'getAlbums', {})
                    .catch(() => null);
                return (Array.isArray(options) ? options : [])
                    .filter(o => typeof o?.value === 'string' && /^[\w-]+$/.test(o.value))
                    .map(o => ({
                        id: `${instance}/${o.value as string}`,
                        label:
                            instances.length > 1
                                ? `${String(o.label ?? o.value)} (${instance})`
                                : String(o.label ?? o.value),
                    }));
            }),
        );
        return { albums: answers.flat() };
    }

    /** The picture an album shows now and the milliseconds until the next; url null: none (yet). */
    async current(id: string): Promise<{ url: string | null; wait: number }> {
        const now = this.now();
        const target = splitAlbum(id);
        if (!target) {
            return { url: null, wait: ALBUM_STEP_MS };
        }
        const keys = await this.keys(id, target.instance, target.album);
        const { index, wait } = albumStep(keys.length, now);
        if (!keys.length) {
            return { url: null, wait };
        }
        const key = keys[index];
        const cached = this.urls.get(`${id}\n${key}`);
        if (cached) {
            return { url: cached, wait };
        }
        const answer = await this.access
            .sendTo<{ url?: unknown }>(target.instance, 'picture', {
                album: target.album,
                key,
                width: WIDTH,
                height: HEIGHT,
            })
            .catch(() => null);
        if (typeof answer?.url !== 'string' || !answer.url) {
            return { url: null, wait };
        }
        const url = storageUrl(answer.url);
        // the copies stay in the adapter's cache; only the paths are kept here, a few hundred at most
        if (this.urls.size > 1000) {
            this.urls.clear();
        }
        this.urls.set(`${id}\n${key}`, url);
        return { url, wait };
    }

    private async keys(id: string, instance: string, album: string): Promise<string[]> {
        const have = this.lists.get(id);
        if (have && this.now() - have.at < LIST_MS) {
            return have.keys;
        }
        let job = this.listing.get(id);
        if (!job) {
            job = this.access
                .sendTo<{ pictures?: { k?: unknown }[] }>(instance, 'list', { album, limit: LIMIT })
                .catch(() => null)
                .then(answer => {
                    const keys = (answer?.pictures ?? [])
                        .map(p => p?.k)
                        .filter((k): k is string => typeof k === 'string' && !!k);
                    // without an answer the old list stays and is asked again in a minute
                    this.lists.set(
                        id,
                        answer?.pictures
                            ? { at: this.now(), keys }
                            : { at: this.now() - LIST_MS + 60_000, keys: have?.keys ?? [] },
                    );
                    return this.lists.get(id)!.keys;
                })
                .finally(() => this.listing.delete(id));
            this.listing.set(id, job);
        }
        return job;
    }
}
