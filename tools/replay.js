#!/usr/bin/env node
/*
 * 재생 시험 도구 (재설계 1단계)
 * camlab.html로 녹화한 장면 묶음(clips.json)을 새 인식 엔진(engine/laser-engine.js)에 그대로 넣어 결과를 집계한다.
 * 학생·태블릿 없이 PC에서 같은 장면으로 몇 번이든 다시 시험할 수 있다.
 *
 * 사용: node tools/replay.js <clips.json> <meta.json 또는 JSON 문자열> [확인용PNG경로]
 *   - clips.json : Firebase {LEAGUE_ROOT}/camlab/rec/{세션}/clips 를 내려받은 파일
 *   - meta       : 같은 세션의 meta(roi: 과녁 중심 cx,cy·반지름 r·잘라 낸 영역 x,y,w,h)
 *   - PNG        : 발마다 레이저 장면을 잘라 탄착점(초록 +)과 '가장 센 빨강 픽셀'(빨강 ×, 지금 앱 방식)을 표시한 모음 이미지
 */
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { createEngine } = require(path.join(__dirname, '..', 'engine', 'laser-engine.js'));

const [clipsPath, metaArg, pngPath] = process.argv.slice(2);
if (!clipsPath || !metaArg) { console.error('사용: node tools/replay.js <clips.json> <meta.json|JSON> [out.png]'); process.exit(1); }
const meta = JSON.parse(fs.existsSync(metaArg) ? fs.readFileSync(metaArg, 'utf8') : metaArg);
const clips = JSON.parse(fs.readFileSync(clipsPath, 'utf8'));
const roi = meta.roi, target = { cx: roi.cx - roi.x, cy: roi.cy - roi.y, rx: roi.r, ry: roi.r, angle: 0 };
const dec = b => new Uint8Array(Buffer.from(b, 'base64'));

const results = [];
let tProc = 0, nProc = 0;
for (const k of Object.keys(clips).sort()) {
  const c = clips[k];
  const frames = c.frames.map(f => ({ ts: f.ts, Y: dec(f.y), V: dec(f.v) }));
  // 묶음마다 엔진을 새로 만들므로, 배경 잡기(warm-up)는 '촉발 장면 앞의 장면들'로만 한다.
  // (빠른 연사 직후의 묶음은 앞 장면이 1~3장뿐이라, 기본값 4장으로 두면 레이저 장면이 배경 잡기에 들어가 버린다.
  //  실제 태블릿은 사격 몇 초 전에 한 번만 배경을 잡으므로 이 문제가 없다.)
  const trigIdx = Math.max(1, frames.findIndex(f => Math.abs(f.ts - c.trigTs) < 1));
  const eng = createEngine(c.w, c.h, target, { warmupFrames: Math.max(1, Math.min(4, trigIdx)) });
  const shots = [];
  frames.forEach((f, i) => { const t0 = process.hrtime.bigint(); const ev = eng.push(f.ts, f.Y, f.V); tProc += Number(process.hrtime.bigint() - t0) / 1e6; nProc++; ev.forEach(e => shots.push(Object.assign({ fi: i }, e))); });
  // 비교용: 각 장면에서 'V가 가장 크게 오른 픽셀'(지금 앱이 탄착점으로 쓰는 방식에 해당)
  results.push({ k, kind: c.kind, trigDV: c.dv, shots, stats: eng.stats(), frames, w: c.w, h: c.h });
}

// ---- 집계 ----
const shotClips = results.filter(r => r.kind === 'shot'), quiet = results.filter(r => r.kind === 'quiet');
const hist = a => { const m = {}; a.forEach(x => { m[x] = (m[x] || 0) + 1; }); return m; };
console.log(`장면 묶음 ${results.length}개 (발 촉발 ${shotClips.length}, 조용한 장면 ${quiet.length}) · 엔진 처리 평균 ${(tProc / nProc).toFixed(3)}ms/장`);
console.log('발 촉발 묶음에서 엔진이 찾은 발 수 분포:', JSON.stringify(hist(shotClips.map(r => r.shots.length))));
console.log('조용한 장면에서 찾은 발 수(0이어야 함):', JSON.stringify(hist(quiet.map(r => r.shots.length))));
const byTrig = { '촉발 V<15': [], '15~20': [], '20~40': [], '40+': [] };
for (const r of shotClips) (r.trigDV < 15 ? byTrig['촉발 V<15'] : r.trigDV < 20 ? byTrig['15~20'] : r.trigDV < 40 ? byTrig['20~40'] : byTrig['40+']).push(r.shots.length);
for (const [g, a] of Object.entries(byTrig)) console.log(`  녹화 촉발 세기 ${g}: 묶음 ${a.length}개, 발 찾음 ${a.filter(x => x > 0).length}개`, JSON.stringify(hist(a)));
const all = shotClips.flatMap(r => r.shots);
console.log('찾은 발:', all.length, '· 장면 수(1장/2장/3장):', JSON.stringify(hist(all.map(s => s.frames))), '· 빛 덩어리 길이 25px 이상:', all.filter(s => s.len >= 25).length);
console.log('점수(소수점) 분포:', JSON.stringify(hist(all.map(s => Math.floor(s.sd)))));
const gs = results.reduce((a, r) => { a.global += r.stats.globalSkips; a.long += r.stats.rejectedLong; a.small += r.stats.rejectedSmall; return a; }, { global: 0, long: 0, small: 0 });
console.log('화면 전체 변화로 건너뛴 장면:', gs.global, '· 오래 켜져 버린 빛:', gs.long, '· 너무 작아 버린 빛:', gs.small);
console.log('발을 못 찾은 촉발 묶음:', shotClips.filter(r => !r.shots.length).map(r => `${r.k}(V+${r.trigDV})`).join(' '));
console.log('발을 2개 이상 찾은 묶음:', shotClips.filter(r => r.shots.length > 1).map(r => `${r.k}:` + r.shots.map(s => `${Math.round(s.ts)}ms ${s.sd}`).join('/')).join(' | '));

// ---- 확인용 이미지 ----
if (pngPath) {
  const tiles = [];
  for (const r of shotClips) for (const s of r.shots) {
    const f = r.frames[s.fi - 1] || r.frames[s.fi];   // 발이 확정된 건 빛이 사라진 다음 장면 → 빛이 찍힌 건 그 앞 장면
    // 지금 앱 방식(가장 센 빨강 픽셀)도 같은 장면에서 찾아 비교 표시
    let px = -1, py = -1, best = -1; const V0 = r.frames[0].V, hw = r.w >> 1;
    for (let i = 0; i < f.V.length; i++) { const d = f.V[i] - V0[i]; if (d > best) { best = d; px = (i % hw) * 2; py = ((i / hw) | 0) * 2; } }
    tiles.push({ r, s, f, px, py });
  }
  const T = 96, cols = 10, rows = Math.ceil(tiles.length / cols), W = cols * T, H = rows * T, img = Buffer.alloc(W * H * 3);
  tiles.forEach((t, idx) => {
    const ox = (idx % cols) * T, oy = ((idx / cols) | 0) * T, cx = Math.round(t.s.x), cy = Math.round(t.s.y);
    for (let yy = 0; yy < T; yy++) for (let xx = 0; xx < T; xx++) {
      const sx = cx - T / 2 + xx, sy = cy - T / 2 + yy, o = ((oy + yy) * W + ox + xx) * 3;
      if (sx < 0 || sy < 0 || sx >= t.r.w || sy >= t.r.h) continue;
      const Yv = t.f.Y[sy * t.r.w + sx], Vv = t.f.V[(sy >> 1) * (t.r.w >> 1) + (sx >> 1)] - 128, Uv = 0;
      img[o] = Math.max(0, Math.min(255, Yv + 1.4 * Vv)); img[o + 1] = Math.max(0, Math.min(255, Yv - 0.71 * Vv - 0.34 * Uv)); img[o + 2] = Math.max(0, Math.min(255, Yv));
    }
    const put = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= T || y >= T) return; const o = ((oy + y) * W + ox + x) * 3; img[o] = r; img[o + 1] = g; img[o + 2] = b; };
    for (let d = -5; d <= 5; d++) { put(T / 2 + d, T / 2, 0, 255, 0); put(T / 2, T / 2 + d, 0, 255, 0); }   // 새 엔진 탄착점(초록 +)
    const qx = t.px - cx + T / 2, qy = t.py - cy + T / 2; for (let d = -3; d <= 3; d++) { put(qx + d, qy + d, 255, 40, 40); put(qx + d, qy - d, 255, 40, 40); }   // 가장 센 빨강 픽셀(빨강 ×)
    // 과녁 중심 방향 표시(타일 테두리 위 노란 점): 탄착점에서 과녁 중심 쪽
    const ang = Math.atan2(target.cy - t.s.y, target.cx - t.s.x); put(Math.round(T / 2 + Math.cos(ang) * 44), Math.round(T / 2 + Math.sin(ang) * 44), 255, 220, 0);
  });
  const raw = Buffer.alloc((W * 3 + 1) * H); for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; img.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const crc = (buf) => { let c, crcT = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } let x = 0xffffffff; for (const b of buf) x = crcT[(x ^ b) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(pngPath, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  console.log('확인용 이미지:', pngPath, `(${tiles.length}발, ${W}x${H})`);
}
