// How the glass cards over the devices show (menu "Anzeige", per browser in localStorage "home3d.holos"): always, only
// while the mouse is on a card's dot or on the card ("hover": the card's dot stays on the device; on a tablet a tap on
// the dot shows the card until the next tap), or not at all.

export type HoloMode = 'always' | 'hover' | 'off';

export const HOLO_MODES: readonly HoloMode[] = ['always', 'hover', 'off'];

/** The mode kept in localStorage: "1" always, "0" off, else (also nothing chosen yet) only on hover. */
export function holoModeOf(stored: string | null | undefined): HoloMode {
    return stored === '1' ? 'always' : stored === '0' ? 'off' : 'hover';
}

export function holoModeValue(mode: HoloMode): string {
    return mode === 'always' ? '1' : mode === 'off' ? '0' : 'hover';
}

/** What a card is, across updates (its place in the list changes): the module's card, the player, the car, else kind and name. */
export function holoKey(card: {
    kind: string;
    name?: string;
    module?: { id: string } | null;
    media?: { id: string } | null;
    car?: { spot: string } | null;
}): string {
    return card.module?.id ?? card.media?.id ?? card.car?.spot ?? `${card.kind}:${card.name ?? ''}`;
}

/** The cards shown in the mode "hover": while the pointer is on the dot or the card (a moment longer), or tapped. */
export class CardPeek {
    private readonly open = new Set<string>();
    private readonly pinned = new Set<string>();
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

    /** `changed`: the cards must be placed again. `linger`: ms a card stays after the pointer left (to reach it from its dot). */
    constructor(
        private readonly changed: () => void,
        private readonly linger = 700,
    ) {}

    enter(key: string): void {
        this.stop(key);
        if (!this.open.has(key)) {
            this.open.add(key);
            this.changed();
        }
    }

    leave(key: string): void {
        this.stop(key);
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                if (this.open.delete(key)) {
                    this.changed();
                }
            }, this.linger),
        );
    }

    /** A tap or click on the dot: the card stays until the next one. */
    tap(key: string): void {
        if (!this.pinned.delete(key)) {
            this.pinned.add(key);
        }
        this.changed();
    }

    shows(key: string): boolean {
        return this.open.has(key) || this.pinned.has(key);
    }

    clear(): void {
        for (const t of this.timers.values()) {
            clearTimeout(t);
        }
        this.timers.clear();
        this.open.clear();
        this.pinned.clear();
    }

    private stop(key: string): void {
        const t = this.timers.get(key);
        if (t !== undefined) {
            clearTimeout(t);
            this.timers.delete(key);
        }
    }
}
