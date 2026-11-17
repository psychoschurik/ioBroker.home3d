// What the editor showed when it was left for the 3D view, given back to the next editor of the same plan (tasks.ts
// patches components/editor.ts and components/library.ts): the panel creates a new editor each time, which would start
// on the first floor, fitted to the window, with nothing selected, another tool and the side bar scrolled to the top.

/** The editor's fields that make up what it shows: floor, selection, tool, zoom and pan, side bar, 3D pane, wall view. */
const EDITOR_FIELDS = [
    '_floorId',
    '_roomId',
    '_vertex',
    '_openingId',
    '_furnitureId',
    '_multi',
    '_single',
    '_multiMode',
    '_deviceId',
    '_deviceQuery',
    '_devSource',
    '_roofId',
    '_solarId',
    '_roofWinId',
    '_cableId',
    '_expanded',
    '_outdoorId',
    '_wallId',
    '_wallView',
    '_wallSel',
    '_wallMulti',
    '_wallSingle',
    '_wallCat',
    '_wallQuery',
    '_wallView3d',
    '_tool',
    '_split',
    '_splitRatio',
    '_wall3d',
    '_fx3d',
    '_style3d',
    '_sidePinned',
    '_sideMin',
    '_sideOpen',
    '_sideWidth',
    '_view',
    '_openingPreset',
    '_outdoorType',
    '_outdoorFree',
    '_poolShape',
    '_pipeId',
    '_techMode',
    '_bgOpen',
] as const;

/** The furniture library's search, filters, open sections and how far each section is unfolded. */
const LIBRARY_FIELDS = [
    '_query',
    '_room',
    '_electric',
    '_light',
    '_outdoor',
    '_open',
    '_limits',
    'roomTouched',
] as const;

type Bag = Record<string, unknown>;

interface KeptEditor {
    fields: Bag;
    /** The scroll positions of the side bars (in document order). */
    scroll: number[];
}

const editors = new Map<string, KeptEditor>();
let library: Bag | null = null;

/** A copy that the next editor can change without changing the kept one. */
function copy(v: unknown): unknown {
    if (v instanceof Set) {
        return new Set(v);
    }
    if (v instanceof Map) {
        return new Map(v);
    }
    if (Array.isArray(v)) {
        return [...v];
    }
    if (v && typeof v === 'object') {
        return { ...v };
    }
    return v;
}

function pick(from: object, names: readonly string[]): Bag {
    const bag = from as Bag;
    const out: Bag = {};
    for (const k of names) {
        if (k in bag) {
            out[k] = copy(bag[k]);
        }
    }
    return out;
}

function put(to: object, fields: Bag): void {
    const bag = to as Bag;
    for (const [k, v] of Object.entries(fields)) {
        bag[k] = copy(v);
    }
}

/**
 * Keeps what an editor shows when it goes away. `moved`: the plan was zoomed or panned since it was fitted (else the
 * next editor fits it to its own size again).
 */
export function keepEditor(el: object, plan: string | null | undefined, scroll: number[], moved: boolean): void {
    const fields = pick(el, EDITOR_FIELDS);
    if (!moved) {
        delete fields._view;
    }
    editors.set(plan ?? '', { fields, scroll: [...scroll] });
}

/** Gives a new editor of a plan what the last one showed; returns its side bars' scroll positions and whether the zoom came along. */
export function takeEditor(el: object, plan: string | null | undefined): { scroll: number[]; view: boolean } | null {
    const kept = editors.get(plan ?? '');
    if (!kept) {
        return null;
    }
    put(el, kept.fields);
    return { scroll: kept.scroll, view: '_view' in kept.fields };
}

/** Keeps the library's search and sections when it goes away (with the editor, or for another tool). */
export function keepLibrary(el: object): void {
    library = pick(el, LIBRARY_FIELDS);
}

/** Gives a new library what the last one showed. */
export function takeLibrary(el: object): void {
    if (library) {
        put(el, library);
    }
}

/**
 * Scrolls side bars back to where they were; again a little later while their content still grows (pictures of the
 * library coming in), until the user scrolls or presses a key.
 */
export function restoreScroll(root: ParentNode & EventTarget, selector: string, scroll: number[]): void {
    if (!scroll.some(v => v > 0)) {
        return;
    }
    let stopped = false;
    const stop = (): void => {
        stopped = true;
    };
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) {
        root.addEventListener(type, stop, { once: true, capture: true });
    }
    let tries = 0;
    const apply = (): void => {
        if (stopped) {
            return;
        }
        let done = true;
        root.querySelectorAll<HTMLElement>(selector).forEach((el, i) => {
            const want = scroll[i] ?? 0;
            if (want > 0 && Math.abs(el.scrollTop - want) > 1) {
                el.scrollTop = want;
                done &&= Math.abs(el.scrollTop - want) <= 1;
            }
        });
        if (!done && ++tries < 8) {
            setTimeout(apply, 120 * tries);
        }
    };
    requestAnimationFrame(apply);
}
