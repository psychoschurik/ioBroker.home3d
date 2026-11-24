import assert from 'node:assert/strict';
import test from 'node:test';
import { ALBUM_STEP_MS, Albums, albumStep, splitAlbum, storageUrl, type AlbumAccess } from '../frontend/albums';

function fakeAccess(pictures: string[], calls: string[]): AlbumAccess {
    return {
        instances: () => Promise.resolve(['screensaver.0']),
        sendTo: <T>(instance: string, command: string, message: unknown): Promise<T | null> => {
            calls.push(`${instance} ${command}`);
            const m = message as { album?: string; key?: string };
            if (command === 'getAlbums') {
                return Promise.resolve([{ value: 'family', label: 'Familie' }, { value: 'bad id!', label: 'x' }] as T);
            }
            if (command === 'list') {
                return Promise.resolve((m.album === 'family' ? { pictures: pictures.map(k => ({ k })) } : { error: 'album_not_found' }) as T);
            }
            if (command === 'picture') {
                return Promise.resolve({ url: `screensaver.0/cache/family/${m.key}_1280.jpg` } as T);
            }
            return Promise.resolve(null);
        },
    };
}

test('an album is named by instance and album; its files are one level above the page', () => {
    assert.deepEqual(splitAlbum('screensaver.0/family'), { instance: 'screensaver.0', album: 'family' });
    assert.equal(splitAlbum('javascript.0/family'), null);
    assert.equal(splitAlbum('screensaver.0/../x'), null);
    assert.equal(storageUrl('screensaver.0/cache/a.jpg'), '../screensaver.0/cache/a.jpg');
    assert.equal(storageUrl('/screensaver.0/cache/a.jpg'), '../screensaver.0/cache/a.jpg');
    assert.equal(storageUrl('https://example.invalid/a.jpg'), 'https://example.invalid/a.jpg');
});

test('the picture changes by the clock, the same on every screen', () => {
    assert.deepEqual(albumStep(3, 0), { index: 0, wait: ALBUM_STEP_MS });
    assert.deepEqual(albumStep(3, ALBUM_STEP_MS * 4 + 1000), { index: 1, wait: ALBUM_STEP_MS - 1000 });
    assert.equal(albumStep(0, 12345).index, 0);
});

test('the albums of the instances, only valid ids', async () => {
    const albums = new Albums(fakeAccess([], []));
    assert.deepEqual(await albums.list(), { albums: [{ id: 'screensaver.0/family', label: 'Familie' }] });
});

test('the current picture: the list is asked once, each picture once, then from the cache', async () => {
    let now = 0;
    const calls: string[] = [];
    const albums = new Albums(fakeAccess(['a', 'b'], calls), () => now);
    assert.equal((await albums.current('screensaver.0/family')).url, '../screensaver.0/cache/family/a_1280.jpg');
    now = ALBUM_STEP_MS;
    assert.equal((await albums.current('screensaver.0/family')).url, '../screensaver.0/cache/family/b_1280.jpg');
    now = ALBUM_STEP_MS * 2;
    assert.equal((await albums.current('screensaver.0/family')).url, '../screensaver.0/cache/family/a_1280.jpg');
    assert.deepEqual(calls, ['screensaver.0 list', 'screensaver.0 picture', 'screensaver.0 picture']);
    // an unknown album or a wrong id: no picture
    assert.equal((await albums.current('screensaver.0/other')).url, null);
    assert.equal((await albums.current('nonsense')).url, null);
});
