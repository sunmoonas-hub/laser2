LASER MATCH — GitHub Pages + Google Apps Script

휴대폰 카메라 화면은 GitHub Pages에서 실행하고, 경기 기록과 순위표는 Google Apps Script 및 Google Sheets에서 처리합니다.

파일 위치

파일

넣을 곳

index.html

GitHub 저장소 최상위 폴더

Code.gs

Google Apps Script 프로젝트

appsscript.json

Google Apps Script 매니페스트

1. Apps Script 저장 서버 배포

새 Apps Script 프로젝트를 만들거나 기존 프로젝트를 엽니다.

Code.gs 전체 내용을 붙여넣습니다.

필요할 때 프로젝트 설정에서 appsscript.json 표시를 켜고 내용을 붙여넣습니다.

배포 → 새 배포 → 웹 앱을 선택합니다.

실행 사용자는 나, 액세스 권한은 모든 사용자로 설정합니다.

권한을 승인하고 /exec로 끝나는 웹 앱 URL을 복사합니다.

브라우저에서 /exec URL을 직접 열었을 때 LASER MATCH API 문구가 보이면 정상입니다.

2. GitHub용 index.html 설정

index.html에서 다음 줄을 찾습니다.

const APPS_SCRIPT_URL = '여기에_APPS_SCRIPT_웹앱_EXEC_주소를_붙여넣으세요';

따옴표 안을 1단계에서 복사한 /exec 주소로 교체합니다.

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/실제배포ID/exec';

3. GitHub Pages 게시

GitHub에서 laser-match 공개 저장소를 만듭니다.

수정한 index.html을 저장소 최상위에 업로드합니다.

Settings → Pages로 이동합니다.

Source는 Deploy from a branch, Branch는 main, 폴더는 **/(root)**로 지정합니다.

저장 후 표시되는 https://사용자이름.github.io/laser-match/ 주소를 엽니다.

4. 휴대폰 사용

카카오톡 내부 브라우저가 아니라 Chrome으로 GitHub Pages 주소를 엽니다.

카메라 시작을 누르고 카메라 권한을 허용합니다.

휴대폰을 고정하고 표적 보정을 누릅니다.

표적 중심과 가장 바깥쪽 1점 원의 테두리를 차례로 누릅니다.

선수명과 경기 발수를 설정하고 경기를 시작합니다.

기록 확인

첫 경기 저장 시 Apps Script 소유자의 Google Drive에 레이저 사격대회 기록 스프레드시트가 자동 생성됩니다. Apps Script의 /exec 주소를 직접 열면 응답 안의 spreadsheetUrl에서 시트 주소를 확인할 수 있습니다.

주의

Apps Script 코드를 수정한 뒤에는 배포 관리 → 수정 → 새 버전으로 반영하세요.

새 배포를 만들었다면 /exec 주소가 바뀔 수 있으므로 index.html도 수정해야 합니다.

GitHub 저장소에 비밀번호, 계정 정보 또는 비밀 키를 넣지 마세요.

GitHub Pages는 공개 화면입니다. 선수 개인정보는 필요한 최소한만 입력하세요.

무광 표적과 고정 거치대를 사용하고 실제 대회 전에 충분히 시험하세요.
