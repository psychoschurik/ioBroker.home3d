// The undo history of the editor, kept outside the editor element (tasks.ts patches components/editor.ts): the panel
// creates a new editor each time the 3D view is left for the editor, and the history of the old one would be lost.
// One history per floor plan, for as long as the page is open.

/** The states before each change (JSON of the building) and the undone ones that can be redone. */
export interface UndoHistory {
    past: string[];
    future: string[];
}

const kept = new Map<string, UndoHistory>();

/** Keeps the history of a plan when its editor goes away or shows another plan. */
export function keepUndo(plan: string | null | undefined, history: UndoHistory): void {
    const key = plan ?? '';
    if (history.past.length || history.future.length) {
        kept.set(key, { past: history.past, future: history.future });
    } else {
        kept.delete(key);
    }
}

/** The kept history of a plan (empty if there is none). */
export function takeUndo(plan: string | null | undefined): UndoHistory {
    return kept.get(plan ?? '') ?? { past: [], future: [] };
}
