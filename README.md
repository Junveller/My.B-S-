# Bisje (비서)

개인 일정관리 플래너 **PWA**. 아이폰·아이패드 Safari에서 **공유 → 홈 화면에 추가**하면 앱처럼 쓸 수 있어요 (홈 화면 이름: **Bisje**).

- 열면 바로 **시간표** (06:00 ~ 다음날 06:00, 10분 단위)
- **할 일**: 큰 카테고리 > 묶음 > 할 일, Top 3, 집계시간 · Todo 진행
- **가계부**: 지출 기록, 월 예산, 카테고리·결제수단별 합계, 날짜 검색, 금액 가리기
- **통계**: 이번 주/이번 달, 알바 수입(시급 × DONE 시간)과 월급날 D-day. 정산기간(예: 1일 ~ 말일, 11일 ~ 다음 달 10일)과 월급날(말일 선택 가능)을 알바마다 설정
- **설정**: 표시할 섹션, 시작 화면, 표시 이름, 비밀번호·복구 코드, 이메일 연결
- 폰은 하단 5탭, 아이패드 가로는 3단 레이아웃

## 개발

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 타입 검사 + 프로덕션 빌드 (dist/)
npm run icons      # public/icon.svg → PNG 아이콘 다시 만들기 (Playwright 필요)
```

`.env`가 없으면 **로컬 모드**로 동작해요: 계정과 데이터가 이 기기(IndexedDB)에만 저장되고, 동기화·이메일 연결은 꺼져요.
로컬 모드의 5회 잠금은 기기 안에서만 걸리니, 실제로 쓸 때는 아래처럼 서버를 연결하세요.

## 사이트 배포 (GitHub Pages)

`main` 또는 `claude/bisje-pwa`에 푸시하면 `.github/workflows/deploy.yml`이 빌드해서 `gh-pages` 브랜치에 올려요.

1. 저장소 **Settings → Pages** → Source: **Deploy from a branch**, Branch: **gh-pages** / **(root)** → Save
   - 비공개 저장소는 GitHub Pro가 있어야 Pages를 쓸 수 있어요. 무료 계정이면 저장소를 공개로 바꾸거나 Cloudflare Pages를 쓰세요 (빌드 명령 `npm run build`, 출력 폴더 `dist`, 환경 변수는 아래와 같음).
2. 주소: `https://<GitHub 사용자명>.github.io/<저장소 이름>/` → 아이폰 Safari에서 열고 **공유 → 홈 화면에 추가** (이름: Bisje)

## 서버 연결 (Supabase 무료, 다른 기기·브라우저에서 같은 계정)

서버가 없으면 계정과 데이터가 그 브라우저에만 있어서, Safari와 Claude 앱처럼 다른 곳에서는 로그인되지 않아요.

1. [supabase.com](https://supabase.com)에서 무료 프로젝트 만들기
2. 왼쪽 **SQL Editor** → `supabase/bisje.sql` 내용을 전부 붙여넣고 **Run** (다시 실행해도 안전)
3. **Project Settings → API**에서 *Project URL*과 *anon public* 키 복사
4. GitHub 저장소 **Settings → Secrets and variables → Actions → Variables**에 추가
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public 키 (공개돼도 되는 키예요. 테이블은 직접 읽고 쓸 수 없고 함수만 부를 수 있어요)
5. **Actions → Deploy → Run workflow**로 다시 배포

로컬 개발에서는 `.env.example`을 `.env`로 복사해 같은 두 값을 넣으면 돼요.

### 로그인 구조

- 가입: 닉네임(한글 가능, 겹칠 수 없음, 대소문자·맥/아이폰 한글 차이 무시) + 숫자 4자리. 가입 직후 **복구 코드**(`XXXX-XXXX-XXXX`)를 한 번 보여줘요.
- 비밀번호 확인과 **5회 실패 → 잠금**(10분부터 반복될수록 두 배, 최대 24시간)은 서버 함수(`bisje_login`)가 처리해요. 앱을 거치지 않고 직접 호출해도 같은 잠금이 걸려요.
- 비밀번호와 복구 코드는 bcrypt로, 로그인 토큰은 SHA-256으로만 저장해요.
- 로그인은 한 번만 하면 유지돼요 (로그아웃 · 새 기기 · 브라우저 데이터 삭제 때만 다시 로그인).
- 비밀번호를 잊으면 복구 코드로 재설정해요. 재설정하면 다른 기기의 로그인은 끊겨요.
- 이메일 연결은 아직 없어요 (다음 버전 후보).

### 동기화

- 저장 버튼이 없어요. 모든 변경은 즉시 IndexedDB에 저장되고, 온라인이면 1.5초 뒤 서버로 올라가요.
- 같은 계정이면 아이폰·아이패드가 자동으로 같은 데이터를 써요. 충돌은 **항목 단위로 마지막 수정 시각이 더 늦은 쪽**이 이겨요.
- 삭제는 표시만 남겨서 다른 기기에도 전달돼요.
- iOS Safari는 오래 안 쓴 사이트 데이터를 지울 수 있어서 홈 화면 추가를 권장해요. 지워져도 다시 로그인하면 서버에서 복원돼요.

## claude.ai 페이지 버전

`npm run build:artifact` → `dist-artifact/bisje.html` 한 파일. claude.ai 페이지의 저장소(db)에 claude.ai 계정별로 저장돼요.

## 사용법 메모

- **시간표 칠하기**: 칸을 길게 누른 채 끌기 (그냥 끌면 스크롤). 마우스는 바로 끌면 돼요.
- **칸 탭**: 확대 보기 → 확대된 상태에서 칸을 탭하면 시간 선택 시트
- **블록 탭**: 메모 시트 (제목, 묶음, 시간 ±10분, PLAN→DONE 복사, 메모, 삭제)
- 같은 종류(PLAN/DONE)끼리 겹치게 칠하면 새 블록이 덮어써요. PLAN→DONE 복사는 이미 DONE이 있는 칸은 건너뛰어요.
- 집계시간: 시간표 위 **집계** 버튼 → 카테고리/묶음 선택 (기본: 공부)

## 구조

```
src/
  lib/        db(Dexie) · data(저장/삭제/블록 배치) · sync · auth · time · hooks
  components/ 공통 UI (시트, 스위치, 체크박스, 아이콘)
  screens/    Todo · Timetable · BlockSheet · BundleEdit · Ledger · Stats · Settings · Auth
supabase/     bisje.sql (테이블 + 로그인·잠금·동기화 함수, SQL Editor에 붙여넣기)
```

## 다음 버전 후보

일정 탭, 스톱워치 자동 기록, 반복 할 일, 알림, Daily Review / D-Day / Goal 본체.
