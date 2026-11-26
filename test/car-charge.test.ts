import assert from 'node:assert/strict';
import test from 'node:test';
import type { MeshBasicMaterial } from 'three';
import {
    buildCable,
    cablePath,
    CABLE_REACH,
    carCharges,
    PLUGGED_PHASES,
    portColor,
    portPulse,
    wallboxOutlet,
    type CarSpot,
    type WallboxSpot,
} from '../frontend/vendor-ext/car-charge';
import { chargePort } from '../frontend/vendor-ext/cars';
import { MeterFlow } from '../frontend/vendor-ext/home-data';
import { homeScene, homeWatched, type BuildingLike, type HomeInput } from '../frontend/vendor-ext/home-view';

const near = (a: number, b: number, eps = 0.01): void => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

// a hatchback turned round (its nose to the garage door in the south) and a wallbox on the west wall beside its rear
const yellow: CarSpot = {
    id: 'yellow',
    floor: 'garage',
    kind: 'car_hatchback',
    x: 17.4,
    z: 12.25,
    y: 0,
    angle: Math.PI,
    w: 1.9,
    d: 4,
    h: 1.5,
};
const wallbox = { type: 'wallbox', x: 15.735, z: 10.9, w: 0.3, d: 0.15, h: 0.42, rotation: 270 };

test('a wallbox hangs its cable out under its box, at its front', () => {
    const [x, y, z] = wallboxOutlet(wallbox);
    near(x, 15.785);
    near(y, 0.615);
    near(z, 10.9);
    // mounted higher, the cable hangs higher
    near(wallboxOutlet({ ...wallbox, mount_y: 1.2 })[1], 0.815);
    // facing south (rotation 0: its front is +z)
    const south = wallboxOutlet({ ...wallbox, rotation: 0 });
    near(south[0], 15.735);
    near(south[2], 10.95);
});

test('a car charges at the flank facing the wallbox, above the nearer wheel', () => {
    const [x, y, z] = chargePort('car_hatchback', 1.9, 4, 1.5, 1, false);
    near(x, 0.954);
    assert.ok(y > 0.75 && y < 0.86, `port at ${y} m`);
    near(z, 1.32);
    assert.ok(chargePort('car_hatchback', 1.9, 4, 1.5, -1, true)[2] < 0);
    const { path, port, normal } = cablePath(yellow, wallboxOutlet(wallbox));
    // the yellow car's west flank, by its rear (north) wheel
    near(port[0], 16.446);
    near(port[2], 10.93);
    near(normal[0], -1);
    near(normal[1], 0);
    // from the holster to the port, hanging below both, never through the floor
    assert.deepEqual(path[0], wallboxOutlet(wallbox));
    assert.deepEqual(path[path.length - 1], port);
    const low = Math.min(...path.map(p => p[1]));
    assert.ok(low < 0.615 && low >= 0.03, `lowest ${low}`);
});

test('a cable from a wallbox behind the car runs round its corner, not through it', () => {
    // a car parked along x (rotation 90: its rear at -x), the wallbox on the wall right behind it
    const car: CarSpot = { ...yellow, x: 5, z: 5, angle: Math.PI / 2 };
    const { path } = cablePath(car, [2.6, 0.6, 5.1]);
    for (const [x, , z] of path) {
        // in the car's frame: x across, z along it
        const lx = (x - 5) * Math.cos(car.angle) + (z - 5) * Math.sin(car.angle);
        const lz = -(x - 5) * Math.sin(car.angle) + (z - 5) * Math.cos(car.angle);
        assert.ok(!(Math.abs(lx) < car.w / 2 - 0.02 && Math.abs(lz) < car.d / 2 - 0.02), `${x},${z} inside the car`);
    }
});

test('every car hangs on the nearest wallbox within reach, every wallbox on one car', () => {
    const box = (id: string, at: [number, number, number], floor = 'garage'): WallboxSpot => ({
        id,
        floor,
        at,
        phase: 'charging',
    });
    const van: CarSpot = { ...yellow, id: 'van', kind: 'car_van', x: 20.125, z: 11.9, w: 1.95, d: 4.65, h: 1.45 };
    const one = carCharges([van, yellow], [box('wb', wallboxOutlet(wallbox))]);
    assert.deepEqual([...one.keys()], ['yellow']);
    assert.equal(one.get('yellow')!.box, 'wb');
    assert.equal(one.get('yellow')!.phase, 'charging');
    // with the yellow car away the van is the one near it
    assert.equal(carCharges([van], [box('wb', wallboxOutlet(wallbox))]).get('van')?.box, 'wb');
    // a second wallbox on the east wall for the van
    const two = carCharges([yellow, van], [box('wb', wallboxOutlet(wallbox)), box('east', [21.4, 0.6, 10.6])]);
    assert.equal(two.get('yellow')!.box, 'wb');
    assert.equal(two.get('van')!.box, 'east');
    // too far, or on another floor
    assert.equal(carCharges([yellow], [box('far', [17.4 - 1 - CABLE_REACH, 0.6, 10.9])]).size, 0);
    assert.equal(carCharges([yellow], [box('up', wallboxOutlet(wallbox), 'eg')]).size, 0);
});

test('the port ring shows what the wallbox says', () => {
    assert.ok(PLUGGED_PHASES.has('charging') && PLUGGED_PHASES.has('plugged') && PLUGGED_PHASES.has('full'));
    assert.ok(!PLUGGED_PHASES.has('free') && !PLUGGED_PHASES.has('unknown'));
    assert.equal(portColor('charging'), 0x4cd97b);
    assert.equal(portColor('plugged'), 0xffd166);
    assert.equal(portColor('error'), 0xff5d5d);
    for (let t = 0; t < 2; t += 0.1) {
        assert.ok(portPulse(t) >= 0.45 && portPulse(t) <= 1);
    }
    const [charge] = carCharges([yellow], [{ id: 'wb', floor: 'garage', at: wallboxOutlet(wallbox), phase: 'plugged' }]).values();
    const parts = buildCable(charge);
    assert.equal(parts.group.visible, false);
    assert.equal(parts.pulses.length, 3);
    assert.equal((parts.ring.material as MeshBasicMaterial).color.getHex(), 0xffd166);
    near(parts.curve.getPointAt(1).x, charge.port[0]);
});

const square = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
];
const st = (state: string, attributes: Record<string, unknown> = {}): { state: string; attributes: Record<string, unknown> } => ({
    state,
    attributes,
});

test('home: a parked car hangs on its wallbox by the wallbox status and power (openWB)', () => {
    const b: BuildingLike = {
        settings: {},
        floors: [
            {
                id: 'garage',
                elevation: -0.98,
                height: 2.5,
                rooms: [{ id: 'g', name: 'Garage', area_id: null, points: square(15.6, 4.5, 21.5, 14.7) }],
                openings: [],
                furniture: [
                    {
                        id: 'yellow',
                        type: 'car_hatchback',
                        x: 17.4,
                        z: 12.25,
                        w: 1.9,
                        d: 4,
                        h: 1.5,
                        rotation: 180,
                        entity: 'binary_sensor.plug',
                    },
                    {
                        id: 'wb',
                        type: 'wallbox',
                        x: 15.735,
                        z: 10.9,
                        w: 0.3,
                        d: 0.15,
                        h: 0.42,
                        rotation: 270,
                        power: 'sensor.wb_power',
                        status: 'binary_sensor.plug',
                    },
                ],
            },
        ],
    };
    const scene = (states: Record<string, ReturnType<typeof st>>): ReturnType<typeof homeScene>['scene'] => {
        const input: HomeInput = {
            hass: { states },
            building: b,
            now: Date.parse('2026-11-26T09:00:00Z'),
            t: k => k,
            areaEntities: () => [],
            climate: () => ({ t: null, rh: null }),
            openings: new Map(),
            contacts: new Map(),
            markers: [],
            wind: null,
            tOut: null,
            leaks: [],
            priceHistory: [],
            health: false,
            meter: new MeterFlow(),
            fmt: (n, d) => n.toFixed(d),
            time: ms => new Date(ms).toISOString().slice(11, 16),
        };
        return homeScene(input).scene;
    };
    const plug = { attributes: {} };
    const power = { unit_of_measurement: 'W', device_class: 'power' };
    const charging = scene({ 'binary_sensor.plug': { state: 'on', ...plug }, 'sensor.wb_power': st('9700', power) });
    assert.equal(charging.cars[0].charge?.box, 'wb');
    assert.equal(charging.cars[0].charge?.phase, 'charging');
    const waiting = scene({ 'binary_sensor.plug': { state: 'on', ...plug }, 'sensor.wb_power': st('0', power) });
    assert.equal(waiting.cars[0].charge?.phase, 'plugged');
    // unplugged: its presence (the plug state here) takes the car away, and no cable hangs
    const away = scene({ 'binary_sensor.plug': { state: 'off', ...plug }, 'sensor.wb_power': st('0', power) });
    assert.equal(away.cars[0].present, false);
    assert.equal(away.cars[0].charge, null);
    const watched = homeWatched(
        { states: { 'binary_sensor.plug': st('on'), 'sensor.wb_power': st('0', power) } },
        b,
        () => [],
        false,
    );
    assert.ok(watched.includes('binary_sensor.plug') && watched.includes('sensor.wb_power'));
});
