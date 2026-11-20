import assert from 'node:assert/strict';
import test from 'node:test';
import { gapSegments } from '../frontend/vendor-ext/outline-gaps';

type P = [number, number];

test('outline gaps: a closed loop needs nothing, a wall open in part is joined straight', () => {
    const loop: [P, P][] = [
        [
            [0, 0],
            [10, 0],
        ],
        [
            [10, 0],
            [10, 8],
        ],
        [
            [10, 8],
            [0, 8],
        ],
        [
            [0, 8],
            [0, 0],
        ],
    ];
    assert.deepEqual(gapSegments(loop), []);
    // the east wall open between z 2 and 5 (a passage of height 0)
    const open: [P, P][] = [
        loop[0],
        [
            [10, 0],
            [10, 2],
        ],
        [
            [10, 5],
            [10, 8],
        ],
        loop[2],
        loop[3],
    ];
    assert.deepEqual(gapSegments(open), [
        [
            [10, 2],
            [10, 5],
        ],
    ]);
    // ends further apart than the limit stay open
    assert.deepEqual(gapSegments(open, 2), []);
});
