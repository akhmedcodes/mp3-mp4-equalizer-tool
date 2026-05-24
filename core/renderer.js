'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const cliProgress = require('cli-progress');

// Pipe raw RGBA frames directly to ffmpeg stdin — no PNG encoding, no disk I/O.
function renderToVideo(features, templateIdx, audioPath, outputPath, opts = {}) {
    const {
        width = 1920, height = 1080, fps = 30,
        barContainer = null, label = '',
    } = opts;

    return new Promise((resolve, reject) => {
        const nWorkers = Math.max(1, os.cpus().length);
        const total = features.totalFrames;

        const ffmpeg = spawn('ffmpeg', [
            '-y',
            '-f', 'image2pipe', '-vcodec', 'mjpeg',
            '-framerate', String(fps),
            '-i', 'pipe:0',
            '-i', audioPath,
            '-c:v', 'libx264', '-crf', '18', '-preset', 'ultrafast',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k',
            '-shortest', outputPath,
        ], { stdio: ['pipe', 'ignore', 'pipe'] });

        let ffmpegErr = '';
        ffmpeg.stderr.on('data', d => { ffmpegErr += d.toString(); });
        ffmpeg.on('close', code => {
            if (code !== 0) reject(new Error('ffmpeg error:\n' + (ffmpegErr.slice(-1000) || '(no stderr)')));
            else resolve();
        });
        ffmpeg.on('error', reject);
        ffmpeg.stdin.on('error', () => {});

        let bar;
        if (barContainer) {
            bar = barContainer.create(total, 0, { label });
        } else {
            bar = new cliProgress.SingleBar({
                format: 'Rendering [{bar}] {percentage}%  {value}/{total} frames  ETA {eta_formatted}',
                barCompleteChar: '█',
                barIncompleteChar: '░',
                hideCursor: true,
            }, cliProgress.Presets.shades_classic);
            bar.start(total, 0);
        }

        const workerData = {
            ...features,
            beatFrames: [...(features.beatFrames || [])],
            templateIdx,
            width,
            height,
        };

        // Reorder buffer: workers finish out-of-order, ffmpeg needs sequential frames
        const pending = new Map();
        let nextToWrite = 0;
        let completed = 0;
        let failed = false;
        let nextFrame = 0;

        const tryFlush = () => {
            while (pending.has(nextToWrite)) {
                const buf = pending.get(nextToWrite);
                pending.delete(nextToWrite);
                ffmpeg.stdin.write(buf);
                nextToWrite++;
            }
            if (nextToWrite >= total) ffmpeg.stdin.end();
        };

        const sendNext = (w) => {
            if (nextFrame < total) w.postMessage({ frameIdx: nextFrame++ });
            else w.postMessage(null);
        };

        for (let i = 0; i < Math.min(nWorkers, total); i++) {
            const w = new Worker(path.join(__dirname, 'worker.js'), { workerData });

            w.on('message', ({ frameIdx, buffer }) => {
                if (failed) return;
                completed++;
                bar.update(completed);
                pending.set(frameIdx, buffer);
                tryFlush();
                if (completed < total) sendNext(w);
                else if (!barContainer) bar.stop();
            });

            w.on('error', (err) => {
                if (!failed) {
                    failed = true;
                    if (!barContainer) bar.stop();
                    ffmpeg.stdin.destroy();
                    reject(err);
                }
            });

            sendNext(w);
        }
    });
}

module.exports = { renderToVideo };
