// The flag of a mailbox (home-fx.ts): a red flag on an arm at the box's right side that swings up while post lies in
// it and folds back along the box once it is taken out. Every shape gets one; the US mailbox on a post had a fixed one.
import type { Object3D } from 'three';
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial } from 'three';
import { shade } from './anchor';

export const MAIL_SHAPES = ['wall', 'pole', 'pillar', 'parcel', 'bank'] as const;
export type MailShape = (typeof MAIL_SHAPES)[number];

export function mailShape(variant: string | null | undefined): MailShape {
    return (MAIL_SHAPES as readonly string[]).includes(variant ?? '') ? (variant as MailShape) : 'wall';
}

/** Height of a mailbox's bottom above the floor: a wall mailbox and a mailbox bank hang on the wall. */
export function mailBase(shape: MailShape): number {
    return shape === 'bank' ? 0.75 : shape === 'wall' ? 1.0 : 0;
}

/** Where the flag's arm turns (x at the right side, y, z) and how long it is, by shape. */
export function flagPivot(
    shape: MailShape,
    w: number,
    d: number,
    h: number,
): { x: number; y: number; z: number; len: number } {
    const x = w / 2 + 0.008;
    switch (shape) {
        case 'pole': {
            const boxH = Math.min(0.24, h * 0.22);
            return { x, y: h - boxH * 0.4, z: -d * 0.05, len: 0.18 };
        }
        case 'pillar': {
            const boxH = Math.min(0.4, h * 0.3);
            return { x, y: h - boxH * 0.6, z: 0, len: 0.2 };
        }
        case 'parcel':
            return { x, y: h * 0.62, z: 0, len: 0.22 };
        case 'bank':
            return { x, y: h * 0.5, z: 0, len: 0.2 };
        default:
            return { x, y: h * 0.2, z: 0, len: Math.max(0.12, Math.min(0.2, h * 0.55)) };
    }
}

/** The angle of the arm: 0 up, folded back along the box when down. */
export const FLAG_DOWN = -Math.PI / 2;

function part(g: Object3D, w: number, h: number, d: number, x: number, y: number, z: number, color: number): void {
    const mat = new MeshBasicMaterial({ vertexColors: true });
    g.add(new Mesh(shade(new BoxGeometry(w, h, d).translate(x, y, z), new Color(color)), mat));
}

/** The flag of a mailbox standing at the origin, its front at +z; `userData.arm` turns it (rotation.x, 0 = up). */
export function buildMailFlag(shape: MailShape, w: number, d: number, h: number, light = true): Group {
    const g = new Group();
    g.name = 'fp3dMailFlag';
    const p = flagPivot(shape, w, d, h);
    const arm = new Group();
    arm.position.set(p.x, p.y, p.z);
    const red = light ? 0xc62828 : 0xff4a4a;
    part(arm, 0.012, p.len, 0.012, 0.004, p.len / 2, 0, light ? 0x8a1c1c : 0xd84040);
    part(arm, 0.008, 0.07, 0.11, 0.006, p.len - 0.035, -0.055, red);
    // the bolt it turns on
    part(g, 0.016, 0.03, 0.03, p.x, p.y, p.z, light ? 0x5c636b : 0x8a96a2);
    arm.rotation.x = FLAG_DOWN;
    g.add(arm);
    g.userData.arm = arm;
    return g;
}
