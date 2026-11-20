import assert from 'node:assert/strict';
import test from 'node:test';
import { levelAt, levelValue, MAX_ROOM_LEVEL, roomLevel } from '../frontend/vendor-ext/room-level';

type P = [number, number];

const living: { points: P[]; floor_level?: number | null } = { points: [[0, 0], [6, 0], [6, 5], [0, 5]] };
const dining = { points: [[6, 0], [10, 0], [10, 5], [6, 5]] as P[], floor_level: 0.45 };

test('room level: a raised room lifts the floor inside it, nowhere else', () => {
    assert.equal(roomLevel(null), 0);
    assert.equal(roomLevel(living), 0);
    assert.equal(roomLevel(dining), 0.45);
    // below the floor or too high: within 0 … MAX
    assert.equal(roomLevel({ floor_level: -1 }), 0);
    assert.equal(roomLevel({ floor_level: 9 }), MAX_ROOM_LEVEL);
    assert.equal(levelAt([living, dining], 8, 2), 0.45);
    assert.equal(levelAt([living, dining], 3, 2), 0);
    assert.equal(levelAt([living, dining], 20, 2), 0);
});

test('room level: the entered value is stored to the centimetre, 0 as nothing', () => {
    assert.equal(levelValue(0), null);
    assert.equal(levelValue(-0.5), null);
    assert.equal(levelValue(0.456), 0.46);
    assert.equal(levelValue(12), MAX_ROOM_LEVEL);
    assert.equal(levelValue(Number.NaN), null);
});
