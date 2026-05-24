'use strict';
const { workerData, parentPort } = require('worker_threads');
const { createCanvas } = require('@napi-rs/canvas');
const { TEMPLATES } = require('./templates');

const f = workerData;
f.stftArr   = new Float32Array(f.stftSAB);
f.melArr    = new Float32Array(f.melSAB);
f.chromaArr = new Float32Array(f.chromaSAB);
f.rmsArr    = new Float32Array(f.rmsSAB);
f.onsetArr  = new Float32Array(f.onsetSAB);
f.centArr   = new Float32Array(f.centSAB);
f.audioArr  = new Float32Array(f.audioSAB);

f.getSpectrum = (frameIdx, nBars) => {
    const fi = Math.min(frameIdx, f.totalFrames - 1);
    const off = fi * f.stftBins;
    const out = new Float32Array(nBars);
    for (let i = 0; i < nBars; i++) {
        const bin = Math.min(Math.floor(i * (f.stftBins - 1) / (nBars - 1)), f.stftBins - 1);
        out[i] = f.stftArr[off + bin];
    }
    return out;
};
f.getMel = (frameIdx) => {
    const fi = Math.min(frameIdx, f.totalFrames - 1);
    return f.melArr.subarray(fi * f.nMels, (fi + 1) * f.nMels);
};

const W = f.width, H = f.height;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');
const templateFn = TEMPLATES[f.templateIdx].fn;

parentPort.on('message', (msg) => {
    if (msg === null) return;
    const { frameIdx } = msg;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, W, H);
    templateFn(ctx, frameIdx, f, W, H);

    // Raw RGBA pixels — no PNG compression, transfer zero-copy to main thread
    const buffer = canvas.toBuffer('image/jpeg', { quality: 92 });
    parentPort.postMessage({ frameIdx, buffer });
});
