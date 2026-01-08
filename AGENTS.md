# AGENTS.md

## 프로젝트 개요
- 단일 `option-calculator.html`에서 동작하는 옵션 승수 기반 계산기입니다.
- 종목 선택 시 승수/입력 단위를 자동 적용하고 1계약 필요금액 및 KRW 환산, 수수료/목표가/손익 차트를 제공합니다.
- 외부 의존성: Chart.js CDN, 환율 API 2곳.

## 실행 방법
- 브라우저에서 `option-calculator.html`을 직접 열 수 있습니다.
- 환율 자동 불러오기는 `fetch()`가 필요하므로 로컬 서버 권장:
  - `python -m http.server 8000`
  - `http://localhost:8000/option-calculator.html`

## 빌드/테스트
- 빌드/패키지 매니저 없음.
- 자동 테스트 없음.

## 데이터/도메인 규칙
- 상품 정의는 `option-calculator.html`의 `PRODUCTS` 배열이 단일 소스입니다.
- `option_multipliers.md`는 참고용 표이므로 `PRODUCTS` 변경 시 함께 갱신하세요.
- `id`는 코드 중복(예: OZM) 구분 및 localStorage 키로 사용하므로 새 상품 추가 시 고유하게 유지합니다.
- `parseMode`:
  - `number`: 일반 숫자
  - `bond32`: 32분할 (`110'16`, `110'16+`, `110 16/32`)
  - `agCents`: 센트/부셸 (`450'2`=1/8, `450'25`=/100, `450'250`=/1000, `450 2/8`)
- 환율 기본값: `DEFAULT_FX` (USD 1350, HKD 175, KRW 1), 캐시 TTL 6시간.
- KRW 상품은 환율 미적용(환율 입력/조회 숨김, KRW=1).
- 수수료 정책(편도): KOSPI200/KOSPI200(미니)/KOSDAQ150는 0.15%, 그 외는 2.49 `product.currency`.

## 코드 스타일/구조
- 단일 HTML 파일에 CSS/JS 인라인 구성.
- 기존 함수 분리 패턴 유지 (`parse*`, `recalculate`, `updateChart` 등).
- 로컬 저장은 `safeGetItem`/`safeSetItem`로 감싸 예외를 삼킵니다.

## 보안/네트워크
- 환율 자동 불러오기: `api.frankfurter.app`, `open.er-api.com`.
- 네트워크 실패 시 수동 입력 가능하도록 유지합니다.

## 변경 시 주의사항
- 표시 단위 변경 시 `valuePerQuoteUnit`/`displayDecimals`/`quoteUnitLabel`을 함께 맞춥니다.
- 차트 사용 여부 변경 시 Chart.js CDN 및 관련 UI 메시지도 함께 조정하세요.
