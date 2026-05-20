'use strict';
const { spawnSync } = require('child_process');

// ── FFT (radix-2 Cooley-Tukey, in-place) ─────────────────────────────────────

function fftInPlace(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            let t = re[i]; re[i] = re[j]; re[j] = t;
            t = im[i]; im[i] = im[j]; im[j] = t;
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len;
        const cosA = Math.cos(ang), sinA = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            const half = len >> 1;
            for (let j = 0; j < half; j++) {
                const uR = re[i+j], uI = im[i+j];
                const vR = re[i+j+half]*cr - im[i+j+half]*ci;
                const vI = re[i+j+half]*ci + im[i+j+half]*cr;
                re[i+j] = uR+vR; im[i+j] = uI+vI;
                re[i+j+half] = uR-vR; im[i+j+half] = uI-vI;
                const nr = cr*cosA - ci*sinA;
                ci = cr*sinA + ci*cosA; cr = nr;
            }
        }
    }
}

function hannWindow(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2*Math.PI*i/(n-1)));
    return w;
}

function buildMelFilterbank(nMels, nFft, sr) {
    const hzToMel = hz => 2595 * Math.log10(1 + hz / 700);
    const melToHz = mel => 700 * (Math.pow(10, mel / 2595) - 1);
    const bins = nFft / 2 + 1;
    const melMin = hzToMel(0), melMax = hzToMel(sr / 2);
    const pts = new Float32Array(nMels + 2);
    for (let i = 0; i < nMels + 2; i++)
        pts[i] = melToHz(melMin + (melMax - melMin) * i / (nMels + 1));
    const binHz = sr / nFft;
    const fb = [];
    for (let m = 0; m < nMels; m++) {
        const f = new Float32Array(bins);
        const lo = pts[m], ctr = pts[m+1], hi = pts[m+2];
        for (let b = 0; b < bins; b++) {
            const freq = b * binHz;
            if (freq >= lo && freq <= ctr) f[b] = (freq-lo)/(ctr-lo+1e-10);
            else if (freq > ctr && freq <= hi) f[b] = (hi-freq)/(hi-ctr+1e-10);
        }
        fb.push(f);
    }
    return fb;
}

function smoothArr(arr, win = 3) {
    const out = new Float32Array(arr.length);
    const half = (win - 1) >> 1;
    for (let i = 0; i < arr.length; i++) {
        let s = 0, c = 0;
        for (let j = Math.max(0, i-half); j <= Math.min(arr.length-1, i+half); j++) {
            s += arr[j]; c++;
        }
        out[i] = s / c;
    }
    return out;
}

function estimateBPM(onset, fps) {
    const minLag = Math.round(fps*60/240);
    const maxLag = Math.round(fps*60/40);
    let best = minLag, bestCorr = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
        let corr = 0;
        for (let i = lag; i < onset.length; i++) corr += onset[i]*onset[i-lag];
        if (corr > bestCorr) { bestCorr = corr; best = lag; }
    }
    return 60 * fps / best;
}

function pickPeaks(onset, threshold = 0.5) {
    const peaks = [];
    for (let i = 1; i < onset.length-1; i++)
        if (onset[i] > onset[i-1] && onset[i] > onset[i+1] && onset[i] > threshold)
            peaks.push(i);
    return peaks;
}

function extractFeatures(audioPath, fps = 30) {
    // Probe audio metadata
    const probe = spawnSync('ffprobe', [
        '-v', 'quiet', '-print_format', 'json',
        '-show_format', '-show_streams', audioPath,
    ], { encoding: 'utf8' });
    if (probe.status !== 0 || probe.error)
        throw new Error('ffprobe failed: ' + (probe.stderr || ''));
    const info = JSON.parse(probe.stdout);
    const aStream = info.streams.find(s => s.codec_type === 'audio');
    if (!aStream) throw new Error('No audio stream found in ' + audioPath);
    const sr = parseInt(aStream.sample_rate, 10) || 44100;
    const duration = parseFloat(info.format.duration);
    if (!duration) throw new Error('Could not determine audio duration');
    const totalFrames = Math.floor(duration * fps);

    // Decode to raw mono f32 PCM
    const dec = spawnSync('ffmpeg', [
        '-i', audioPath, '-f', 'f32le', '-ar', String(sr), '-ac', '1', 'pipe:1',
    ], { maxBuffer: 400 * 1024 * 1024 });
    if (dec.status !== 0 || dec.error)
        throw new Error('ffmpeg decode failed: ' + (dec.stderr || '').toString().slice(-400));

    const nSamples = dec.stdout.length / 4;
    const audio = new Float32Array(dec.stdout.buffer, dec.stdout.byteOffset, nSamples);

    const nFft = 2048;
    const hopLength = Math.round(sr / fps);
    const stftBins = nFft / 2 + 1;
    const nMels = 64;
    const nChroma = 12;

    // Allocate SharedArrayBuffers (zero-copy sharing with workers)
    const stftSAB  = new SharedArrayBuffer(stftBins * totalFrames * 4);
    const melSAB   = new SharedArrayBuffer(nMels    * totalFrames * 4);
    const chromaSAB= new SharedArrayBuffer(nChroma  * totalFrames * 4);
    const rmsSAB   = new SharedArrayBuffer(totalFrames * 4);
    const onsetSAB = new SharedArrayBuffer(totalFrames * 4);
    const centSAB  = new SharedArrayBuffer(totalFrames * 4);
    const audioSAB = new SharedArrayBuffer(nSamples * 4);

    const stftA = new Float32Array(stftSAB);
    const melA  = new Float32Array(melSAB);
    const chrA  = new Float32Array(chromaSAB);
    const rmsA  = new Float32Array(rmsSAB);
    const onsetA= new Float32Array(onsetSAB);
    const centA = new Float32Array(centSAB);
    const audioA= new Float32Array(audioSAB);
    audioA.set(audio);

    const hann = hannWindow(nFft);
    const melFB = buildMelFilterbank(nMels, nFft, sr);
    const re = new Float32Array(nFft);
    const im = new Float32Array(nFft);

    // Compute STFT + derived features per frame
    for (let frame = 0; frame < totalFrames; frame++) {
        const start = frame * hopLength;
        re.fill(0); im.fill(0);
        for (let i = 0; i < nFft; i++) {
            const idx = start + i;
            re[i] = idx < nSamples ? audio[idx] * hann[i] : 0;
        }
        fftInPlace(re, im);

        const fOff = frame * stftBins;
        let rmsSum = 0, cNum = 0, cDen = 0;
        for (let b = 0; b < stftBins; b++) {
            const mag = Math.sqrt(re[b]*re[b] + im[b]*im[b]);
            stftA[fOff + b] = mag;
            rmsSum += mag * mag;
            cNum += b * mag; cDen += mag;
        }
        rmsA[frame] = Math.sqrt(rmsSum / stftBins);
        centA[frame] = cDen > 0 ? cNum / cDen / (stftBins - 1) : 0;

        const mOff = frame * nMels;
        for (let m = 0; m < nMels; m++) {
            let v = 0;
            for (let b = 0; b < stftBins; b++) v += stftA[fOff+b] * melFB[m][b];
            melA[mOff + m] = v;
        }

        const cOff = frame * nChroma;
        for (let b = 1; b < stftBins; b++) {
            const freq = b * sr / nFft;
            if (freq < 20) continue;
            const midi = Math.round(12 * Math.log2(freq / 440) + 69);
            const pc = ((midi % 12) + 12) % 12;
            chrA[cOff + pc] += stftA[fOff + b];
        }
    }

    // Normalize STFT to dB scale mapped to [0,1]
    let maxMag = 0;
    for (let i = 0; i < stftA.length; i++) maxMag = Math.max(maxMag, stftA[i]);
    if (maxMag > 0) {
        for (let i = 0; i < stftA.length; i++) {
            const v = stftA[i] / maxMag;
            stftA[i] = v > 0 ? Math.max(0, (20 * Math.log10(v + 1e-9) + 80) / 80) : 0;
        }
    }

    // Normalize mel similarly
    let maxMel = 0;
    for (let i = 0; i < melA.length; i++) maxMel = Math.max(maxMel, melA[i]);
    if (maxMel > 0) {
        for (let i = 0; i < melA.length; i++) {
            const v = melA[i] / maxMel;
            melA[i] = v > 0 ? Math.max(0, (20 * Math.log10(v + 1e-9) + 80) / 80) : 0;
        }
    }

    // Normalize chroma per frame
    for (let f = 0; f < totalFrames; f++) {
        const o = f * nChroma;
        let mx = 0;
        for (let c = 0; c < nChroma; c++) mx = Math.max(mx, chrA[o+c]);
        if (mx > 0) for (let c = 0; c < nChroma; c++) chrA[o+c] /= mx;
    }

    // Normalize RMS
    let maxRms = 0;
    for (let i = 0; i < rmsA.length; i++) maxRms = Math.max(maxRms, rmsA[i]);
    if (maxRms > 0) for (let i = 0; i < rmsA.length; i++) rmsA[i] /= maxRms;

    // Onset strength
    for (let i = 1; i < totalFrames; i++)
        onsetA[i] = Math.min(1, Math.max(0, rmsA[i] - rmsA[i-1]) * 8);
    onsetA.set(smoothArr(onsetA, 3));
    let maxOnset = 0;
    for (let i = 0; i < onsetA.length; i++) maxOnset = Math.max(maxOnset, onsetA[i]);
    if (maxOnset > 0) for (let i = 0; i < onsetA.length; i++) onsetA[i] /= maxOnset;

    const tempo = estimateBPM(onsetA, fps);
    const beatFrames = pickPeaks(onsetA, 0.5);

    return {
        audioPath, sr, fps, duration, totalFrames, tempo,
        hopLength, stftBins, nMels, nChroma, nSamples,
        beatFrames,
        stftSAB, melSAB, chromaSAB, rmsSAB, onsetSAB, centSAB, audioSAB,
    };
}

module.exports = { extractFeatures };
