'use strict';
const { createCanvas } = require('@napi-rs/canvas');

// ── Colormaps ─────────────────────────────────────────────────────────────────

const CMAP_STOPS = {
    plasma:  [[0,[13,8,135]],[0.25,[126,3,168]],[0.5,[204,71,120]],[0.75,[248,149,64]],[1,[240,249,33]]],
    viridis: [[0,[68,1,84]],[0.25,[58,82,139]],[0.5,[32,144,141]],[0.75,[94,201,98]],[1,[253,231,37]]],
    inferno: [[0,[0,0,4]],[0.25,[87,16,110]],[0.5,[188,55,84]],[0.75,[249,142,9]],[1,[252,255,164]]],
    magma:   [[0,[0,0,4]],[0.25,[80,18,123]],[0.5,[183,55,121]],[0.75,[251,135,97]],[1,[252,253,191]]],
    turbo:   [[0,[48,18,59]],[0.2,[49,104,226]],[0.4,[16,204,185]],[0.6,[122,225,52]],[0.8,[240,156,21]],[1,[122,4,3]]],
    cool:    [[0,[0,255,255]],[1,[255,0,255]]],
    neon:    [[0,[0,255,255]],[0.5,[255,0,255]],[1,[255,255,0]]],
};

function cmapRgb(name, v) {
    v = Math.max(0, Math.min(1, v));
    if (name === 'hsv') {
        const h = v * 360, s = 1, vv = 1;
        const c = vv*s, x = c*(1-Math.abs((h/60)%2-1)), m = vv-c;
        let r=0,g=0,b=0;
        if (h<60) [r,g,b]=[c,x,0]; else if (h<120) [r,g,b]=[x,c,0];
        else if (h<180) [r,g,b]=[0,c,x]; else if (h<240) [r,g,b]=[0,x,c];
        else if (h<300) [r,g,b]=[x,0,c]; else [r,g,b]=[c,0,x];
        return [(r+m)*255,(g+m)*255,(b+m)*255];
    }
    const stops = CMAP_STOPS[name] || CMAP_STOPS.plasma;
    let lo = stops[0], hi = stops[stops.length-1];
    for (let i = 0; i < stops.length-1; i++) {
        if (v >= stops[i][0] && v <= stops[i+1][0]) { lo=stops[i]; hi=stops[i+1]; break; }
    }
    const t = (v-lo[0]) / (hi[0]-lo[0]+1e-9);
    return [lo[1][0]+t*(hi[1][0]-lo[1][0]), lo[1][1]+t*(hi[1][1]-lo[1][1]), lo[1][2]+t*(hi[1][2]-lo[1][2])];
}

// Precompute 256-entry LUT
const LUT = {};
for (const name of [...Object.keys(CMAP_STOPS), 'hsv']) {
    LUT[name] = [];
    for (let i = 0; i < 256; i++) {
        const [r,g,b] = cmapRgb(name, i/255);
        LUT[name][i] = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
    }
}
function clr(name, v) { return LUT[name][Math.max(0,Math.min(255,Math.round(v*255)))]; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function smooth(arr, win = 3) {
    const out = new Float32Array(arr.length);
    const h = (win-1)>>1;
    for (let i = 0; i < arr.length; i++) {
        let s=0,c=0;
        for (let j=Math.max(0,i-h); j<=Math.min(arr.length-1,i+h); j++) { s+=arr[j]; c++; }
        out[i] = s/c;
    }
    return out;
}

function beatFlash(frameIdx, beatFrames, decay = 8) {
    let flash = 0;
    for (let i = 0; i < beatFrames.length; i++) {
        const d = frameIdx - beatFrames[i];
        if (d >= 0 && d < decay) flash = Math.max(flash, 0.4*(1-d/decay));
    }
    return flash;
}

// ── Template 1 — Classic Equalizer ───────────────────────────────────────────

function t1(ctx, fi, f, W, H) {
    const bars = 64;
    const sp = smooth(f.getSpectrum(fi, bars), 3);
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
        const h = sp[i] * H * 0.82;
        const x = i * bw;
        const grad = ctx.createLinearGradient(0, H-h, 0, H);
        grad.addColorStop(0, clr('plasma', i/bars+0.3));
        grad.addColorStop(1, clr('plasma', i/bars));
        ctx.fillStyle = grad;
        ctx.fillRect(x+1, H-h, bw-2, h);
    }
    const fl = beatFlash(fi, f.beatFrames);
    if (fl > 0) {
        ctx.fillStyle = `rgba(80,0,80,${fl*0.4})`;
        ctx.fillRect(0, 0, W, H);
    }
    ctx.fillStyle = '#ff6ec7'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('EQUALIZER', W/2, 36);
}

// ── Template 2 — Circular Waveform ───────────────────────────────────────────

function t2(ctx, fi, f, W, H) {
    const cx = W/2, cy = H/2;
    const bars = 180;
    const sp = smooth(f.getSpectrum(fi, bars), 5);
    const rBase = Math.min(W,H)*0.22;
    for (let i = 0; i < bars; i++) {
        const theta = (i/bars)*2*Math.PI - Math.PI/2;
        const r = rBase + sp[i]*Math.min(W,H)*0.28;
        ctx.strokeStyle = clr('hsv', i/bars);
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(cx + rBase*Math.cos(theta), cy + rBase*Math.sin(theta));
        ctx.lineTo(cx + r*Math.cos(theta),     cy + r*Math.sin(theta));
        ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, rBase, 0, 2*Math.PI);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${f.tempo.toFixed(0)} BPM`, cx, cy+6);
}

// ── Template 3 — Neon Bars ────────────────────────────────────────────────────

function t3(ctx, fi, f, W, H) {
    const bars = 80;
    const sp = smooth(f.getSpectrum(fi, bars), 3);
    const bw = W / bars;
    const energy = f.rmsArr[fi];
    for (let i = 0; i < bars; i++) {
        const h = sp[i] * H * 0.85;
        const x = i * bw;
        const c = clr('neon', i/bars);
        ctx.shadowColor = c; ctx.shadowBlur = 12;
        ctx.fillStyle = c;
        ctx.fillRect(x+1, H-h, bw-2, h);
        ctx.shadowBlur = 0;
        // Reflection
        ctx.globalAlpha = 0.18;
        ctx.fillRect(x+1, H, bw-2, h*0.2);
        ctx.globalAlpha = 1;
    }
    const fl = beatFlash(fi, f.beatFrames);
    if (fl > 0) {
        ctx.fillStyle = `rgba(0,60,${Math.round(fl*180)},${fl*0.3})`;
        ctx.fillRect(0, 0, W, H);
    }
}

// ── Template 4 — Waveform Line ────────────────────────────────────────────────

function t4(ctx, fi, f, W, H) {
    const start = fi * f.hopLength;
    const nShow = f.hopLength * 5;
    const end = Math.min(start + nShow, f.nSamples);
    const seg = f.audioArr.subarray(start, end);
    if (seg.length < 2) return;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#00bfff'); grad.addColorStop(0.5, '#bf00ff'); grad.addColorStop(1, '#00bfff');
    ctx.strokeStyle = grad; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < seg.length; i++) {
        const x = (i / (seg.length-1)) * W;
        const y = H/2 - seg[i] * H * 0.42;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
    ctx.fillStyle = 'rgba(136,204,255,0.5)'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
    ctx.fillText('WAVEFORM', W/2, H-16);
}

// ── Template 5 — Spectrum Tunnel ─────────────────────────────────────────────

function t5(ctx, fi, f, W, H) {
    const cx = W/2, cy = H/2;
    const rings = 14;
    const bars = 80;
    const sp = smooth(f.getSpectrum(fi, bars), 5);
    const energy = f.rmsArr[fi];
    for (let ring = rings; ring >= 1; ring--) {
        const scale = ring / rings;
        const alpha = 0.08 + 0.7*(1-scale);
        const r = scale * Math.min(W,H)*0.42;
        const pts = [];
        for (let i = 0; i < bars; i++) {
            const theta = (i/bars)*2*Math.PI;
            const rad = r + sp[i]*50*(1+energy*0.5);
            pts.push([cx+rad*Math.cos(theta), cy+rad*Math.sin(theta)]);
        }
        ctx.beginPath();
        pts.forEach(([x,y],i) => i===0?ctx.moveTo(x,y):ctx.lineTo(x,y));
        ctx.closePath();
        const [r2,g2,b2] = cmapRgb('plasma', 1-scale);
        ctx.fillStyle = `rgba(${Math.round(r2)},${Math.round(g2)},${Math.round(b2)},${alpha*0.3})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(${Math.round(r2)},${Math.round(g2)},${Math.round(b2)},${alpha})`;
        ctx.lineWidth = 0.9; ctx.stroke();
    }
}

// ── Template 6 — Mel Heatmap ─────────────────────────────────────────────────

function t6(ctx, fi, f, W, H) {
    const cols = 120, rows = f.nMels;
    const cw = W/cols, ch = H/rows;
    const half = cols>>1;
    for (let c = 0; c < cols; c++) {
        const src = Math.max(0, Math.min(f.totalFrames-1, fi-half+c));
        const mel = f.getMel(src);
        for (let r = 0; r < rows; r++) {
            ctx.fillStyle = clr('inferno', mel[r]);
            ctx.fillRect(c*cw, H-(r+1)*ch, cw+1, ch+1);
        }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(half*cw, 0); ctx.lineTo(half*cw, H); ctx.stroke();
}

// ── Template 7 — Starfield Beat ──────────────────────────────────────────────

function t7(ctx, fi, f, W, H) {
    // Stars (deterministic pseudo-random)
    const N = 320;
    for (let i = 0; i < N; i++) {
        const sx = ((i*7919+13)%W);
        const sy = ((i*6271+31)%H);
        const onset = f.onsetArr[fi];
        const size = 1 + ((i*3+7)%5)*0.5*(1+onset*2);
        ctx.fillStyle = `rgba(255,255,255,${0.3+((i%5)*0.1)})`;
        ctx.beginPath(); ctx.arc(sx, sy, size, 0, 2*Math.PI); ctx.fill();
    }
    const cx = W/2, cy = H/2;
    const bars = 60;
    const sp = smooth(f.getSpectrum(fi, bars), 5);
    const energy = f.rmsArr[fi];
    ctx.beginPath();
    for (let i = 0; i <= bars; i++) {
        const theta = (i%bars/bars)*2*Math.PI;
        const r = 40 + sp[i%bars]*(Math.min(W,H)*0.28)*(1+energy*0.5);
        const px = cx + r*Math.cos(theta);
        const py = cy + r*Math.sin(theta);
        i===0?ctx.moveTo(px,py):ctx.lineTo(px,py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,110,199,0.45)'; ctx.fill();
    ctx.strokeStyle = '#ff6ec7'; ctx.lineWidth = 1.5; ctx.stroke();
    const fl = beatFlash(fi, f.beatFrames);
    if (fl > 0) {
        ctx.fillStyle = `rgba(50,0,80,${fl*0.35})`; ctx.fillRect(0,0,W,H);
    }
}

// ── Template 8 — Radial Spectrum ─────────────────────────────────────────────

function t8(ctx, fi, f, W, H) {
    const cx = W/2, cy = H/2;
    const bars = 128;
    const sp = smooth(f.getSpectrum(fi, bars), 3);
    const energy = f.rmsArr[fi];
    const arcW = (2*Math.PI/bars)*0.88;
    for (let i = 0; i < bars; i++) {
        const theta = (i/bars)*2*Math.PI - Math.PI/2;
        const rMin = Math.min(W,H)*0.12;
        const rMax = rMin + sp[i]*(Math.min(W,H)*0.34)*(0.6+energy*0.4);
        ctx.fillStyle = clr('turbo', sp[i]);
        ctx.beginPath();
        ctx.arc(cx, cy, rMax, theta-arcW/2, theta+arcW/2);
        ctx.arc(cx, cy, rMin, theta+arcW/2, theta-arcW/2, true);
        ctx.closePath(); ctx.fill();
    }
    const cent = f.centArr[fi];
    ctx.fillStyle = clr('turbo', cent);
    ctx.font = 'bold 30px serif'; ctx.textAlign = 'center';
    ctx.fillText('♪', cx, cy+10);
}

// ── Template 9 — Dual Mirror EQ ──────────────────────────────────────────────

function t9(ctx, fi, f, W, H) {
    const bars = 64;
    const sp = smooth(f.getSpectrum(fi, bars), 3);
    const bw = W/bars;
    const mid = H/2;
    for (let i = 0; i < bars; i++) {
        const h = sp[i]*mid*0.88;
        const x = i*bw;
        const c = clr('neon', i/bars);
        ctx.fillStyle = c;
        ctx.fillRect(x+1, mid-h, bw-2, h);
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x+1, mid, bw-2, h);
        ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
    const fl = beatFlash(fi, f.beatFrames);
    if (fl > 0) {
        ctx.fillStyle = `rgba(0,40,${Math.round(fl*120)},${fl*0.3})`; ctx.fillRect(0,0,W,H);
    }
}

// ── Template 10 — RGB Oscilloscope ───────────────────────────────────────────

function t10(ctx, fi, f, W, H) {
    const start = fi*f.hopLength;
    const nShow = f.hopLength*3;
    const seg = f.audioArr.subarray(start, Math.min(start+nShow, f.nSamples));
    if (seg.length < 2) return;
    const shift = (seg.length/20)|0;
    const draw = (offset, color) => {
        ctx.strokeStyle = color; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.75;
        ctx.beginPath();
        for (let i = 0; i < seg.length; i++) {
            const x = (i/(seg.length-1))*W;
            const s = (i+offset) % seg.length;
            const y = H/2 - seg[s]*H*0.4;
            i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        }
        ctx.stroke(); ctx.globalAlpha = 1;
    };
    draw(0,       '#ff3333');
    draw(shift,   '#33ff33');
    draw(shift*2, '#3333ff');
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
    ctx.fillStyle = 'rgba(170,170,170,0.4)'; ctx.font = '11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('OSCILLOSCOPE', W/2, H-14);
}

// ── Template 11 — Lissajous ──────────────────────────────────────────────────

function t11(ctx, fi, f, W, H) {
    const start = fi*f.hopLength;
    const nShow = f.hopLength*8;
    const seg = f.audioArr.subarray(start, Math.min(start+nShow, f.nSamples));
    if (seg.length < 10) return;
    const shift = (seg.length/8)|0;
    const cx = W/2, cy = H/2;
    const scale = Math.min(W,H)*0.42;
    for (let i = 1; i < seg.length; i++) {
        const t = i/(seg.length-1);
        const x = cx + seg[i]*scale;
        const y = cy - seg[(i+shift)%seg.length]*scale;
        const px = cx + seg[i-1]*scale;
        const py = cy - seg[(i-1+shift)%seg.length]*scale;
        ctx.strokeStyle = clr('cool', t);
        ctx.globalAlpha = 0.1 + t*0.8;
        ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(136,204,255,0.4)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('LISSAJOUS', W/2, H-14);
}

// ── Template 12 — Chroma Wheel ───────────────────────────────────────────────

function t12(ctx, fi, f, W, H) {
    const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const cx = W/2, cy = H/2;
    const off = fi*f.nChroma;
    const arcW = (2*Math.PI/12)*0.85;
    const rMin = Math.min(W,H)*0.12;
    let maxC = -1, maxVal = 0;
    for (let c = 0; c < 12; c++) {
        const v = f.chromaArr[off+c];
        const theta = (c/12)*2*Math.PI - Math.PI/2;
        const rMax = rMin + v*Math.min(W,H)*0.34;
        ctx.fillStyle = clr('hsv', c/12);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(cx, cy, rMax, theta-arcW/2, theta+arcW/2);
        ctx.arc(cx, cy, rMin, theta+arcW/2, theta-arcW/2, true);
        ctx.closePath(); ctx.fill();
        if (v > maxVal) { maxVal=v; maxC=c; }
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(maxC >= 0 ? notes[maxC] : '', cx, cy+9);
}

// ── Template 13 — Frequency Waterfall ────────────────────────────────────────

function t13(ctx, fi, f, W, H) {
    const rows = 80, bars = 128;
    const cw = W/bars, rh = H/rows;
    for (let row = 0; row < rows; row++) {
        const src = Math.max(0, fi-row);
        const sp = f.getSpectrum(src, bars);
        const alpha = 1 - row/rows*0.4;
        for (let b = 0; b < bars; b++) {
            const [r,g,bv] = cmapRgb('magma', sp[b]);
            ctx.fillStyle = `rgba(${Math.round(r)},${Math.round(g)},${Math.round(bv)},${alpha})`;
            ctx.fillRect(b*cw, row*rh, cw+1, rh+1);
        }
    }
}

// ── Template 14 — Particle Burst ─────────────────────────────────────────────

function t14(ctx, fi, f, W, H) {
    const cx = W/2, cy = H/2;
    const onset = f.onsetArr[fi];
    const energy = f.rmsArr[fi];
    const n = 60 + (onset*220)|0;
    const seed = fi*7+13;
    for (let i = 0; i < n; i++) {
        const ang = ((seed*i*2654435761)>>>0)/0xFFFFFFFF * 2*Math.PI;
        const rad = ((seed*(i+1)*2246822519)>>>0)/0xFFFFFFFF * Math.min(W,H)*0.42*(0.5+energy*0.5);
        const size = 2 + (((seed*i*1597334677)>>>0)/0xFFFFFFFF)*20*(1+onset*1.5);
        const hue = ((seed*i*1013904223)>>>0)/0xFFFFFFFF;
        ctx.fillStyle = clr('plasma', hue);
        ctx.globalAlpha = 0.65;
        ctx.beginPath(); ctx.arc(cx+rad*Math.cos(ang), cy+rad*Math.sin(ang), size, 0, 2*Math.PI);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
    const sp = smooth(f.getSpectrum(fi, 60), 5);
    ctx.strokeStyle = '#00ffff'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
        const theta = (i%60/60)*2*Math.PI;
        const r = Math.min(W,H)*0.34 + sp[i%60]*50;
        i===0?ctx.moveTo(cx+r*Math.cos(theta),cy+r*Math.sin(theta)):
              ctx.lineTo(cx+r*Math.cos(theta),cy+r*Math.sin(theta));
    }
    ctx.closePath(); ctx.stroke();
}

// ── Template 15 — Glitch Bars ────────────────────────────────────────────────

function t15(ctx, fi, f, W, H) {
    const bars = 48;
    const sp = smooth(f.getSpectrum(fi, bars), 2);
    const energy = f.rmsArr[fi];
    const bw = W/bars;
    for (let i = 0; i < bars; i++) {
        const h = sp[i]*H*0.88;
        const x = i*bw;
        ctx.fillStyle = '#00ff41'; ctx.fillRect(x+1, H-h, bw-2, h);
        if (energy > 0.35) {
            const jitter = (((fi*i*6364136223846793005n+1442695040888963407n)&0xFFn)*1.0)/255-0.5;
            ctx.globalAlpha = 0.38;
            ctx.fillStyle = '#ff0040'; ctx.fillRect(x+bw*0.1, H-(h+jitter*12), bw*0.5, h+jitter*12);
            ctx.fillStyle = '#0040ff'; ctx.fillRect(x-bw*0.1, H-(h-jitter*8),  bw*0.5, h-jitter*8);
            ctx.globalAlpha = 1;
        }
    }
    const fl = beatFlash(fi, f.beatFrames);
    if (fl > 0) {
        ctx.fillStyle = `rgba(0,${Math.round(fl*150)},0,${fl*0.25})`; ctx.fillRect(0,0,W,H);
    }
    ctx.fillStyle = '#00ff41'; ctx.font = '14px monospace'; ctx.textAlign = 'center';
    ctx.globalAlpha = 0.65; ctx.fillText('// SIGNAL //', W/2, 32); ctx.globalAlpha = 1;
}

// ── Template 16 — Plasma Blob ────────────────────────────────────────────────

function t16(ctx, fi, f, W, H) {
    const PW = 240, PH = 135;
    const offCanvas = createCanvas(PW, PH);
    const offCtx = offCanvas.getContext('2d');
    const imgData = offCtx.createImageData(PW, PH);
    const data = imgData.data;
    const t = fi*0.07;
    const energy = f.rmsArr[fi];
    for (let py = 0; py < PH; py++) {
        for (let px = 0; px < PW; px++) {
            const nx = px/PW*4*Math.PI, ny = py/PH*4*Math.PI;
            let z = Math.sin(nx+t) + Math.sin(ny+t*1.3)
                  + Math.sin((nx+ny)*0.5+t*0.7)
                  + Math.sin(Math.sqrt(nx*nx+ny*ny)*0.5-t*1.5)*energy;
            const v = (z+4)/8;
            const [r,g,b] = cmapRgb('plasma', v);
            const idx = (py*PW+px)*4;
            data[idx]=Math.round(r); data[idx+1]=Math.round(g); data[idx+2]=Math.round(b); data[idx+3]=255;
        }
    }
    offCtx.putImageData(imgData, 0, 0);
    ctx.drawImage(offCanvas, 0, 0, W, H);
}

// ── Template 17 — Spectrum + Waveform ────────────────────────────────────────

function t17(ctx, fi, f, W, H) {
    const split = H*0.52;
    // Top: spectrum bars
    const bars = 80, sp = smooth(f.getSpectrum(fi, bars), 3);
    const bw = W/bars;
    for (let i = 0; i < bars; i++) {
        const h = sp[i]*split*0.88;
        const grad = ctx.createLinearGradient(0, split-h, 0, split);
        grad.addColorStop(0, clr('viridis', 0.85));
        grad.addColorStop(1, clr('viridis', i/bars));
        ctx.fillStyle = grad;
        ctx.fillRect(i*bw+1, split-h, bw-2, h);
    }
    ctx.fillStyle = 'rgba(170,170,170,0.5)'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('SPECTRUM', 10, 18);
    // Bottom: waveform
    const start = fi*f.hopLength;
    const seg = f.audioArr.subarray(start, Math.min(start+f.hopLength*4, f.nSamples));
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < seg.length; i++) {
        const x = (i/(seg.length-1))*W;
        const y = split + (H-split)*0.1 + seg[i]*(H-split)*0.38;
        i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(170,170,170,0.5)'; ctx.fillText('WAVEFORM', 10, split+18);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0,split); ctx.lineTo(W,split); ctx.stroke();
}

// ── Template 18 — Hexagon Grid ────────────────────────────────────────────────

function t18(ctx, fi, f, W, H) {
    const sp = smooth(f.getSpectrum(fi, 48), 3);
    const cols = 8, rows = 6;
    const hexR = Math.min(W/cols, H/rows)*0.44;
    let idx = 0;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            if (idx >= sp.length) break;
            const cx = (col + (row%2)*0.5 + 0.5) * (W/cols);
            const cy = (row + 0.5) * (H/rows);
            const v = sp[idx];
            ctx.fillStyle = clr('plasma', v);
            ctx.globalAlpha = 0.85;
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
                const a = Math.PI/3*k;
                k===0?ctx.moveTo(cx+hexR*Math.cos(a),cy+hexR*Math.sin(a)):
                      ctx.lineTo(cx+hexR*Math.cos(a),cy+hexR*Math.sin(a));
            }
            ctx.closePath(); ctx.fill();
            if (v > 0.6) {
                ctx.strokeStyle = clr('plasma', v);
                ctx.lineWidth = 1.5; ctx.globalAlpha = 0.4;
                const r2 = hexR*1.35;
                ctx.beginPath();
                for (let k = 0; k < 6; k++) {
                    const a = Math.PI/3*k;
                    k===0?ctx.moveTo(cx+r2*Math.cos(a),cy+r2*Math.sin(a)):
                          ctx.lineTo(cx+r2*Math.cos(a),cy+r2*Math.sin(a));
                }
                ctx.closePath(); ctx.stroke();
            }
            ctx.globalAlpha = 1;
            idx++;
        }
    }
    const fl = beatFlash(fi, f.beatFrames);
    if (fl > 0) {
        ctx.fillStyle = `rgba(0,0,${Math.round(fl*180)},${fl*0.3})`; ctx.fillRect(0,0,W,H);
    }
}

// ── Template 19 — Vinyl Record ────────────────────────────────────────────────

function t19(ctx, fi, f, W, H) {
    const cx = W/2, cy = H/2;
    const rot = fi*0.035;
    const R = Math.min(W,H)*0.44;
    // Grooves
    ctx.strokeStyle = '#1a1a1a';
    for (let r = R*0.27; r <= R*0.96; r += R*0.038) {
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2*Math.PI); ctx.stroke();
    }
    // Spectrum on outer ring
    const bars = 120;
    const sp = smooth(f.getSpectrum(fi, bars), 5);
    for (let i = 0; i < bars; i++) {
        const theta = (i/bars)*2*Math.PI + rot - Math.PI/2;
        const r1 = R*0.97;
        const r2 = r1 + sp[i]*R*0.18;
        ctx.strokeStyle = clr('cool', i/bars);
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(cx+r1*Math.cos(theta), cy+r1*Math.sin(theta));
        ctx.lineTo(cx+r2*Math.cos(theta), cy+r2*Math.sin(theta));
        ctx.stroke();
    }
    // Label
    ctx.fillStyle = '#cc2222';
    ctx.beginPath(); ctx.arc(cx, cy, R*0.24, 0, 2*Math.PI); ctx.fill();
    ctx.fillStyle = '#cc2222';
    ctx.beginPath(); ctx.arc(cx, cy, R*0.05, 0, 2*Math.PI);
    ctx.fillStyle = '#111'; ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = `bold ${R*0.12|0}px serif`; ctx.textAlign = 'center';
    ctx.fillText('♪', cx, cy + R*0.04);
}

// ── Template 20 — Matrix Rain ────────────────────────────────────────────────

function t20(ctx, fi, f, W, H) {
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, W, H);
    const cols = 48, rows = 26;
    const cw = W/cols, rh = H/rows;
    const sp = smooth(f.getSpectrum(fi, cols), 3);
    const chars = '01アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホ'.split('');
    ctx.font = `${(rh*0.75)|0}px monospace`;
    ctx.textAlign = 'center';
    const energy = f.rmsArr[fi];
    for (let c = 0; c < cols; c++) {
        const colE = sp[c];
        const nLit = Math.max(1, (colE * rows * (0.5+energy))|0);
        for (let k = 0; k < Math.min(nLit, rows); k++) {
            const rowSeed = (c*31+k*17+fi*3)&0xFFFF;
            const row = rowSeed % rows;
            const charIdx = (rowSeed*7) % chars.length;
            const alpha = 0.3 + ((rowSeed&0xFF)/255)*0.7;
            const green = 0.35 + colE*0.65;
            ctx.fillStyle = `rgba(0,${Math.round(green*255)},0,${alpha})`;
            ctx.fillText(chars[charIdx], (c+0.5)*cw, (row+0.85)*rh);
        }
        // Bright head
        const headRow = ((fi>>1) + c*3) % rows;
        const headChar = chars[((c+fi)&0xFF) % chars.length];
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.95;
        ctx.fillText(headChar, (c+0.5)*cw, (headRow+0.85)*rh);
        ctx.globalAlpha = 1;
    }
    const fl = beatFlash(fi, f.beatFrames);
    if (fl > 0.05) {
        ctx.fillStyle = `rgba(0,255,0,${fl*0.15})`; ctx.fillRect(0,0,W,H);
    }
}

// ── Registry ──────────────────────────────────────────────────────────────────

const TEMPLATES = [
    { name: 'Classic Equalizer',    fn: t1  },
    { name: 'Circular Waveform',    fn: t2  },
    { name: 'Neon Bars',            fn: t3  },
    { name: 'Waveform Line',        fn: t4  },
    { name: 'Spectrum Tunnel',      fn: t5  },
    { name: 'Mel Heatmap',          fn: t6  },
    { name: 'Starfield Beat',       fn: t7  },
    { name: 'Radial Spectrum',      fn: t8  },
    { name: 'Dual Mirror EQ',       fn: t9  },
    { name: 'RGB Oscilloscope',     fn: t10 },
    { name: 'Lissajous',            fn: t11 },
    { name: 'Chroma Wheel',         fn: t12 },
    { name: 'Frequency Waterfall',  fn: t13 },
    { name: 'Particle Burst',       fn: t14 },
    { name: 'Glitch Bars',          fn: t15 },
    { name: 'Plasma Blob',          fn: t16 },
    { name: 'Spectrum + Waveform',  fn: t17 },
    { name: 'Hexagon Grid',         fn: t18 },
    { name: 'Vinyl Record',         fn: t19 },
    { name: 'Matrix Rain',          fn: t20 },
];

module.exports = { TEMPLATES };
