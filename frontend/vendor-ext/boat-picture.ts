// The pictures of a boat's anchor and gear in the editor's furniture library. The viewer draws them itself, not as
// furniture (anchor.ts, boat-gear.ts), so the library's picture (viewer/preview.ts, patched in `boatPictures` of
// tasks.ts) is built the same way: the anchor stowed in its roller, a tank half full of fresh water, the rudder
// straight, the propeller, a lit bicolour light (red and green), a closed hatch.
import type { Group } from 'three';
import { buildAnchor, disposeAnchor } from './anchor';
import { buildGear, disposeGear } from './boat-gear';
import { isGear } from './boat-kinds';

/** The model for the picture of a boat's item; null: not one of them. */
export function boatPicture(type: string, w: number, d: number, h: number, variant: string | null): Group | null {
    if (type === 'anchor') {
        return buildAnchor(
            {
                id: 'picture',
                floor: '',
                x: 0,
                z: 0,
                rotation: 0,
                length: d,
                chain: null,
                depth: null,
                distance: null,
                radius: null,
                alarm: false,
                label: '',
            },
            { deckY: 0, waterY: -1, light: false },
        );
    }
    if (!isGear(type)) {
        return null;
    }
    return buildGear(
        {
            id: 'picture',
            floor: '',
            type,
            x: 0,
            z: 0,
            rotation: 0,
            w,
            d,
            h,
            base: 0,
            variant: variant ?? (type === 'nav_light' ? 'bicolor' : null),
            value: type === 'tank' ? 0.6 : type === 'nav_light' ? 1 : 0,
            label: '',
            warn: false,
            mast: false,
        },
        { floorY: 0, waterY: null, light: false, night: 0 },
    );
}

/** Frees the model of a picture (the geometry all sprites share stays). */
export function disposeBoatPicture(group: Group): void {
    if (group.userData.fp3dAnchor !== undefined) {
        disposeAnchor(group);
    } else {
        disposeGear(group);
    }
}
