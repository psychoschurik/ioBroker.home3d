import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BufferGeometry, Float32BufferAttribute } from 'three';

import { markWalls, WALL_ATTRIBUTE } from '../frontend/vendor-ext/hygge';

const geometry = (tris: number): BufferGeometry => {
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(new Float32Array(tris * 9), 3));
    return g;
};

describe('look Hygge', () => {
    it('marks only the walls, not what follows them in the buffer', () => {
        const mark = markWalls(geometry(5), 2).getAttribute(WALL_ATTRIBUTE);
        assert.equal(mark.count, 15);
        assert.deepEqual(Array.from(mark.array), [...Array(6).fill(1), ...Array(9).fill(0)]);
    });

    it('stays within the buffer', () => {
        assert.deepEqual(Array.from(markWalls(geometry(1), 4).getAttribute(WALL_ATTRIBUTE).array), [1, 1, 1]);
        assert.deepEqual(Array.from(markWalls(geometry(0), 3).getAttribute(WALL_ATTRIBUTE).array), []);
    });

    it('has a name in every language', () => {
        const tasks = readFileSync(join(__dirname, '..', 'tasks.ts'), 'utf8');
        assert.equal(tasks.match(/style_hygge: "/g)?.length, 2);
        const ru = JSON.parse(readFileSync(join(__dirname, '..', 'frontend/public/vendor/lang/ru.json'), 'utf8')) as Record<
            string,
            string
        >;
        assert.ok(ru.style_hygge);
    });
});
