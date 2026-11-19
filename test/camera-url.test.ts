import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraSrc, isStream } from '../frontend/vendor-ext/camera-url';

test('MJPEG streams keep their URL, stills get the counter', () => {
    assert.equal(cameraSrc('../frigate.0/Whisky/stream.mjpeg?height=480', 7), '../frigate.0/Whisky/stream.mjpeg?height=480');
    assert.equal(cameraSrc('http://x/api/stream.mjpeg?src=cam', 7), 'http://x/api/stream.mjpeg?src=cam');
    assert.equal(cameraSrc('../frigate.0/Whisky/snapshot.jpg?height=480', 7), '../frigate.0/Whisky/snapshot.jpg?height=480&fp3d=7');
    assert.equal(cameraSrc('http://x/latest.jpg', 7), 'http://x/latest.jpg?fp3d=7');
    assert.equal(cameraSrc('data:image/jpeg;base64,AAAA', 7), 'data:image/jpeg;base64,AAAA');
});

test('only the path decides what is a stream, not the word "stream"', () => {
    assert.ok(isStream('http://cam/video.MJPG'));
    assert.ok(isStream('/cam/live.mjpeg#x'));
    assert.ok(!isStream('http://x/stream/latest.jpg'));
    assert.ok(!isStream('http://x/snapshot.jpg?format=mjpeg'));
    assert.ok(!isStream('http://x/livestream'));
});
