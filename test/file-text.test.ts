import test from 'node:test';
import assert from 'node:assert/strict';
import { fileText } from '../frontend/file-text';

const b64 = (text: string): string => Buffer.from(text).toString('base64');
const json = JSON.stringify({ version: 2, name: 'Küche 50 %', plans: {} });

test('JSON from readFile64 of the web socket is URL-encoded and gets decoded', () => {
    assert.equal(fileText(b64(encodeURIComponent(json)), 'application/json'), json);
});

test('unencoded JSON (older servers) stays as it is, even with a % in it', () => {
    assert.equal(fileText(b64(json), 'application/json'), json);
});

test('other files are not URL-decoded', () => {
    assert.equal(fileText(b64('%7B'), 'text/plain'), '%7B');
});
