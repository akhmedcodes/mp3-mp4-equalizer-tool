#!/usr/bin/env node
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const { spawnSync, spawn } = require('child_process');
const { extractFeatures } = require('./core/features');
const { renderFrames } = require('./core/renderer');
const { TEMPLATES } = require('./core/templates');

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

function buildVideo(frameDir, audioPath, outputPath, fps = 30) {
    const pattern = path.join(frameDir, 'frame_%06d.png');
    const r = spawnSync('ffmpeg', [
        '-y', '-framerate', String(fps),
        '-i', pattern,
        '-i', audioPath,
        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest', outputPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    if (r.status !== 0) {
        console.error('ffmpeg error:\n' + r.stderr.toString().slice(-1000));
        process.exit(1);
    }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { file: null, output: 'output.mp4', template: null };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if ((a === '--file'     || a === '-f') && args[i+1]) opts.file     = args[++i];
        else if ((a === '--output'   || a === '-o') && args[i+1]) opts.output  = args[++i];
        else if ((a === '--template' || a === '-t') && args[i+1]) opts.template = parseInt(args[++i], 10);
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

async function main() {
    const opts = parseArgs();

    checkFfmpeg();

    if (!opts.file) {
        console.error('Usage: node app.js --file <audio> [--output output.mp4] [--template 1-20]');
        process.exit(1);
    }
    if (!fs.existsSync(opts.file)) {
        console.error(`Error: audio file not found: ${opts.file}`);
        process.exit(1);
    }

    console.log(BANNER);
    process.stdout.write('Analyzing audio… ');
    const features = extractFeatures(opts.file);
    console.log('done.');
    console.log(`File: ${path.basename(opts.file)}`);
    console.log(`Duration: ${features.duration.toFixed(1)}s  |  BPM: ${features.tempo.toFixed(0)}`);

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

    const templateName = TEMPLATES[templateIdx].name;
    console.log(`\nRendering: ${templateName} (${features.totalFrames} frames @ 30fps)`);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av_frames_'));
    try {
        await renderFrames(features, templateIdx, tmpDir);
        process.stdout.write('\nBuilding video… ');
        buildVideo(tmpDir, opts.file, opts.output);
        console.log('done.');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log(`\n✓ Done! → ${opts.output}`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
