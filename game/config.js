/*
 * 학급 기록판 연결
 *
 * 구글 시트에 학급 기록판(game/server/Code.gs)을 설치하고 받은 웹 앱 주소를 board에 넣으면
 * 학생 기록이 그 시트에 모여 학급 순위가 되고, 교사가 도전 시간을 열고 닫을 수 있다.
 * 비워 두면 지금처럼 기록이 기기마다 따로 남는다.
 * 이 파일을 고치지 않고 게임 주소 끝에 ?board=웹앱주소 를 붙여 열어도 된다.
 * 설치 방법: game/server/README.md
 */
window.BOMB_CONFIG = {
  board: 'https://script.google.com/macros/s/AKfycbw4aSkQtILeoy0-LUkfsUJhmUjePgXZWQ4BIXW6tMuZYpHYxuOHzAraiYQSEBAiqOg/exec'
};
