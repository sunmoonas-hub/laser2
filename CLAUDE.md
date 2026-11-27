# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 개요

LASER MATCH는 학교 레이저 사격 경기 채점 시스템입니다(코드 주석과 화면 문구는 한국어). GitHub Pages로 제공하는 정적 사이트라서 빌드, 패키지 관리자, 테스트, 린터가 없습니다. 페이지마다 CSS와 IIFE `<script>`가 들어 있는 HTML 파일 하나로 되어 있습니다. Firebase는 gstatic CDN에서 불러옵니다(compat SDK 10.12.2). 커밋은 `main`에 바로 올리고, 푸시하면 사이트에 바로 반영됩니다.

로컬에서 확인하려면 폴더를 HTTP로 띄워 Chrome에서 엽니다. `getUserMedia`는 보안 출처에서만 동작하므로 localhost(예: `python -m http.server`)나 배포된 Pages 주소를 써야 합니다. `file://`로 열면 카메라가 동작하지 않습니다.

## 파일

- `index.html`: 사대 태블릿 앱입니다. 휴대폰·태블릿 카메라를 읽어 동심원 표적을 자동 보정하고, 레이저 명중을 인식해 점수를 매기고, 결과를 저장합니다. 주소에 `?lane=N`(1–7)을 붙이면 그 사로로 고정됩니다.
- `live.html`: 관전·운영 화면(크롬북)입니다. 사로, 경기 방식(개인전 10발 / 단체전 20발), 학급, 학생 또는 팀을 고르고 시작·취소·다시 시작 명령을 보냅니다. 실시간 탄착과 지난 기록도 보여 줍니다.
- `config.js`: 두 페이지가 함께 읽는 설정 파일이며 `window.LASER_CONFIG`로 불러옵니다. `APPS_SCRIPT_URL`(Apps Script 웹앱 `/exec` 주소)과 Firebase 웹 설정이 들어 있습니다. 주소는 HTML이 아니라 이 파일에서 바꿉니다.
- Google Apps Script 서버 코드(`Code.gs`, `appsscript.json`)는 **이 저장소에 없습니다.** 따로 배포되어 있고 Google Sheets에 기록을 씁니다.

`README.md`는 내용 일부가 예전 그대로입니다. `APPS_SCRIPT_URL`을 `index.html` 안에서 고치라고 되어 있지만, 지금은 `config.js`에 있습니다.

## 구조: 두 페이지가 주고받는 방법

통신 경로는 두 가지입니다.

1. **Firebase Realtime Database**(익명 로그인): 태블릿과 관전 화면 사이의 실시간 데이터입니다.
   - `lanes/{사로}`: 태블릿이 `pushLive()`로 올리는 사로 상태입니다. 탄착, 진행 여부, 접속 상태(`onDisconnect`), 저장 상태가 들어 있습니다. 관전 화면이 `cleared: true`로 사로를 정리할 수 있고, 태블릿은 다시 연결될 때 이 값을 확인합니다.
   - `cmds/{사로}`: 관전 화면이 태블릿에 보내는 명령입니다. `start`는 트랜잭션으로 쓰고 `start/ack`로 응답을 받습니다. `events`와 `end`도 있습니다. `CMD_MAX_AGE_MS`보다 오래된 시작 명령은 실행하지 않습니다.
   - `viewers/{사로}/{viewerId}`: 관전 화면 접속 상태입니다. 한 사로를 두 화면이 동시에 조작하면 경고하는 데 씁니다.
   - `results/{경기ID}`: 끝난 경기 중 아직 시트에 기록되지 않은 결과입니다. `synced/{경기ID}`에는 시트 기록 결과가 남습니다. `signals/drafts/{학급}`이 바뀌면 관전 화면이 임시 기록을 다시 불러옵니다.
2. **Apps Script JSONP 호출**(`jsonp(action, params)`가 `<script>` 태그를 넣어 호출): 액션은 `roster`, `saveLaserMatch`, `studentHistory`, `teamHistory`, `drafts`, `leaderboard`, `diag`입니다. `isServerConfigured()`/`serverReady()`가 주소가 `/exec` 형식인지 확인합니다.

**저장 흐름**(`index.html`의 `saveMatch`): 결과를 localStorage 보관함(`laserOutbox`)과 Firebase `results/{id}`에 넣고, 동시에 `saveLaserMatch`로 시트에 바로 저장을 시도합니다(최대 3번 재시도). 바로 저장이 실패해도 Apps Script가 1분마다 대기 중인 `results/`를 가져가 기록합니다. 같은 경기ID는 한 번만 남습니다. `SAVE_DEFINITE`에 맞는 오류는 다시 해도 같은 결과인 거절이라, 재시도하지 않고 대기 목록에서 뺍니다. 끝난 경기의 마지막 발을 취소하면 `withdrawResult`가 대기 중인 결과를 거둬들입니다. `saveToken`은 이미 무효가 된 비동기 응답을 걸러냅니다.

평가 종류 중 `practice`와 `eval`만 저장하고, 나머지(영점 조준)는 저장하지 않습니다.

## 인식 과정(index.html)

- `findConcentricTarget`/`detectTarget`: 표적 자동 보정입니다. 표적 위치는 영상 기준 비율 좌표(`state.targetVideo`)로 저장되어, 화면 크기가 바뀌거나 전체화면이 되어도 유지됩니다(`saveTargetToVideo`/`restoreTargetFromVideo`).
- `processFrames` → `detectLaserCore`: 숨겨진 `work` 캔버스에서 영상을 `ANALYSIS_WIDTH`로 줄이고, 색 채널별로 계속 갱신되는 배경과 비교합니다. 후보·래치 판정을 거쳐 `recordShot`으로 기록합니다. 이때 `LASER_MAX_MS`보다 오래 켜져 있는 빛은 버립니다. 물체 명중을 찾는 단계(`detectObjectPass`)도 따로 있습니다.
- **새 인식(재설계)**: 레이저만(빨강) 감지할 때는 `neActive()`이면 위 과정 대신 `engine/capture-worker.js`(장면 줄 + 일꾼 스레드, 장면 전체 읽기) → `engine/laser-engine.js`(탄착점 = 빛 줄의 시작점)를 쓰고, 발 사건을 `videoToScreen` → `recordShot`으로 넘긴다. 경기 중 노출은 33ms·ISO 100 고정. 주소에 `&engine=old`를 붙이거나 기기가 지원하지 않으면 예전 방식. engine/ 파일을 고치면 `ENGINE_VER`(index.html·enginelab.html)를 올린다. 엔진 시험: `enginelab.html`(태블릿), `node tools/replay.js`(PC). 근거: `docs/태블릿_구조분석.md`.
- 조정용 상수는 스크립트 맨 위에 있고, 실제로 잰 값을 근거로 주석이 달려 있습니다: `ANALYSIS_WIDTH`, `CAMERA_W/H`, `MISS_LIMIT`, `USE_FALLBACK`, `LASER_MAX_MS`, `DIAG`. `DIAG = true`로 두면 레이저 후보 진단 기록이 시트의 '진단기록' 탭으로 갑니다.

## 작성 규칙

- 코드가 아주 촘촘하게 쓰여 있습니다. 한 줄에 여러 문장이 있고 이름이 짧으며, DOM 요소는 id 목록으로 만든 `els.*`로 씁니다. 이 스타일에 맞춰 고칩니다. 파일 전체를 다시 정렬하면 변경 내역을 알아볼 수 없게 되니 하지 않습니다.
- 주석은 *왜* 그렇게 했는지를 한국어로, 실제로 잰 값과 함께 설명합니다. 기존 주석은 남기고, 새 주석도 같은 방식으로 씁니다.
- Firebase 경로와 데이터 형식은 `index.html`, `live.html`, 외부 Apps Script가 함께 쓰는 약속입니다. 바꿀 때는 모든 쪽을 함께 고칩니다.
