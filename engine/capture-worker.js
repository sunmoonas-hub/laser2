/*
 * LASER MATCH 장면 수집 일꾼 (재설계 2단계)
 *
 * 메인에서 만든 장면 줄(MediaStreamTrackProcessor의 readable)을 넘겨받아, 카메라 장면을 하나도 빠짐없이 차례로 받는다.
 * 장면마다 표적 주변(ROI)만 원본(I420)으로 복사해 인식 엔진(laser-engine.js)에 넣고, 발 사건만 메인으로 보낸다.
 *  · 메인이 화면 그리기·통신으로 바빠도 장면은 줄에서 기다린다(0단계 측정: 메인을 바쁘게 해도 빠진 장면 0).
 *    지금 앱(rVFC + 화면 전체 그리기 + getImageData)은 읽기만 17~18ms라, 바쁠 때 장면을 건너뛰었다.
 *  · 표적 주변만 복사: 약 0.2ms(0단계 측정), 엔진 약 0.7ms(PC 재생 시험) → 장면 간격 33ms에 넉넉하다.
 *  · 빠진 장면은 카메라가 붙인 장면 시각의 간격으로 확인한다(추정이 아니라 확인).
 *
 * 메시지(메인 → 일꾼)
 *   {cmd:'start', readable, roi:{x,y,w,h}, target:{cx,cy,rx,ry,angle}(ROI 좌표), opts, clip:{on,thrV,thrY}}
 *   {cmd:'target', target}   과녁만 다시 정함(배경은 유지)
 *   {cmd:'clip', on}         장면 묶음 저장 켜기/끄기
 *   {cmd:'stop'}
 * 메시지(일꾼 → 메인)
 *   {shot}  발 사건(엔진 결과 + 장면 번호)
 *   {stat}  1초마다: 장면 수, 장면 속도, 빠진 장면, 복사·엔진 처리 시간(평균·최대)
 *   {clip}  발(또는 레이저처럼 켜진 빛) 앞뒤 장면 묶음(빛 자리 주변 160x160만, x0·y0 = 잘라 낸 위치) - 엔진이 놓친 발을 PC에서 다시 확인하기 위함
 *   stat.flashes = 레이저처럼 갑자기 켜진 빛의 수(엔진이 발로 인정했든 안 했든)
 *   {err}, {ended}
 */
importScripts('laser-engine.js');

let stopped = false, eng = null, clipOn = false;
self.onmessage = e => {
  const m = e.data;
  if (m.cmd === 'stop') { stopped = true; return; }
  if (m.cmd === 'target') { if (eng) eng.setTarget(m.target); return; }
  if (m.cmd === 'clip') { clipOn = !!m.on; return; }
  if (m.cmd === 'start') run(m).catch(err => postMessage({ err: String(err && err.message || err) }));
};

async function run(m) {
  const { x, y, w, h } = m.roi, rect = { x, y, width: w, height: h }, hw = w >> 1, hh = h >> 1;
  eng = self.LaserEngine.createEngine(w, h, m.target, m.opts || {});
  clipOn = !!(m.clip && m.clip.on);
  const thrV = (m.clip && m.clip.thrV) || 14, thrY = (m.clip && m.clip.thrY) || 45;
  const reader = m.readable.getReader(), RING = 6, AFTER = 6;
  let n = 0, lost = 0, lastTs = null, gapMed = 0, statAt = 0, buf = null;
  const gaps = [], cCopy = [], cEng = [];
  let ring = [], prevY = null, prevV = null, clip = null, after = 0, lastTrig = -1e9, flashes = 0, wasLit = false;
  // 장면 전체를 읽을 때 묶음을 통째로 올리면 묶음 하나가 6MB나 된다 → 빛 자리 주변 CxC만 잘라 올린다
  const C = Math.min(160, w & ~1, h & ~1);
  function crop(c) {
    const x0 = Math.max(0, Math.min(w - C, Math.round(c.at[0] - C / 2))) & ~1, y0 = Math.max(0, Math.min(h - C, Math.round(c.at[1] - C / 2))) & ~1, H2 = C >> 1;
    c.frames = c.frames.map(f => {
      const Yc = new Uint8Array(C * C), Vc = new Uint8Array(H2 * H2);
      for (let r = 0; r < C; r++) Yc.set(f.Y.subarray((y0 + r) * w + x0, (y0 + r) * w + x0 + C), r * C);
      for (let r = 0; r < H2; r++) Vc.set(f.V.subarray(((y0 >> 1) + r) * hw + (x0 >> 1), ((y0 >> 1) + r) * hw + (x0 >> 1) + H2), r * H2);
      return { ts: f.ts, dv: f.dv, dy: f.dy, Y: Yc, V: Vc };
    });
    c.x0 = x0; c.y0 = y0; c.w = C; c.h = C; return c;
  }
  while (!stopped) {
    const { value: f, done } = await reader.read();
    if (done || !f) break;
    const ts = f.timestamp / 1000; n++;
    if (lastTs != null) {
      const g = ts - lastTs; gaps.push(g); if (gaps.length > 60) gaps.shift();
      gapMed = gaps.slice().sort((a, b) => a - b)[gaps.length >> 1];
      if (gaps.length >= 10 && g > gapMed * 1.5) lost += Math.round(g / gapMed) - 1;   // 카메라 시각이 한 칸 이상 비면 그만큼 빠진 장면
    }
    lastTs = ts;
    // 표적 주변만 복사. 보통 I420(Y, U, V 3면)이고, 기기에 따라 NV12(Y, UV 섞인 1면)일 수 있어 둘 다 받는다.
    const t0 = performance.now();
    let Y, V;
    try {
      const sz = f.allocationSize({ rect }); if (!buf || buf.length < sz) buf = new Uint8Array(sz);
      const lay = await f.copyTo(buf, { rect });
      Y = new Uint8Array(w * h); V = new Uint8Array(hw * hh);
      const fm = String(f.format || '');
      if (/^(RGB|BGR)/.test(fm)) {
        // 카메라가 아닌 화면 그리기 장면(시험용 가짜 카메라 등)은 RGBA/BGRA로 온다 → 밝기(Y)·빨강 색차(V, BT.601)로 바꾼다
        const bgr = fm[0] === 'B', s0 = lay[0].stride, o0 = lay[0].offset;
        for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
          const p = o0 + r * s0 + c * 4, R = buf[bgr ? p + 2 : p], G = buf[p + 1], B = buf[bgr ? p : p + 2];
          Y[r * w + c] = (77 * R + 150 * G + 29 * B) >> 8;
          if (!(r & 1) && !(c & 1)) V[(r >> 1) * hw + (c >> 1)] = Math.max(0, Math.min(255, 128 + ((128 * R - 107 * G - 21 * B) >> 8)));
        }
      } else {
        for (let r = 0; r < h; r++) Y.set(buf.subarray(lay[0].offset + r * lay[0].stride, lay[0].offset + r * lay[0].stride + w), r * w);
        if (lay.length >= 3) for (let r = 0; r < hh; r++) V.set(buf.subarray(lay[2].offset + r * lay[2].stride, lay[2].offset + r * lay[2].stride + hw), r * hw);
        else for (let r = 0; r < hh; r++) { const o = lay[1].offset + r * lay[1].stride; for (let c = 0; c < hw; c++) V[r * hw + c] = buf[o + c * 2 + 1]; }
      }
    } catch (err) { postMessage({ err: String(err && err.message || err), fmt: f.format }); f.close(); break; }
    f.close();
    const t1 = performance.now();
    const ev = eng.push(ts, Y, V);
    const t2 = performance.now();
    cCopy.push(t1 - t0); cEng.push(t2 - t1);
    for (const s of ev) { s.frameNo = n; postMessage({ shot: s }); }
    // 장면 묶음: 레이저처럼 갑자기 켜진 빛(직전 장면보다 V·Y가 확 오름)이나 엔진이 찾은 발 앞뒤 장면을 모은다
    // 켜짐 신호: 직전 장면 대비 V(빨강 쪽 색차)·Y(밝기)가 가장 크게 오른 값과 그 자리.
    // 엔진이 발로 인정하지 않은 빛도 '빛 켜짐'으로 세어, 엔진이 버린 것인지 카메라에 아예 안 찍힌 것인지 가린다.
    let dv = 0, dy = 0, ai = -1, yi = -1;
    if (prevV) { for (let i = 0; i < V.length; i++) { const d = V[i] - prevV[i]; if (d > dv) { dv = d; ai = i; } } for (let i = 0; i < Y.length; i += 2) { const d = Y[i] - prevY[i]; if (d > dy) { dy = d; yi = i; } } }
    const lit = dv >= thrV || dy >= thrY;
    if (lit && !wasLit) { flashes++; postMessage({ flash: { ts, frameNo: n, dv, dy, vx: ai < 0 ? -1 : (ai % hw) * 2, vy: ai < 0 ? -1 : ((ai / hw) | 0) * 2, yx: yi < 0 ? -1 : yi % w, yy: yi < 0 ? -1 : (yi / w) | 0 } }); }
    wasLit = lit;
    if (clipOn) {
      const fr = { ts, dv, dy, Y, V };
      if (clip) { clip.frames.push(fr); for (const s of ev) clip.events.push(s); if (--after <= 0) { postMessage({ clip: crop(clip) }); clip = null; } }
      else {
        ring.push(fr); if (ring.length > RING) ring.shift();
        if ((lit || ev.length) && ts - lastTrig > 400) {
          // 묶음 가운데 = 빨강이 가장 크게 오른 자리(없으면 밝기, 없으면 엔진 발 자리)
          const at = dv >= thrV ? [(ai % hw) * 2, ((ai / hw) | 0) * 2] : dy >= thrY ? [yi % w, (yi / w) | 0] : [ev[0].x, ev[0].y];
          clip = { trigTs: ts, dv, dy, at, frames: ring.slice(), events: ev.slice() }; ring = []; after = AFTER; lastTrig = ts;
        }
      }
    } else { ring = []; clip = null; }
    prevY = Y; prevV = V;
    if (ts - statAt > 1000) {
      statAt = ts;
      let ls = 0, lc = 0; for (let i = 0; i < Y.length; i += 61) { ls += Y[i]; lc++; }   // 화면 평균 밝기(노출 설정 비교용)
      const avg = a => a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0, mx = a => a.length ? Math.max(...a) : 0;
      postMessage({ stat: { lum: Math.round(ls / lc), n, lost, fps: gapMed ? Math.round(10000 / gapMed) / 10 : 0, copyAvg: avg(cCopy), copyMax: mx(cCopy), engAvg: avg(cEng), engMax: mx(cEng), flashes, eng: eng.stats() } });
      cCopy.length = 0; cEng.length = 0;
    }
  }
  try { reader.cancel(); } catch (_) {}
  postMessage({ ended: true, n, lost });
}
