#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawnSync } = require('child_process');
const { extractFeatures } = require('./core/features');
const { renderToVideo } = require('./core/renderer');
const { TEMPLATES } = require('./core/templates');

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.wma']);

const RESOLUTIONS = {
    '1080p': [1920, 1080],
    '720p':  [1280,  720],
    '480p':  [ 854,  480],
};

const BANNER = `════════════════════════════════
 🎵  Audio Visualizer  v1.0  [JS]
════════════════════════════════`;

function checkFfmpeg() {
    const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (r.error) {
        console.error('Error: ffmpeg not found. Install it: https://ffmpeg.org/download.html');
        process.exit(1);
    }
}

function getOutputPath(audioPath, override = null) {
    if (override) return override;
    const base = path.basename(audioPath, path.extname(audioPath));
    const cacheDir = path.join(process.cwd(), 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    return path.join(cacheDir, base + '.mp4');
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { file: null, multiple: null, output: null, template: null, res: '1080p' };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if      ((a === '--file'     || a === '-f') && args[i+1]) opts.file     = args[++i];
        else if ((a === '--multiple' || a === '-m') && args[i+1]) opts.multiple = args[++i];
        else if ((a === '--output'   || a === '-o') && args[i+1]) opts.output   = args[++i];
        else if ((a === '--template' || a === '-t') && args[i+1]) opts.template = parseInt(args[++i], 10);
        else if ((a === '--res'      || a === '-r') && args[i+1]) opts.res      = args[++i];
    }
    return opts;
}

async function pickTemplate() {
    console.log('\nTemplates:');
    TEMPLATES.forEach((t, i) => console.log(`  ${String(i+1).padStart(2)}. ${t.name}`));
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        const ask = () => {
            rl.question(`\nChoose template (1-${TEMPLATES.length}): `, ans => {
                const n = parseInt(ans, 10);
                if (n >= 1 && n <= TEMPLATES.length) { rl.close(); resolve(n-1); }
                else { console.log(`  Please enter a number between 1 and ${TEMPLATES.length}.`); ask(); }
            });
        };
        ask();
    });
}

async function runMultiple(folder, templateIdx, width, height) {
    const files = fs.readdirSync(folder)
        .filter(f => AUDIO_EXTS.has(path.extname(f).toLowerCase()))
        .map(f => path.join(folder, f))
        .sort();

    if (files.length === 0) {
        console.error('No audio files found in: ' + folder);
        process.exit(1);
    }

    console.log(`\nFound ${files.length} audio file(s). Max 3 concurrent renders.\n`);

    const cliProgress = require('cli-progress');
    const multibar = new cliProgress.MultiBar({
        format: ' {label} [{bar}] {percentage}%  {value}/{total} frames  ETA {eta_formatted}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
        forceRedraw: true,
    }, cliProgress.Presets.shades_classic);

    let fileIdx = 0;
    const done = [];
    const errors = [];

    const runSlot = async () => {
        while (true) {
            const i = fileIdx++;
            if (i >= files.length) break;

            const audioPath = files[i];
            const name = path.basename(audioPath);
            const outputPath = getOutputPath(audioPath);
            const label = name.slice(0, 26).padEnd(26);

            multibar.log(`  Analyzing: ${name}\n`);
            let features;
            try {
                features = extractFeatures(audioPath);
            } catch (err) {
                errors.push({ file: name, err });
                continue;
            }

            try {
                await renderToVideo(features, templateIdx, audioPath, outputPath, { width, height, barContainer: multibar, label });
                done.push({ name, outputPath });
                multibar.log(`  ✓ ${name} → ${outputPath}\n`);
            } catch (err) {
                errors.push({ file: name, err });
                multibar.log(`  ✗ ${name}: ${err.message || err.stack || String(err)}\n`);
            }
        }
    };

    const concurrency = Math.min(3, files.length);
    await Promise.all(Array.from({ length: concurrency }, runSlot));
    multibar.stop();

    if (errors.length > 0) {
        console.log('\nErrors:');
        errors.forEach(({ file, err }) => console.log(`  ✗ ${file}: ${err.message}`));
    }
    console.log(`\n✓ Completed ${done.length}/${files.length} file(s).`);
}

async function main() {
    const opts = parseArgs();
    checkFfmpeg();

    if (!opts.file && !opts.multiple) {
        console.error([
            'Usage:',
            '  node app.js --file <audio> [--output out.mp4] [--template 1-20] [--res 1080p|720p|480p]',
            '  node app.js --multiple <folder> [--template 1-20] [--res 1080p|720p|480p]',
        ].join('\n'));
        process.exit(1);
    }

    const res = RESOLUTIONS[opts.res];
    if (!res) {
        console.error(`Error: --res must be one of: ${Object.keys(RESOLUTIONS).join(', ')}`);
        process.exit(1);
    }
    const [width, height] = res;

    console.log(BANNER);

    let templateIdx;
    if (opts.template != null) {
        if (opts.template < 1 || opts.template > TEMPLATES.length) {
            console.error(`Error: --template must be 1-${TEMPLATES.length}`);
            process.exit(1);
        }
        templateIdx = opts.template - 1;
    } else {
        templateIdx = await pickTemplate();
    }

    if (opts.multiple) {
        if (!fs.existsSync(opts.multiple) || !fs.statSync(opts.multiple).isDirectory()) {
            console.error('Error: folder not found: ' + opts.multiple);
            process.exit(1);
        }
        await runMultiple(opts.multiple, templateIdx, width, height);
        return;
    }

    // Single file mode
    if (!fs.existsSync(opts.file)) {
        console.error(`Error: audio file not found: ${opts.file}`);
        process.exit(1);
    }

    process.stdout.write('Analyzing audio… ');
    const features = extractFeatures(opts.file);
    console.log('done.');
    console.log(`File: ${path.basename(opts.file)}`);
    console.log(`Duration: ${features.duration.toFixed(1)}s  |  BPM: ${features.tempo.toFixed(0)}  |  Res: ${width}x${height}`);

    const templateName = TEMPLATES[templateIdx].name;
    console.log(`\nRendering: ${templateName} (${features.totalFrames} frames @ 30fps)`);

    const outputPath = getOutputPath(opts.file, opts.output);
    await renderToVideo(features, templateIdx, opts.file, outputPath, { width, height });

    console.log(`\n✓ Done! → ${outputPath}`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
