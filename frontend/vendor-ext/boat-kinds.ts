// What a boat's gear can be (furniture types added in tasks.ts), shared by the editor, the 3D view and the viewer
// (boat-gear.ts); without three.js, so the editor can import it.

export const GEAR_TYPES = ['tank', 'rudder', 'propeller', 'nav_light', 'hatch'] as const;
export type GearType = (typeof GEAR_TYPES)[number];

/** What a tank holds: fresh water, diesel or petrol, gas, grey water, black water; in a house heating oil. */
export const TANK_KINDS = ['water', 'fuel', 'gas', 'grey', 'black', 'oil'] as const;
/** Navigation lights: all-round white at the masthead, the steaming light on the mast, port, starboard, bicolour at the bow, the stern light. */
export const LIGHT_KINDS = ['anchor', 'steaming', 'port', 'starboard', 'bicolor', 'stern'] as const;

export function isGear(type: string): type is GearType {
    return (GEAR_TYPES as readonly string[]).includes(type);
}

/** The height of a light above its floor unless set (m): the anchor light at a masthead, the steaming light halfway up. */
export function defaultLightY(kind: string | null | undefined): number {
    return kind === 'anchor' ? 18 : kind === 'steaming' ? 9 : 0.6;
}

/** A tank's fill (0–1) worth a warning: supplies running out, a holding tank nearly full. */
export function tankWarn(kind: string | null | undefined, fill: number): boolean {
    return kind === 'grey' || kind === 'black' ? fill >= 0.85 : fill <= 0.15;
}

/** A tank's fill (0–1) from its sensor: in % (the unit says so, or the value is above 1) or as a fraction. */
export function tankFill(value: number, unit: string): number {
    return Math.min(1, Math.max(0, unit === '%' || value > 1.0001 ? value / 100 : value));
}

/** A deck hatch: square with rounded corners, or round. */
export const HATCH_KINDS = ['square', 'round'] as const;
/** How far a hatch opens unless set (°). */
export const HATCH_ANGLE = 70;

/** A hatch's contact as open (1) or shut (0): on, open, true, offen, a number above 0. */
export function hatchOpen(state: string | null | undefined): number {
    const s = String(state ?? '')
        .trim()
        .toLowerCase();
    return ['on', 'open', 'opened', 'true', 'offen', 'auf', 'geöffnet'].includes(s) || parseFloat(s) > 0 ? 1 : 0;
}

/** The most a hatch opens (°). */
export const HATCH_MAX = 110;

/**
 * How a hatch stands: from its contact's state (open/shut; null: no contact or no state yet) and the angle a datapoint
 * gives (° or %, % up to the opening angle `fixed`; null: none). The lid stands at the datapoint's angle, else at
 * `fixed`. Without a contact the hatch counts as open from 1°. Null: neither is known.
 */
export function hatchPose(
    contact: string | null,
    angle: { n: number; unit?: string } | null,
    fixed: number = HATCH_ANGLE,
): { open: number; angle: number; measured: boolean } | null {
    const deg =
        angle && Number.isFinite(angle.n)
            ? angle.unit?.trim() === '%'
                ? (Math.min(100, Math.max(0, angle.n)) / 100) * fixed
                : Math.min(HATCH_MAX, Math.max(0, angle.n))
            : null;
    if (contact === null && deg === null) {
        return null;
    }
    const open = contact !== null ? hatchOpen(contact) : deg! >= 1 ? 1 : 0;
    return { open, angle: deg ?? fixed, measured: deg !== null };
}

/** A switch's state as on (1) or off (0). */
export function lightOn(state: string | null | undefined): number {
    const s = String(state ?? '').toLowerCase();
    return s === 'on' || s === 'true' || parseFloat(s) > 0 ? 1 : 0;
}
