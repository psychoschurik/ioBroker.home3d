import assert from 'node:assert/strict';
import test from 'node:test';
import { railSpans, type RailArea, type RailFloor, type RailModel } from '../frontend/vendor-ext/rail-spans';

// flat areas: the top is the area's offset (floor coordinates), a "bank" falls by 3 m along +z from z = 9.5 to 12.5
const model: RailModel = {
    topAt: (_fl, o, _x, z) => {
        const a = o as RailArea & { offset?: number; bank?: boolean };
        const top = a.offset ?? 0;
        return a.bank ? top - Math.min(3, Math.max(0, z - 9.5)) : top;
    },
    standing: type => type === 'hedge' || type === 'fence' || type === 'pergola',
};

const rect = (x0: number, z0: number, x1: number, z1: number): [number, number][] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
];

function house(): { lower: RailFloor; upper: RailFloor; deck: RailArea } {
    const deck: RailArea = { id: 'deck', type: 'balcony', points: rect(-1, 3, 4, 11) };
    const lower: RailFloor = {
        id: 'eg',
        elevation: 0,
        rooms: [],
        // the garden on the hill west of the house, at the level of the upper floor (2.8 m)
        outdoor: [{ id: 'hill', type: 'lawn', points: rect(-10, 0, -1, 9.5), offset: 2.8 } as RailArea],
    };
    const upper: RailFloor = { id: 'og', elevation: 2.8, rooms: [{ points: rect(4, 0, 12, 11) }], outdoor: [deck] };
    return { lower, upper, deck };
}

test('rail spans: no railing where the garden on the hill reaches up to the deck', () => {
    const { lower, upper, deck } = house();
    const floors = [lower, upper];
    // west edge (x = -1), from z 3 to 9.5 the hill lies at the deck's level, below that there is nothing
    const west = railSpans(upper, deck, [-1, 11], [-1, 3], 0, model, floors);
    assert.equal(west.length, 1);
    const [t0, t1] = west[0];
    assert.equal(t0, 0);
    // the railing runs from z 11 up to about z 9.5 (fraction 1.5 / 8 of the edge)
    assert.ok(Math.abs(t1 - 1.5 / 8) < 0.05, `ends near z 9.5: ${t1}`);
    // south edge: the garden below lies far beneath, railing all along
    assert.deepEqual(railSpans(upper, deck, [4, 11], [-1, 11], 0, model, floors), [[0, 1]]);
});

test('rail spans: a room or another balcony beside the deck needs none, a hedge or a pool does not count', () => {
    const { lower, upper, deck } = house();
    // the edge against the room (x = 4) is checked here directly (outdoor.ts leaves it out before by againstWall)
    assert.deepEqual(railSpans(upper, deck, [4, 3], [4, 11], 0, model, [lower, upper]), []);
    upper.outdoor = [deck, { id: 'next', type: 'balcony', points: rect(-1, 0, 4, 3) }];
    assert.deepEqual(railSpans(upper, deck, [-1, 3], [4, 3], 0, model, [lower, upper]), []);
    // a hedge on the hill stands there, but its height is not ground: the railing stays where only the hedge is
    lower.outdoor = [{ id: 'hedge', type: 'hedge', points: rect(-10, 0, -1, 9.5), offset: 2.8 } as RailArea];
    assert.deepEqual(railSpans(upper, deck, [-1, 11], [-1, 3], 0, model, [lower, upper]), [[0, 1]]);
});

test('rail spans: a step down onto the lawn still counts as level, a bank falling away does not', () => {
    const { lower, upper, deck } = house();
    lower.outdoor = [{ id: 'hill', type: 'lawn', points: rect(-10, 0, -1, 9.5), offset: 2.5 } as RailArea];
    assert.equal(railSpans(upper, deck, [-1, 9.5], [-1, 3], 0, model, [lower, upper]).length, 0);
    lower.outdoor = [{ id: 'bank', type: 'lawn', points: rect(-10, 9.5, -1, 12.5), offset: 2.8, bank: true } as RailArea];
    const spans = railSpans(upper, deck, [-1, 11], [-1, 9.5], 0, model, [lower, upper]);
    // the top of the bank (its first 0.45 m from z 9.5) lies within 0.45 m of the deck, then it falls away
    assert.equal(spans.length, 1);
    assert.equal(spans[0][0], 0);
    assert.ok(spans[0][1] > 0.6 && spans[0][1] < 0.85, `railing along the falling part: ${spans[0][1]}`);
});
