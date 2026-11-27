/*
 * 교내 리그전(학급 릴레이) 점수·순위 계산 — control.html(컨트롤 타워)과 board.html(전광판)이 함께 쓴다.
 * 두 화면이 같은 계산을 써야 발표 순위와 운영 화면 순위가 어긋나지 않는다.
 *
 * 규칙(2026 교내 리그전 계획서):
 *  - 사격 점수 = 발별 점수 합(소수점 또는 정수, 대회 설정의 채점 방식)
 *  - 시간 보너스 = (제한 시간 − 완료 시간[초]) × 보너스(점/초) — 팀 발수를 모두 쐈을 때만
 *  - 동점: 최종 점수 → 사격 점수 → (정수 채점 시) 10점 개수 → 9점 개수 → 그래도 같으면 학급 대표 1발 슛오프
 *    (컨트롤 타워 [슛오프]. 점수는 row.so = {슛오프키: 점수}에 담기고, 같은 슛오프를 쏜 학급끼리 순서대로 비교한다. 또 같으면 다시 슛오프)
 */
(function () {
  'use strict';
  function shotsOf(d) { const s = d && d.shots; return Array.isArray(s) ? s.filter(Boolean) : (s && typeof s === 'object' ? Object.keys(s).sort((a, b) => a - b).map(k => s[k]) : []); }
  function shotVal(s, dec) { return dec ? (Number(s.sd != null ? s.sd : s.si) || 0) : (Number(s.si) || 0); }

  // 한 사로(한 학급)의 경기 기록 d(태블릿이 runs/{경기ID}/{사로}에 남긴 값) → 점수 요약
  function laneResult(d, rule, cfg) {
    const dec = cfg.scoring !== 'int', shots = shotsOf(d).slice(0, rule.shots);
    let shoot = 0, tens = 0, nines = 0;
    for (const s of shots) { shoot += shotVal(s, dec); const i = Number(s.si) || 0; if (i === 10) tens++; else if (i === 9) nines++; }
    shoot = Math.round(shoot * 10) / 10;
    const complete = !!d && shots.length >= rule.shots && !d.timeUp && d.finishMs != null;
    const finishSec = complete ? Math.round(Number(d.finishMs) / 100) / 10 : null;   // 0.1초 단위
    const bonus = complete ? Math.round(Math.max(0, rule.limit - finishSec) * cfg.bonus * 100) / 100 : 0;
    return { n: shots.length, shoot, tens, nines, complete, timeUp: !!(d && d.timeUp), finishSec, bonus, final: Math.round((shoot + bonus) * 100) / 100, missing: !d };
  }

  // rows: [{cls, ...laneResult}] → 순위(rank)·동점(tie) 표시 후 정렬해서 돌려준다
  function rank(rows, cfg) {
    const dec = cfg.scoring !== 'int';
    // 슛오프: 두 학급이 함께 쏜 슛오프만 비교한다(슛오프 키 = 시간 순서). 하나라도 점수가 다르면 그 슛오프로 정한다.
    const soCmp = (a, b) => { const A = a.so || {}, B = b.so || {}; for (const k of Object.keys(A).sort()) if (k in B && A[k] !== B[k]) return B[k] - A[k]; return 0; };
    const cmp = (a, b) => b.final - a.final || b.shoot - a.shoot || (dec ? 0 : (b.tens - a.tens || b.nines - a.nines)) || soCmp(a, b);
    rows.sort(cmp);
    rows.forEach((r, i) => { r.rank = i + 1; r.tie = false; });
    for (let i = 1; i < rows.length; i++) if (cmp(rows[i - 1], rows[i]) === 0) { rows[i].rank = rows[i - 1].rank; rows[i].tie = rows[i - 1].tie = true; }
    return rows;
  }

  function fmt(v, dec) { return v == null ? '-' : (dec ? Number(v).toFixed(1) : String(v)); }
  function fmt2(v) { return v == null ? '-' : (Math.round(v * 100) % 10 ? Number(v).toFixed(2) : Number(v).toFixed(1)); }

  window.LeagueCalc = { shotsOf, laneResult, rank, fmt, fmt2 };
})();
