import assert from 'node:assert/strict';
import test from 'node:test';
import { animateTree, buildTree, isTreeKind, seasonOf, type TreeSpec, treeKey } from '../frontend/vendor-ext/trees';

const day = (m: number, d: number): number => Date.UTC(2026, m - 1, d, 12);

test('the season follows the date in the north', () => {
    const jan = seasonOf(day(1, 15), 50);
    assert.equal(jan.leaf, 0);
    const apr = seasonOf(day(4, 20), 50);
    assert.ok(apr.blossom > 0.9, 'blossom in April');
    assert.ok(apr.fresh > 0.5, 'fresh green in April');
    const jul = seasonOf(day(7, 15), 50);
    assert.equal(jul.leaf, 1);
    assert.equal(jul.autumn, 0);
    assert.equal(seasonOf(day(9, 10), 50).fruit, 1);
    const oct = seasonOf(day(10, 25), 50);
    assert.ok(oct.autumn > 0.9 && oct.leaf > 0.5, 'coloured leaves in October');
    assert.ok(oct.fall > 0.9, 'leaves fall in October');
    assert.equal(seasonOf(day(12, 10), 50).leaf, 0);
});

test('south of the equator the seasons turn round, in the tropics it stays green', () => {
    assert.equal(seasonOf(day(1, 15), -35).leaf, 1);
    assert.equal(seasonOf(day(7, 15), -35).leaf, 0);
    assert.equal(seasonOf(day(1, 15), 10).leaf, 1);
    // unknown: as in central Europe
    assert.deepEqual(seasonOf(day(1, 15), null), seasonOf(day(1, 15), 50));
});

const spec = (kind: TreeSpec['kind'], month: number, snow = 0): TreeSpec => ({
    id: `t-${kind}`,
    floor: 'f',
    kind,
    x: 0,
    z: 0,
    angle: 0,
    w: 4,
    d: 4,
    h: 6,
    season: seasonOf(day(month, 15), 50),
    snow,
});

test('a tree is bare in winter, the conifer and the bush keep their green', () => {
    assert.ok(isTreeKind('tree') && isTreeKind('bush') && !isTreeKind('sofa'));
    assert.equal(buildTree(spec('tree', 1)).getObjectByName('fp3dTreeLeaf'), undefined);
    assert.ok(buildTree(spec('tree', 7)).getObjectByName('fp3dTreeLeaf'));
    assert.ok(buildTree(spec('tree_conifer', 1)).getObjectByName('fp3dTreeLeaf'));
    assert.ok(buildTree(spec('bush', 1)).getObjectByName('fp3dTreeLeaf'));
    // blossom in spring, leaves falling in autumn
    assert.ok(buildTree(spec('tree_fruit', 4)).getObjectByName('fp3dTreeExtra'));
    assert.ok(buildTree(spec('tree', 10)).getObjectByName('fp3dTreeLeaves'));
});

test('in the dark looks a bare tree has blue bark, not green, and its leaves are the looks green', () => {
    type Colored = { geometry: { getAttribute(n: string): { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } };
    const mean = (o: unknown): [number, number, number] => {
        const c = (o as Colored).geometry.getAttribute('color');
        let r = 0;
        let g = 0;
        let b = 0;
        for (let i = 0; i < c.count; i++) {
            r += c.getX(i);
            g += c.getY(i);
            b += c.getZ(i);
        }
        return [r / c.count, g / c.count, b / c.count];
    };
    const bare = buildTree(spec('tree', 1), false);
    for (const name of ['fp3dTreeWood', 'fp3dTreeLimbs']) {
        const [r, g, b] = mean(bare.getObjectByName(name));
        assert.ok(b > g && b > r, `${name} is blue: ${r} ${g} ${b}`);
    }
    const [r, g, b] = mean(buildTree(spec('tree', 7), false).getObjectByName('fp3dTreeLeaf'));
    assert.ok(g > b && g > r, `the leaves are green: ${r} ${g} ${b}`);
});

test('the same tree looks the same every time and is rebuilt when the season changes', () => {
    const a = buildTree(spec('tree', 7)).getObjectByName('fp3dTreeLeaf') as unknown as { geometry: { getAttribute(n: string): { count: number } } };
    const b = buildTree(spec('tree', 7)).getObjectByName('fp3dTreeLeaf') as unknown as { geometry: { getAttribute(n: string): { count: number } } };
    assert.equal(a.geometry.getAttribute('position').count, b.geometry.getAttribute('position').count);
    assert.equal(treeKey(spec('tree', 7), 0), treeKey(spec('tree', 7), 0));
    assert.notEqual(treeKey(spec('tree', 7), 0), treeKey(spec('tree', 10), 0));
    assert.notEqual(treeKey(spec('tree', 1), 0), treeKey(spec('tree', 1, 1), 0));
});

test('the wind bends the crown with it and calm leaves it upright', () => {
    const g = buildTree(spec('tree', 7));
    assert.equal(animateTree(g, null, 1, 0.016), false);
    const crown = g.getObjectByName('fp3dTreeCrown')!;
    assert.ok(Math.abs(crown.rotation.x) < 1e-9 && Math.abs(crown.rotation.z) < 1e-9);
    // blowing towards +x (east in the plan): the crown leans that way (a negative turn about z)
    assert.equal(animateTree(g, { to: Math.PI / 2, speed: 12, gust: 0 }, 1, 0.016), true);
    assert.ok(crown.rotation.z < -0.02, `leans with the wind: ${crown.rotation.z}`);
});
