const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { join, resolve } = require('node:path');

const target = process.argv[2];
if (!['chrome', 'firefox'].includes(target)) {
    throw new Error('Choose a store target: chrome or firefox.');
}

const root = resolve(__dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const dist = join(root, 'dist');
const staging = join(dist, `${target}-package`);
const extension = target === 'firefox' ? 'xpi' : 'zip';
const archive = join(dist, `send-to-x4-${version}-${target}.${extension}`);

if (target === 'firefox') {
    // Firefox MV3 still runs a background event page instead of an extension
    // service worker, so provide the same dependencies in load order.
    manifest.background = {
        scripts: [
            'src/epub/jszip.min.js',
            'src/utils/logger.js',
            'src/utils/sanitize.js',
            'src/utils/transfer_utils.js',
            'src/utils/folder_path.js',
            'src/epub/epub_templates.js',
            'src/epub/epub_builder.js',
            'src/upload/x4_upload_tab.js',
            'src/upload/crosspoint_upload.js',
            'src/utils/settings.js',
            'src/background/service_worker.js'
        ]
    };
}

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(join(root, 'assets'), join(staging, 'assets'), { recursive: true });
cpSync(join(root, 'src'), join(staging, 'src'), { recursive: true });
const packageFiles = ['manifest.json', 'assets', 'src'];
if (existsSync(join(root, 'LICENSE'))) {
    cpSync(join(root, 'LICENSE'), join(staging, 'LICENSE'));
    packageFiles.splice(1, 0, 'LICENSE');
}
writeFileSync(join(staging, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

rmSync(archive, { force: true });
execFileSync('zip', ['-rq', archive, ...packageFiles, '-x', '*/.DS_Store'], { cwd: staging });
rmSync(staging, { recursive: true, force: true });

console.log(`Created ${archive}`);
