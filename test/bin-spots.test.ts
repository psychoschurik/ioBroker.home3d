import assert from 'node:assert/strict';
import test from 'node:test';
import { binsOut, binsSig, withBinsOut, type BinItem } from '../frontend/vendor-ext/bin-spots';

const bin = (id: string, x: number): BinItem => ({ id, type: 'waste_bin', x, z: 5, w: 0.58, d: 0.73, rotation: 0 });

test('bins that are out stand in a row on the nearest spot, turned like it', () => {
    const spot: BinItem = { id: 's', type: 'bin_spot', x: 10, z: -2, w: 2.4, d: 0.9, rotation: 90 };
    const far: BinItem = { id: 'far', type: 'bin_spot', x: 50, z: 50, w: 2.4, d: 0.9, rotation: 0 };
    const floor = { furniture: [bin('rest', 2), bin('paper', 1), bin('bio', 3), spot, far] };
    const places = binsOut([floor], f => f.id !== 'bio');
    assert.deepEqual([...places.keys()].sort(), ['paper', 'rest']);
    // along the spot's axis (turned 90°: along z), paper first as it stands further left at home, centred on the spot
    const p = places.get('paper')!;
    const r = places.get('rest')!;
    assert.equal(p.rotation, 90);
    assert.ok(Math.abs(p.x - 10) < 1e-9 && Math.abs(r.x - 10) < 1e-9);
    assert.ok(Math.abs(p.z - (-2 - 0.33)) < 1e-9);
    assert.ok(Math.abs(r.z - (-2 + 0.33)) < 1e-9);
    const moved = withBinsOut(floor, places);
    assert.equal(moved.furniture.find(f => f.id === 'rest')?.z, r.z);
    assert.equal(moved.furniture.find(f => f.id === 'bio')?.z, 5);
    assert.equal(withBinsOut(floor, new Map()), floor);
    assert.notEqual(binsSig(places), binsSig(new Map()));
    // without a spot nothing goes out
    assert.equal(binsOut([{ furniture: [bin('rest', 2)] }], () => true).size, 0);
});
