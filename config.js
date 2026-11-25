/*
 * LASER MATCH 설정 파일
 * index.html(사대 태블릿)과 live.html(관전 크롬북)이 함께 읽어 가는 파일입니다.
 * 처음 한 번만 아래 주소를 넣어 깃허브에 올리면, 다른 파일을 고쳐도 다시 넣을 필요가 없어요.
 * (index.html, live.html과 같은 폴더에 올려 주세요)
 */
window.LASER_CONFIG = {
  // ★ 기존 감일고 레이저 사격 시스템(Apps Script) 웹앱의 /exec 주소
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxFR3r_0IBj335qmebcyng187aj7yuYYtDn79pZyIDkld8X5c3xWFo6rQrIp7_dHu57/exec',

  // 교내 리그전(학급 릴레이)이 쓰는 Firebase 경로. 수업용 경로(lanes/cmds/results)와 섞이지 않게 따로 둔다.
  // 시험하는 동안은 'league_test', 실제 대회 날에는 'league'로 바꾼다(control.html·board.html·index.html이 함께 읽음).
  LEAGUE_ROOT: 'league_test',

  // 실시간 통신(Firebase) 설정
  FIREBASE: {
    apiKey: "AIzaSyBe8XGq4Vz-e0HrvRrxV8uyyiE10ozBEvc",
    authDomain: "laser-9893f.firebaseapp.com",
    databaseURL: "https://laser-9893f-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "laser-9893f",
    storageBucket: "laser-9893f.firebasestorage.app",
    messagingSenderId: "790272136984",
    appId: "1:790272136984:web:304af6db9ff926f71bb06d"
  }
};
