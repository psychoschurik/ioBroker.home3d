// Checks the npm tarball (`npm run test:pack`): the web adapter serves www/ from it, there is no backend.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const filename = `${metadata.name}-${metadata.version}.tgz`;
const temporary = await mkdtemp(path.join(tmpdir(), 'home3d-package-'));
try {
    // GNU tar (Git for Windows) reads "C:\..." as a remote host unless --force-local is given; bsdtar does not know it.
    // Extract with cwd instead of -C, GNU tar on Windows does not understand -C with a drive letter.
    const gnu = execFileSync('tar', ['--version']).toString().includes('GNU');
    const archive = path.join(root, filename).replaceAll('\\', '/');
    execFileSync('tar', [...(gnu ? ['--force-local'] : []), '-xf', archive], { cwd: temporary });
    const unpacked = path.join(temporary, 'package');
    const pkg = JSON.parse(await readFile(path.join(unpacked, 'package.json'), 'utf8'));
    const io = JSON.parse(await readFile(path.join(unpacked, 'io-package.json'), 'utf8'));
    assert.equal(pkg.version, io.common.version);
    assert.equal(io.common.onlyWWW, true);
    assert.equal(pkg.main, undefined, 'no backend');
    assert.deepEqual(pkg.dependencies ?? {}, {}, 'no runtime dependencies');
    await access(path.join(unpacked, 'admin', io.common.icon));
    for (const file of ['index.html', 'help.html', 'style.css', 'bridge.js', 'vendor/home3d.js', 'vendor/home3d-3d.js']) {
        await access(path.join(unpacked, 'www', file));
    }
    const html = await readFile(path.join(unpacked, 'www/index.html'), 'utf8');
    assert.match(html, /src="\.\.\/lib\/js\/socket\.io\.js"/, 'socket of the web adapter');
    assert.doesNotMatch(html, /(?:href|src)="\//, 'only relative links, web serves the page under /home3d/');
    const bridge = await readFile(path.join(unpacked, 'www/bridge.js'), 'utf8');
    assert.match(bridge, /\.\/vendor\/home3d\.js/);
    console.log(`Verified ${filename}: web files, no backend.`);
} finally {
    // Only remove the unique directory returned by mkdtemp, never a supplied path.
    await rm(temporary, { recursive: true, force: true });
}
