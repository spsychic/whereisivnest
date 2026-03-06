# Where Is Invest

국민연금 투자 추정 현황(공시 기준) + 실시간 가격 기반 수익률 추정치 + 관련 뉴스를 보여주는 정적 웹 MVP입니다.

## 현재 구현된 기능

- 상단: 사이트 제목, 마지막 갱신 시각, 수동 새로고침 버튼
- 좌측: 보유 종목 목록, 클릭 시 보유수량/매입단가/현재가/수익률/기준일 표시
- 우측: 선택 종목 관련 뉴스 목록
- 자동 갱신:
  - 가격: 1분
  - 뉴스: 10분
  - 전체: 30분
- 하단 광고 영역 + AdSense 삽입 구조
- 정책 페이지:
  - `/privacy.html`
  - `/disclaimer.html`

## 데이터 정확도 메모

- 현재 `holdingQty`는 공시 평가액과 현재가로 역산한 추정치가 포함될 수 있습니다.
- 현재 `buyPrice`는 실제 체결단가가 없을 때 기준일 종가 대체값이 사용됩니다.
- 따라서 수익률은 참고용 추정치이며, 투자 판단 용도의 확정 수치가 아닙니다.

## 실행 방법

```bash
cp .env.example .env
npm start
```

브라우저에서 `http://localhost:8080` 접속

## 배포

- 실제 배포는 정적 업로드가 아니라 Node 서버 실행 방식이어야 합니다.
- 배포 절차는 [DEPLOY.md](./DEPLOY.md) 참고

## 실데이터 연동 포인트

프론트는 이미 아래 로컬 API를 사용하도록 연결되어 있습니다.

- `/api/portfolio`
- `/api/prices`
- `/api/news`

- `portfolio` 응답 예시

```json
[
  {
    "ticker": "005930.KS",
    "name": "삼성전자",
    "holdingQty": 1800000,
    "buyPrice": 69000,
    "snapshotDate": "2025-12-31"
  }
]
```

- `prices` 응답 예시

```json
{
  "005930.KS": 74800
}
```

- `news` 응답 예시

```json
[
  {
    "id": "n1",
    "ticker": "005930.KS",
    "title": "뉴스 제목",
    "source": "언론사",
    "publishedAt": "2026-03-02T12:10:00+09:00",
    "url": "https://news.example.com/article/1"
  }
]
```

## AdSense 적용

1. `.env`에 아래 값 입력
- `ADSENSE_CLIENT=ca-pub-xxxxxxxxxxxxxxxx`
- `ADSENSE_SLOT=xxxxxxxxxx`
2. 서버 재시작(`npm start`)
3. 배포 후 `https://도메인/ads.txt` 접근 가능 여부 확인

## Formspree 문의 폼 적용

1. Formspree에서 폼을 생성하고 endpoint URL을 확인
2. `.env`에 아래 값 입력
- `FORMSPREE_ENDPOINT=https://formspree.io/f/xxxxxxxx`
3. 서버 재시작(`npm start`)
4. 메인 우측 하단 "문의하기"에서 테스트 전송

## 직접 준비해야 하는 것

- `data/portfolio.json`의 실제 국민연금 보유종목/수량 업데이트
- 시세 API 권한/계약(실시간 가격)
- 뉴스 API 키
- AdSense 계정 승인 + 퍼블리셔 ID
- 운영 도메인 + HTTPS

## 연동 상세

- 가격: Yahoo Finance quote API (서버 측 호출)
- 뉴스:
  - 기본값: Google News RSS
  - 선택사항: `.env`에 NAVER 키 입력 시 네이버 뉴스 API 사용
- 보유내역: `data/portfolio.json` 기준

## 1단계: 보유종목 실데이터 반영

1. `data/portfolio.csv`를 열고 실제 보유 데이터로 교체
2. 아래 명령 실행

```bash
npm run import:portfolio
```

3. `data/portfolio.json`이 자동 생성/갱신되면 완료
   - 중복 티커/잘못된 티커 형식/잘못된 날짜 형식이 있으면 변환이 실패합니다.
   - `holdingQty=0`, `buyPrice=0`은 경고로 출력됩니다.

CSV 컬럼:

- `ticker`: 종목코드(예: `005930`)
- `name`: 종목명
- `keyword`: 뉴스 검색 키워드
- `holdingQty`: 보유수량
- `buyPrice`: 매입단가(모르면 `0`)
- `snapshotDate`: 기준일(`YYYY-MM-DD`)

## 운영 로그 확인

- 서버는 `/api/prices`, `/api/news` 호출 시 가격/뉴스 소스별 시도/성공/실패/실패율을 로그로 출력합니다.
- 주기 로그는 10분 간격으로 출력됩니다.

## 운영 안정화 기본값

- API 캐시(TTL):
  - `/api/prices`: 60초
  - `/api/news`: 10분
- 기본 보안 헤더:
  - `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Content-Security-Policy`
- API 오류 응답은 공통 형식(`error.code`, `error.message`, `timestamp`)으로 반환됩니다.
