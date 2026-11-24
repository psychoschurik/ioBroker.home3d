// A picture on the wall and pictures from ioBroker. The wall picture is a frame whose canvas is a screen: it shows what
// the screen's picture rules give it: a stored picture "always" (a rule without an entity), an album of the adapter
// screensaver as a slide show (`album:<instance>/<album>`, asked through the bridge, frontend/albums.ts) or the picture
// a datapoint holds (`state:<entity>`). A TV shows the same while it is off (a rule "off"). The wall picture comes as a
// pack built into this page (`home3d` in `packs/list` of the store), so the library, the 3D model and the plan symbol
// are those of any pack item. Patch `wallPicture` in tasks.ts.

/** The image of a picture rule taken from an entity's state: `state:<entity id>`. */
export const STATE_PICTURE = 'state:';

/** The image of a picture rule from an album of the adapter screensaver: `album:screensaver.0/<album>`. */
export const ALBUM_PICTURE = 'album:';

type Ask = (msg: { type: string; [key: string]: unknown }) => Promise<unknown>;

interface Shown {
    url: string | null;
    pending: boolean;
    /** When to ask for the next picture. */
    due: number;
    timer?: ReturnType<typeof setTimeout>;
}
const shown = new Map<string, Shown>();

/**
 * The picture an album shows now (null while it is asked for). When the next picture is due, `changed` is called: the
 * view draws again and asks once more. An album no screen shows any more is not asked again.
 */
export function albumPicture(ask: Ask, album: string, changed: () => void): string | null {
    let entry = shown.get(album);
    if (!entry) {
        entry = { url: null, pending: false, due: 0 };
        shown.set(album, entry);
    }
    const s = entry;
    if (!s.pending && Date.now() >= s.due) {
        s.pending = true;
        ask({ type: 'iobroker/album/current', album })
            .then(
                answer => {
                    const a = (answer ?? {}) as { url?: unknown; wait?: unknown };
                    const url = typeof a.url === 'string' && a.url ? a.url : null;
                    const wait = typeof a.wait === 'number' && a.wait > 0 ? a.wait : 15_000;
                    s.due = Date.now() + wait;
                    clearTimeout(s.timer);
                    s.timer = setTimeout(changed, wait + 50);
                    if (url !== s.url) {
                        s.url = url;
                        changed();
                    }
                },
                // the adapter does not answer: again in a minute
                () => (s.due = Date.now() + 60_000),
            )
            .finally(() => (s.pending = false));
    }
    return s.url;
}

let albumList: { id: string; label: string }[] | null = null;
let albumsAsked = 0;

/** The albums of the adapter screensaver, for the editor (asked once, again after a minute while there are none). */
export function albumOptions(ask: Ask, changed: () => void): { id: string; label: string }[] {
    if ((!albumList || !albumList.length) && Date.now() - albumsAsked > 60_000) {
        albumsAsked = Date.now();
        ask({ type: 'iobroker/albums/list' }).then(
            answer => {
                const list = (answer as { albums?: unknown } | null)?.albums;
                albumList = Array.isArray(list) ? (list as { id: string; label: string }[]) : [];
                if (albumList.length) {
                    changed();
                }
            },
            () => undefined,
        );
    }
    return albumList ?? [];
}

/** The id of the pack built into this page. */
export const BUILTIN_PACK = 'home3d';

const MIME: [RegExp, string][] = [
    [/^iVBOR/, 'image/png'],
    [/^R0lGOD/, 'image/gif'],
    [/^UklGR/, 'image/webp'],
    [/^PHN2Z|^PD94bW/, 'image/svg+xml'],
];

/**
 * The picture a datapoint's value stands for: a data URL or a URL as it is, base64 without its header (a slide show
 * gives the picture itself) as a data URL, a path of the ioBroker files (`/vis.0/slides/1.jpg`) relative to the web
 * adapter that serves this page under `/home3d/`; null: no picture (empty, a number, a word).
 */
export function pictureOfState(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const v = value.trim();
    if (!v || v === 'unavailable' || v === 'unknown') {
        return null;
    }
    if (/^data:image\//i.test(v) || /^(?:https?:)?\/\//i.test(v) || /^blob:/i.test(v)) {
        return v;
    }
    const compact = v.replace(/\s+/g, '');
    if (compact.length >= 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
        const mime = MIME.find(([re]) => re.test(compact))?.[1] ?? 'image/jpeg';
        return `data:${mime};base64,${compact}`;
    }
    // a file of ioBroker: below the root of web, one level above this page (behind a proxy too)
    if (/\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:[?#].*)?$/i.test(v) && !/\s/.test(v)) {
        return `..${v.startsWith('/') ? '' : '/'}${v}`;
    }
    return null;
}

interface Part {
    shape: 'box';
    x: number;
    z: number;
    w: number;
    d: number;
    y: number;
    h: number;
    color: string;
    screen?: boolean;
}

/** The frame round the canvas (bars `m` metres wide at the default size) and the canvas, recessed, as the screen. */
function framed(frame: string, canvas: string, m: number, w: number, h: number): Part[] {
    const bar = m / w;
    const by = m / h;
    return [
        { shape: 'box', x: 0, z: 0, w: 1, d: 1, y: 1 - by, h: by, color: frame },
        { shape: 'box', x: 0, z: 0, w: 1, d: 1, y: 0, h: by, color: frame },
        { shape: 'box', x: -0.5 + bar / 2, z: 0, w: bar, d: 1, y: by, h: 1 - 2 * by, color: frame },
        { shape: 'box', x: 0.5 - bar / 2, z: 0, w: bar, d: 1, y: by, h: 1 - 2 * by, color: frame },
        // the canvas a little behind the frame's face, its back against the wall
        { shape: 'box', x: 0, z: -0.15, w: 1 - 2 * bar, d: 0.7, y: by, h: 1 - 2 * by, color: canvas, screen: true },
    ];
}

const TAGS = [
    'bild',
    'wandbild',
    'gemälde',
    'bilderrahmen',
    'foto',
    'poster',
    'diashow',
    'picture',
    'painting',
    'frame',
    'photo',
    'slideshow',
    'картина',
    'рамка',
    'фото',
];

/** The pack built into this page: the wall picture in a wooden frame and as a digital photo frame. */
export const WALL_PICTURE_PACK = {
    id: BUILTIN_PACK,
    name: 'ioBroker',
    publisher: 'ioBroker',
    licensee: null,
    release: 1,
    instance: null,
    items: [
        {
            id: 'wall_picture',
            name: { de: 'Wandbild', en: 'Wall picture', ru: 'Картина' },
            size: [0.8, 0.03, 0.6] as [number, number, number],
            mount: 'wall' as const,
            wall_y: 1.2,
            // its links (and with them its picture rules): a picture from a datapoint, or one shown while a device is on
            electric: true,
            parts: framed('#6b4a2e', '#c8b48e', 0.045, 0.8, 0.6),
            symbol: [{ shape: 'rect' as const, x: 0, z: 0, w: 1, d: 1, fill: true }],
            group: 'deco',
            room: ['living', 'bedroom', 'hall', 'office', 'kids', 'dining'],
            tags: TAGS,
            family: 'wall_picture',
            variant: { de: 'Holzrahmen', en: 'Wooden frame', ru: 'Деревянная рамка' },
        },
        {
            id: 'photo_frame',
            name: { de: 'Digitaler Bilderrahmen', en: 'Digital photo frame', ru: 'Цифровая фоторамка' },
            size: [0.6, 0.03, 0.4] as [number, number, number],
            mount: 'wall' as const,
            wall_y: 1.3,
            electric: true,
            parts: framed('#1d1f22', '#2a3038', 0.025, 0.6, 0.4),
            symbol: [{ shape: 'rect' as const, x: 0, z: 0, w: 1, d: 1, fill: true }],
            group: 'deco',
            room: ['living', 'bedroom', 'hall', 'office', 'kitchen', 'dining'],
            tags: [...TAGS, 'digital', 'digitaler bilderrahmen'],
            family: 'wall_picture',
            variant: { de: 'Digital', en: 'Digital', ru: 'Цифровая' },
        },
    ],
};
