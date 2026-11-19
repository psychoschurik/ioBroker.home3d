// An air vent of a ventilation (home-view.ts, home-fx.ts): a disc valve under the ceiling or a grille on the wall; while
// its fan runs, fresh air streams out of a supply vent and used air is drawn into an exhaust vent, thicker and faster
// the higher its stage.
import type { Object3D } from 'three';
import { BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, TorusGeometry } from 'three';
import { shade } from './anchor';

/** Width, depth, height (m) by mounting: a disc valve under the ceiling, a grille on the wall. */
export const VENT_SIZE: Record<'' | 'wall', [number, number, number]> = {
    '': [0.2, 0.2, 0.05],
    wall: [0.3, 0.04, 0.15],
};

/** How high a wall vent hangs by default (its bottom, m). */
export const VENT_WALL_Y = 2.0;

/** Supply: fresh air out of it; exhaust: used air into it. */
export type VentFlow = 'supply' | 'exhaust';

/** The flow of a vent from its setting: exhaust by name, else supply. */
export function ventFlow(v: string | null | undefined): VentFlow {
    return v === 'exhaust' ? 'exhaust' : 'supply';
}

/** Where a vent's bottom hangs: a wall vent at 2 m, a ceiling vent under the ceiling (`ceiling`: the room's height). */
export function ventBase(wall: boolean, ceiling: number, h: number): number {
    return wall ? VENT_WALL_Y : Math.max(0, Math.round((ceiling - h) * 1000) / 1000);
}

const DEAD = /^(unavailable|unknown|)$/i;
const OFF = /^(off|false|aus|closed|stop|stopped|idle|standby)$/i;
const NAMED: [RegExp, number][] = [
    [/boost|max|party|intens|turbo|stoß/i, 1],
    [/high|hoch|stufe ?3|level ?3/i, 0.85],
    [/medium|mittel|normal|nenn|stufe ?2|level ?2|^(auto|an|running|läuft)$/i, 0.6],
    [/low|niedrig|eco|feuchte|minimal|stufe ?1|level ?1|night|nacht|away|abwesend/i, 0.35],
];

/**
 * How hard the fan of a vent runs, 0 (still) … 1 (full): a fan by its percentage, a power reading (W, kW: from 2 W), a
 * level in %, an air volume (m³/h, full at 250), a speed (rpm, full at 2500), a stage (up to 4: of 4, up to 10: of
 * 10, else %), or a mode by its name (low, medium, high, boost …). Running counts at least 0.15.
 */
export function ventRate(st: { state: string; attributes: Record<string, unknown> } | null | undefined): number {
    if (!st) {
        return 0;
    }
    const raw = String(st.state ?? '').trim();
    if (DEAD.test(raw) || OFF.test(raw)) {
        return 0;
    }
    const clamp = (k: number): number => (k > 0 ? Math.max(0.15, Math.min(1, k)) : 0);
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n)) {
        // a fan that is on: its percentage, else full; a mode by its name
        if (/^(on|true)$/i.test(raw)) {
            const p = Number(st.attributes.percentage);
            return Number.isFinite(p) && p > 0 ? clamp(p / 100) : 1;
        }
        return NAMED.find(([re]) => re.test(raw))?.[1] ?? 0;
    }
    const u = st.attributes.unit_of_measurement;
    const unit = typeof u === 'string' ? u.trim() : '';
    if (/^k?W$/i.test(unit) || st.attributes.device_class === 'power') {
        const w = /^kW$/i.test(unit) ? n * 1000 : n;
        return w >= 2 ? clamp(0.25 + w / 80) : 0;
    }
    if (unit === '%') {
        return clamp(n / 100);
    }
    if (/^m(³|3)\/h$/i.test(unit)) {
        return clamp(n / 250);
    }
    if (/^(rpm|u\/min|1\/min)$/i.test(unit)) {
        return clamp(n / 2500);
    }
    return clamp(n <= 4 ? n / 4 : n <= 10 ? n / 10 : n / 100);
}

/** The colour of the air: fresh air light blue, used air warm grey. */
export function ventColor(flow: VentFlow, light: boolean): [number, number, number] {
    if (flow === 'supply') {
        return light ? [0.05, 0.42, 0.92] : [0.66, 0.9, 1];
    }
    return light ? [0.42, 0.36, 0.3] : [0.86, 0.8, 0.72];
}

function part(g: Object3D, geo: CylinderGeometry | BoxGeometry | TorusGeometry, color: number): Mesh {
    const m = new Mesh(shade(geo, new Color(color)), new MeshBasicMaterial({ vertexColors: true }));
    g.add(m);
    return m;
}

/**
 * A vent with its bottom at the origin. Under the ceiling: a disc valve, its collar at the top, the plate hanging below
 * it with a dark gap; the air leaves at the bottom. On the wall: a frame with slats, its front at +z, the air leaves
 * at the front. A blue ring (supply) or a grey one (exhaust) tells which it is.
 */
export function buildAirVent(w: number, d: number, h: number, wall: boolean, flow: VentFlow, light = true): Group {
    const g = new Group();
    g.name = 'fp3dAirVent';
    const white = light ? 0xf1f3f5 : 0xaeb7c0;
    const dark = light ? 0x2a2f35 : 0x161a1f;
    const mark = flow === 'supply' ? 0x3d9be9 : 0x8a7f74;
    if (wall) {
        part(g, new BoxGeometry(w, h, d * 0.5), dark).position.set(0, h / 2, -d * 0.25);
        const t = Math.min(0.025, w * 0.08);
        for (const [x, y, bw, bh] of [
            [0, h - t / 2, w, t],
            [0, t / 2, w, t],
            [-(w - t) / 2, h / 2, t, h],
            [(w - t) / 2, h / 2, t, h],
        ]) {
            part(g, new BoxGeometry(bw, bh, d), white).position.set(x, y, 0);
        }
        const slats = 4;
        for (let i = 1; i <= slats; i++) {
            const s = part(g, new BoxGeometry(w - 2 * t, t * 0.6, d * 0.7), white);
            s.position.set(0, t + ((h - 2 * t) * i) / (slats + 1), d * 0.1);
            s.rotation.x = flow === 'supply' ? 0.5 : -0.5;
        }
        part(g, new BoxGeometry(w * 0.3, t * 0.5, 0.004), mark).position.set(0, h - t / 2, d / 2 + 0.002);
        return g;
    }
    const r = Math.min(w, d) / 2;
    // the collar against the ceiling, the dark gap, the plate
    part(g, new CylinderGeometry(r, r, h * 0.35, 28), white).position.set(0, h * 0.825, 0);
    part(g, new CylinderGeometry(r * 0.78, r * 0.78, h * 0.35, 28), dark).position.set(0, h * 0.5, 0);
    part(g, new CylinderGeometry(r * 0.66, r * 0.66, h * 0.3, 28), white).position.set(0, h * 0.15, 0);
    part(g, new TorusGeometry(r * 0.4, Math.max(0.004, r * 0.04), 6, 28).rotateX(Math.PI / 2), mark).position.set(
        0,
        -0.002,
        0,
    );
    return g;
}
