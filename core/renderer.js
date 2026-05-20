'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');
const cliProgress = require('cli-progress');

function renderFrames(features, templateIdx, outputDir, width = 1920, height = 1080) {
    return new Promise((resolve, reject) => {
        const nWorkers = Math.max(1, os.cpus().length);
        const total = features.totalFrames;

        const workerData = {
            ...features,          // includes all SABs (shared, not copied)
            beatFrames: [...(features.beatFrames || [])],
            templateIdx,
            outputDir,
            width,
            height,
        };

        const bar = new cliProgress.SingleBar({
            format: 'Rendering [{bar}] {percentage}%  {value}/{total} frames  ETA {eta_formatted}',
            barCompleteChar: '█',
            barIncompleteChar: '░',
            hideCursor: true,
        }, cliProgress.Presets.shades_classic);
        bar.start(total, 0);

        let nextFrame = 0;
        let completed = 0;
        let failed = false;

        const workers = [];

        const sendNext = (w) => {
            if (nextFrame < total) {
                w.postMessage(nextFrame++);
            } else {
                w.postMessage(null);
            }
        };

        for (let i = 0; i < Math.min(nWorkers, total); i++) {
            const w = new Worker(path.join(__dirname, 'worker.js'), { workerData });
            workers.push(w);

            w.on('message', () => {
                if (failed) return;
                completed++;
                bar.update(completed);
                if (completed >= total) {
                    bar.stop();
                    resolve(total);
                } else {
                    sendNext(w);
                }
            });

            w.on('error', (err) => {
                if (!failed) { failed = true; bar.stop(); reject(err); }
            });

            sendNext(w);
        }
    });
}

module.exports = { renderFrames };
