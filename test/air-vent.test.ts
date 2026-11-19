import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAirVent, ventBase, ventColor, ventFlow, ventRate, VENT_WALL_Y } from '../frontend/vendor-ext/air-vent';
import { MeterFlow } from '../frontend/vendor-ext/home-data';
import { homeScene, homeWatched, type BuildingLike, type HomeInput } from '../frontend/vendor-ext/home-view';

const st = (state: string, attributes: Record<string, unknown> = {}): { state: string; attributes: Record<string, unknown> } => ({
    state,
    attributes,
});

test('a vent runs as hard as its fan: percentage, stage, power, air volume, speed, mode or switch', () => {
    assert.equal(ventRate(null), 0);
    assert.equal(ventRate(st('off')), 0);
    assert.equal(ventRate(st('unavailable')), 0);
    // a fan by its percentage, else full
    assert.equal(ventRate(st('on', { percentage: 40 })), 0.4);
    assert.equal(ventRate(st('on')), 1);
    // a stage up to 4 of 4, up to 10 of 10, else %
    assert.equal(ventRate(st('2')), 0.5);
    assert.equal(ventRate(st('0')), 0);
    assert.equal(ventRate(st('7')), 0.7);
    assert.equal(ventRate(st('60')), 0.6);
    assert.equal(ventRate(st('25', { unit_of_measurement: '%' })), 0.25);
    // power from 2 W, air volume full at 250 m³/h, a speed full at 2500 rpm
    assert.equal(ventRate(st('1', { unit_of_measurement: 'W' })), 0);
    assert.equal(ventRate(st('40', { unit_of_measurement: 'W' })), 0.75);
    assert.equal(ventRate(st('125', { unit_of_measurement: 'm³/h' })), 0.5);
    assert.equal(ventRate(st('1250', { unit_of_measurement: 'rpm' })), 0.5);
    // a little counts at least a little
    assert.equal(ventRate(st('3', { unit_of_measurement: '%' })), 0.15);
    // modes by name
    assert.equal(ventRate(st('Intensiv')), 1);
    assert.equal(ventRate(st('high')), 0.85);
    assert.equal(ventRate(st('Normal')), 0.6);
    assert.equal(ventRate(st('Eco')), 0.35);
    assert.equal(ventRate(st('Standby')), 0);
    assert.equal(ventRate(st('Wartung')), 0);
    assert.equal(ventFlow('exhaust'), 'exhaust');
    assert.equal(ventFlow(null), 'supply');
    assert.equal(ventBase(true, 2.6, 0.15), VENT_WALL_Y);
    assert.equal(ventBase(false, 2.6, 0.05), 2.55);
    assert.notDeepEqual(ventColor('supply', true), ventColor('exhaust', true));
    assert.ok(buildAirVent(0.2, 0.2, 0.05, false, 'supply').children.length > 2);
    assert.ok(buildAirVent(0.3, 0.04, 0.15, true, 'exhaust').children.length > 4);
});

const square = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
];

test('home: a vent hangs under its room ceiling or on the wall, its air by its fan', () => {
    const b: BuildingLike = {
        settings: {},
        floors: [
            {
                id: 'eg',
                elevation: 0,
                height: 2.6,
                rooms: [
                    { id: 'living', name: 'Wohnen', area_id: null, points: square(0, 0, 5, 4) },
                    { id: 'bath', name: 'Bad', area_id: null, points: square(5, 0, 8, 4), ceiling_height: 2.3 },
                ],
                openings: [],
                furniture: [
                    { id: 'in', type: 'air_vent', x: 2, z: 2, w: 0.2, d: 0.2, h: 0.05, rotation: 0, entity: 'fan.kwl' },
                    {
                        id: 'out',
                        type: 'air_vent',
                        x: 6,
                        z: 2,
                        w: 0.2,
                        d: 0.2,
                        h: 0.05,
                        rotation: 0,
                        entity: 'fan.kwl',
                        vent_flow: 'exhaust',
                    },
                    {
                        id: 'grille',
                        type: 'air_vent',
                        x: 7.9,
                        z: 1,
                        w: 0.3,
                        d: 0.04,
                        h: 0.15,
                        rotation: 90,
                        variant: 'wall',
                        entity: 'sensor.stage',
                    },
                ],
            },
        ],
    };
    const states = { 'fan.kwl': st('on', { percentage: 60 }), 'sensor.stage': st('0') };
    const input: HomeInput = {
        hass: { states },
        building: b,
        now: Date.parse('2026-11-19T12:00:00Z'),
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
    const vents = homeScene(input).scene.vents ?? [];
    const by = Object.fromEntries(vents.map(v => [v.id, v]));
    assert.equal(by.in.y, 2.55);
    assert.equal(by.in.flow, 'supply');
    assert.equal(by.in.rate, 0.6);
    // the bath's own ceiling
    assert.equal(by.out.y, 2.25);
    assert.equal(by.out.flow, 'exhaust');
    assert.equal(by.grille.wall, true);
    assert.equal(by.grille.y, VENT_WALL_Y);
    assert.equal(by.grille.rate, 0);
    const watched = homeWatched({ states }, b, () => [], false);
    assert.ok(watched.includes('fan.kwl') && watched.includes('sensor.stage'));
});
