/*
 * LASER MATCH 새 인식 엔진 (재설계 1단계)
 *
 * - 화면(DOM)·캔버스·통신을 전혀 모르는 순수 계산 모듈. 태블릿의 일꾼 스레드(Web Worker)와
 *   PC 재생 시험(tools/replay.js, Node)에서 똑같이 돌아간다.
 * - 입력: 카메라 원본(I420)에서 표적 주변만 잘라 낸 장면. Y(밝기, w×h)와 U·V(색차, w/2×h/2).
 *   좌표는 모두 "잘라 낸 영역(ROI) 기준 픽셀"이다. 화면 배치와 무관하다.
 * - 출력: 발 사건 {ts, x, y, cx, cy, nr, si, sd, frames, size, len} (ts = 카메라가 붙인 장면 시각, ms. x,y = 탄착점(시작점), cx,cy = 빛 덩어리 전체 중심(비교용))
 *
 * 녹화 분석(docs/태블릿_구조분석.md 3-2)에서 확인한 사실을 그대로 규칙으로 쓴다.
 *  · 레이저는 약 5ms만 켜져 대부분 장면 1장(가끔 2장)에만 찍힌다 → 1~2장짜리 '갑자기 켜진 빛'만 발로 본다.
 *  · 빨강은 V(색차)가 크게 오른다(실제 발 21~110). 쏘지 않은 장면은 2~3. 중심은 하얗게 포화돼 V가 약할 수 있어 Y도 함께 본다.
 *  · 총이 튀면 세로로 긴 줄(최대 60px)로 찍힌다. 줄의 아래쪽 끝에 둥글고 두꺼운 점이 있고, 그 점이 맨 처음 찍힌 자리다
 *    (2장에 걸친 발은 모두 첫 장면이 아래, 다음 장면이 위였다. 088·100·141은 첫 장면에 점만, 다음 장면에 위로 뻗은 줄).
 *    → 탄착점 = 처음 켜진 장면의 빛 덩어리 중 '시작점 쪽 끝 8줄'의 중심(밝기 가중). 짧은 점은 덩어리 전체 중심과 같다.
 *  · 빠른 연사는 0.42초 간격까지 나온다 → 발과 발 사이 잠금은 아주 짧게.
 *  · 녹화 시작 직후 색 변화 없이 밝기만 오르는 장면(카메라 재조정)이 있었다 → V가 안 오른 빛, 넓은 범위의 변화는 발이 아니다.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    // 씨앗 픽셀: V가 배경보다 이만큼 이상 오름. 녹화 시험(156개 묶음)에서 쏘지 않은 장면은 최대 3,
    // 18로 두면 가운데가 흐린 실제 발 1개(049, V+28)를 놓쳤고 15/8로 낮춰도 가짜 발은 0이었다.
    seedV: 15,
    seedNoiseK: 5,      // ...그리고 그 픽셀 평소 V 흔들림의 5배 이상
    seedOnsetV: 8,      // ...직전 장면보다도 이만큼 이상 오름(갑자기 켜짐)
    seedY: 15,          // ...밝기도 조금은 올라야 함
    blobY: 30,          // 빛 덩어리에 넣을 픽셀: 밝기 상승
    blobV: 6,           //   + 색 상승(약하게라도 빨강 쪽)
    blobSatY: 70,       //   또는 밝기가 크게 오른 포화 픽셀(색이 약해도 레이저 중심부)
    // 빨강이 아주 크게 오르면 밝기가 안 올라도 레이저로 본다(씨앗·덩어리 모두).
    // 밝은 종이 위에서는 레이저 가장자리의 빨강이 종이보다 어두워(밝기 −76, V +108) 밝기 조건으로는 씨앗이 안 생겼다(PC 시험).
    // 쏘지 않은 장면의 V 흔들림은 최대 3, 색 없이 밝기만 오른 장면도 V+2~3이라 30이면 충분히 떨어져 있다.
    strongV: 30,
    growR: 2,           // 씨앗 주변으로 빛 덩어리를 넓힐 때 한 번에 보는 거리(px)
    minBlob: 2,         // 빛 덩어리 최소 크기(px) - 더 작으면 잡음. 4로 두면 멀리서 찍힌 흐린 점(2~3px)을 놓쳤다.
                        //   2로 낮춰도 녹화 재생(쏘지 않은 장면 35개)·2차 태블릿 시험(밝기만 바뀐 장면 36개)에서 가짜 발 0
    maxLitFrames: 3,    // 이 장면 수보다 오래 켜져 있으면 레이저가 아니라 장면 변화(조명·그림자·사람)
    mergeDist: 80,      // 이어진 두 장면의 빛이 이 거리 안이면 같은 발(2장에 걸친 발, 줄 길이 최대 60px)
    lockoutMs: 120,     // 한 발 직후 이 시간 안의 새 빛은 같은 발의 잔광으로 본다(연사 최소 간격 420ms보다 충분히 짧게)
    globalFrac: 0.08,   // 표적 영역의 이 비율 이상이 한꺼번에 바뀌면 화면 전체 변화(흔들림·노출 변경)로 본다
    globalDY: 25,
    bgRate: 0.05,       // 배경 따라가기 비율(평소)
    bgFastRate: 0.3,    // 화면 전체가 바뀌었을 때 빠르게 따라가기
    noiseRate: 0.05,
    warmupFrames: 4,    // 처음 이만큼은 배경만 잡는다
    missLimit: 1.8,     // 바깥 원 반지름의 1.8배 밖은 무시(지금 앱과 같음)
    // 탄착점: 줄의 어느 끝을 시작점으로 볼지. 'bottom'(장면 아래쪽 = y가 큰 쪽) | 'top' | 'center'(덩어리 전체 중심).
    // 녹화(사로 6, 126발)에서 총은 항상 위로 튀었다 → 'bottom'. 장면이 위아래 뒤집혀 들어오는 설치라면 'top'.
    // 긴 줄(20px 이상) 36발에서 중심 대비 평균 1.3점, 최대 5.8점 차이. 짧은 점 90발은 평균 0.03점 차이.
    startEnd: 'bottom',
    startRows: 8        // 시작점 쪽 끝에서 이만큼의 줄(px)만 탄착점 계산에 쓴다(둥근 점 지름 약 5~8px)
  };

  // target: {cx, cy, rx, ry, angle} - ROI 좌표의 과녁(바깥 원 = 1점 원 테두리)
  function createEngine(w, h, target, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const hw = w >> 1, hh = h >> 1, n = w * h, nh = hw * hh;
    const bgY = new Float32Array(n), bgV = new Float32Array(nh), nzV = new Float32Array(nh).fill(2);
    const prevV = new Uint8Array(nh);
    const inScan = new Uint8Array(n), inScanH = new Uint8Array(nh);
    const mark = new Uint8Array(n), stack = new Int32Array(n), accP = new Int32Array(n), accW = new Float32Array(n);
    let tgt = null, frames = 0, pending = null, lastShotTs = -1e9, scanCount = 0;
    const st = { frames: 0, globalSkips: 0, rejectedLong: 0, rejectedSmall: 0, shots: 0 };

    function setTarget(t) {
      tgt = Object.assign({ angle: 0 }, t);
      const ca = Math.cos(tgt.angle), sa = Math.sin(tgt.angle), L = o.missLimit + 0.1;
      scanCount = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = x - tgt.cx, dy = y - tgt.cy, ex = (dx * ca + dy * sa) / tgt.rx, ey = (-dx * sa + dy * ca) / tgt.ry;
        const ins = ex * ex + ey * ey <= L * L ? 1 : 0; inScan[y * w + x] = ins; scanCount += ins;
      }
      for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) inScanH[y * hw + x] = inScan[(y * 2) * w + x * 2];
    }
    setTarget(target);

    // 과녁 좌표 → 점수. 정수는 지금 앱과 같은 경계선 여유(.15), 소수점은 내림하면 정수와 같도록.
    function scoreAt(x, y) {
      const dx = x - tgt.cx, dy = y - tgt.cy, ca = Math.cos(tgt.angle), sa = Math.sin(tgt.angle);
      const u = (dx * ca + dy * sa) / tgt.rx, v = (-dx * sa + dy * ca) / tgt.ry, nr = Math.hypot(u, v), rp = nr * 10;
      const si = nr > 1.015 ? 0 : Math.min(10, Math.max(1, 10 - Math.floor(rp - 0.15)));
      const sd = nr > 1.015 ? 0 : Math.min(10.9, Math.max(1, Math.floor((11.15 - rp) * 10) / 10));
      return { nr, si, sd, u, v };
    }

    // 이번 장면에서 '갑자기 켜진 빨간 빛 덩어리'들을 찾는다.
    function findBlobs(Y, V) {
      const blobs = [];
      mark.fill(0);
      for (let i = 0; i < nh; i++) {
        if (!inScanH[i]) continue;
        const dv = V[i] - bgV[i];
        if (dv < o.seedV || dv < o.seedNoiseK * nzV[i] || V[i] - prevV[i] < o.seedOnsetV) continue;
        // 씨앗 자리 = 색차 칸(2x2) 안에서 밝기가 가장 많이 오른 픽셀. 멀리서 찍혀 1~2픽셀뿐인 흐린 점은
        // 칸의 왼쪽 위 픽셀만 보면 밝기가 안 오른 것처럼 보여 놓쳤다(2차 태블릿 시험, V+19·23 두 발).
        const bx = (i % hw) * 2, by = ((i / hw) | 0) * 2;
        let p0 = by * w + bx, bd = -1e9;
        for (let q = 0; q < 4; q++) { const xx = bx + (q & 1), yy = by + (q >> 1); if (xx >= w || yy >= h) continue; const pq = yy * w + xx, d = Y[pq] - bgY[pq]; if (d > bd) { bd = d; p0 = pq; } }
        if (mark[p0] || (bd < o.seedY && dv < o.strongV)) continue;
        // 씨앗에서 시작해 이웃으로 빛 덩어리를 넓힌다(밝기가 오르고 색이 빨강 쪽이거나, 밝기가 크게 오른 포화 픽셀)
        let sp = 0, cnt = 0, sw = 0, sx = 0, sy = 0, minY = 1e9, maxY = -1, minX = 1e9, maxX = -1, maxDV = 0;
        let cc = 0, cw = 0, cxs = 0, cys = 0, cMinY = 1e9, cMaxY = -1;   // 중심부(예전 규칙) 픽셀만 따로: 탄착점 계산용
        stack[sp++] = p0; mark[p0] = 1;
        while (sp) {
          const p = stack[--sp], x = p % w, y = (p / w) | 0;
          const dY = Y[p] - bgY[p], ph = (y >> 1) * hw + (x >> 1), dV = V[ph] - bgV[ph];
          // 중심부: 밝기가 오르고 색이 빨강 쪽이거나, 밝기가 크게 오른 포화 픽셀
          const core = (dY >= o.blobY && dV >= o.blobV) || dY >= o.blobSatY || p === p0;
          // 가장자리: 빨강만 크게 오른 픽셀(밝은 종이 위 레이저 가장자리), 빨강이 씨앗만큼 오르고 어두워지지 않은 픽셀(흐린 작은 점).
          // 발을 찾는 데(크기·이어짐)만 쓰고 탄착점 계산에는 넣지 않는다 - 넣었더니 녹화 재생에서 점수가 발마다 0.1~0.9 흔들렸다.
          const inBlob = core || dV >= o.strongV || (dV >= o.seedV && dY >= 0);
          if (!inBlob) continue;
          const wt = Math.max(1, dY) + Math.max(0, dV) * 2;
          if (core) { cc++; cw += wt; cxs += x * wt; cys += y * wt; if (y < cMinY) cMinY = y; if (y > cMaxY) cMaxY = y; }
          accP[cnt] = p; accW[cnt] = core ? wt : 0; cnt++; sw += wt; sx += x * wt; sy += y * wt; if (dV > maxDV) maxDV = dV;
          if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x;
          for (let oy = -o.growR; oy <= o.growR; oy++) for (let ox = -o.growR; ox <= o.growR; ox++) {
            const nx = x + ox, ny = y + oy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx; if (mark[q] || !inScan[q]) continue; mark[q] = 1; stack[sp++] = q;
          }
        }
        if (cnt < o.minBlob) { st.rejectedSmall++; continue; }
        // 탄착점은 중심부 픽셀로(중심부가 1개뿐인 아주 흐린 점이면 덩어리 전체로). 시작점: 줄의 시작 쪽 끝 startRows줄만 모아 중심을 낸다
        const useCore = cc >= 2;
        if (!useCore) for (let j = 0; j < cnt; j++) { const p = accP[j], y = (p / w) | 0, dY = Y[p] - bgY[p], dV = V[(y >> 1) * hw + ((p % w) >> 1)] - bgV[(y >> 1) * hw + ((p % w) >> 1)]; accW[j] = Math.max(1, dY) + Math.max(0, dV) * 2; }
        const bw = useCore ? cw : sw, bxs = useCore ? cxs : sx, bys = useCore ? cys : sy, bMinY = useCore ? cMinY : minY, bMaxY = useCore ? cMaxY : maxY;
        let tx = bxs / bw, ty = bys / bw;
        if (o.startEnd !== 'center') {
          const lo = o.startEnd === 'top' ? bMinY : bMaxY - o.startRows + 1, hi = o.startEnd === 'top' ? bMinY + o.startRows - 1 : bMaxY;
          let w2 = 0, x2 = 0, y2 = 0;
          for (let j = 0; j < cnt; j++) { const p = accP[j], y = (p / w) | 0; if (y < lo || y > hi) continue; w2 += accW[j]; x2 += (p % w) * accW[j]; y2 += y * accW[j]; }
          if (w2 > 0) { tx = x2 / w2; ty = y2 / w2; }
        }
        blobs.push({ x: tx, y: ty, cx: bxs / bw, cy: bys / bw, e: sw, size: cnt, len: Math.max(maxY - minY, maxX - minX) + 1, maxDV });
      }
      return blobs;
    }

    function learn(Y, V, rate, skip) {
      for (let i = 0; i < n; i++) if (!skip || !skip[i]) bgY[i] += (Y[i] - bgY[i]) * rate;
      for (let i = 0; i < nh; i++) {
        const d = Math.abs(V[i] - bgV[i]), cap = nzV[i] * 3 + 4;
        nzV[i] += (Math.min(d, cap) - nzV[i]) * o.noiseRate;
        const p = ((i / hw) | 0) * 2 * w + (i % hw) * 2;
        if (!skip || !skip[p]) bgV[i] += (V[i] - bgV[i]) * rate;
      }
    }

    // 장면 하나를 넣는다. 발이 확정되면 발 사건 배열을 돌려준다(보통 빈 배열).
    function push(ts, Y, V) {
      st.frames++; frames++;
      const events = [];
      if (frames <= o.warmupFrames) {   // 처음 몇 장: 배경을 바로 그 장면들로 맞춘다
        if (frames === 1) { for (let i = 0; i < n; i++) bgY[i] = Y[i]; for (let i = 0; i < nh; i++) bgV[i] = V[i]; }
        else learn(Y, V, 0.5);
        prevV.set(V); return events;
      }
      // 화면 전체 변화(흔들림·노출 변경·사람이 가림): 넓은 범위가 한꺼번에 바뀌면 이 장면은 판정하지 않고 배경만 빠르게 따라간다
      let changed = 0;
      for (let p = 0; p < n; p += 3) if (inScan[p] && Math.abs(Y[p] - bgY[p]) > o.globalDY) changed++;
      if (changed * 3 > scanCount * o.globalFrac) {
        st.globalSkips++; pending = null; learn(Y, V, o.bgFastRate); prevV.set(V); return events;
      }
      const blobs = findBlobs(Y, V);
      // 가장 큰(에너지가 큰) 빛 덩어리 하나를 이번 장면의 후보로 본다(한 사로에 동시에 두 발은 없음)
      const b = blobs.length ? blobs.reduce((a, c) => c.e > a.e ? c : a) : null;
      if (b) {
        if (pending && Math.hypot(b.x - pending.x, b.y - pending.y) <= o.mergeDist) {
          // 이어진 장면에 또 보임: 같은 발(2장에 걸침)로 합친다. 탄착점은 첫 장면의 시작점 그대로(다음 장면은 총이 튄 뒤의 자취)
          const E = pending.e + b.e;
          pending.cx = (pending.cx * pending.e + b.cx * b.e) / E; pending.cy = (pending.cy * pending.e + b.cy * b.e) / E;
          pending.e = E; pending.frames++; pending.size += b.size; pending.len = Math.max(pending.len, b.len); pending.maxDV = Math.max(pending.maxDV, b.maxDV);
          if (pending.frames > o.maxLitFrames) { st.rejectedLong++; pending.dead = true; }
        } else if (!pending) {
          if (ts - lastShotTs > o.lockoutMs) pending = { ts, x: b.x, y: b.y, cx: b.cx, cy: b.cy, e: b.e, frames: 1, size: b.size, len: b.len, maxDV: b.maxDV };
        }
      } else if (pending) {
        // 빛이 사라졌다 → 1~3장만 켜졌던 빛이면 발로 확정
        if (!pending.dead) {
          const s = scoreAt(pending.x, pending.y);
          if (s.nr <= o.missLimit) {
            events.push({ ts: pending.ts, x: pending.x, y: pending.y, cx: pending.cx, cy: pending.cy, nr: s.nr, si: s.si, sd: s.sd, frames: pending.frames, size: pending.size, len: pending.len, maxDV: pending.maxDV });
            st.shots++; lastShotTs = pending.ts;
          }
        }
        pending = null;
      }
      // 배경 학습: 빛 덩어리 자리는 제외(레이저가 배경에 섞이지 않게)
      learn(Y, V, o.bgRate, b ? mark : null);
      prevV.set(V);
      return events;
    }

    return { push, setTarget, scoreAt, stats: () => Object.assign({}, st), options: o };
  }

  const api = { createEngine, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LaserEngine = api;
})(typeof self !== 'undefined' ? self : this);
