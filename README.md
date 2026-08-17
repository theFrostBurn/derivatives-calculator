# 파생상품 계약 계산기

옵션·선물의 계약 구조, 거래 준비금, 손익 민감도, 만기와 위험 지표를 상품별 단위에 맞춰 비교·계산하는 거래 전 점검 도구입니다.

> 이 앱은 투자 추천, 실시간 시세, 주문 가능 여부 또는 증권사의 실시간 위험관리 결과를 제공하지 않습니다. 실제 거래 전에는 거래소 공지와 삼성증권 HTS의 당일 종목정보·증거금·주문 마감을 확인하세요.

## 주요 기능

### 옵션

- 자산군별 26개 옵션 상품
- 상품별 계약 승수와 특수 입력 단위 자동 적용
- 옵션 프리미엄 총액과 원화 환산
- 수수료, 손익분기 옵션가격, 목표 옵션가격
- 옵션 자체의 재매도 가격 변화에 따른 1계약 순손익 차트(기초자산 만기손익 차트 아님)
- 채권 32분할 및 농산물 센트 표기 입력

### 선물

- 삼성전자선물, SK하이닉스선물, 미니 코스피200선물, 코스피200선물
- 롱·숏, 계약 수, 진입가격, 현재가격, 기초자산 기준가격 입력
- 금융위원회 공공데이터포털(KRX)의 전일 종가 자동 입력
- 1계약 진입에 필요한 위탁증거금 최상단 표시
- 추가 예치금이 없는 1계약의 유지증거금 미달 추정 가격·변동률 최상단 표시
- 명목금액, 위탁증거금, 유지증거금, 레버리지
- 평가손익, 추정 계좌평가액, 증거금 여유 또는 부족액
- 1틱 및 1% 가격 변화 손익
- 유지증거금 미달 추정 경계와 가격별 계좌평가액 차트

### 공통

- 상품별 최근 최종거래일 2개와 D-day
- 거래소 현지 날짜를 반영한 만기 판정
- 공식 거래 달력 공개 범위와 규칙 기반 예상값 구분
- 선택한 상품과 `현재 값들을 기본값으로 저장`으로 지정한 상품별 입력값을 브라우저 `localStorage`에 저장

## 파일 구성

- `index.html`: 앱 본체
- `docs/파생상품_계약사양.md`: 옵션·선물 계약 사양 참고표
- `docs/선물_4종목_계약과_증거금.md`: 4개 선물의 통합 설명과 계산 근거
- `tests/expiry.test.cjs`: 만기 엔진과 상품 데이터 회귀 테스트
- `tests/futures.test.cjs`: 선물 증거금·손익 계산 테스트
- `tests/options.test.cjs`: 옵션 수수료·손익분기·차트 범위 회귀 테스트
- `tests/fx.test.cjs`: 환율 캐시와 비동기 요청 회귀 테스트
- `tests/market-close.test.cjs`: 전일 종가 조회·응답 경합·자료 생성 회귀 테스트
- `scripts/update-market-close.mjs`: 공식 주식·지수 종가를 `data/market-close.json`으로 생성
- `.github/workflows/update-market-close.yml`: 평일 오후 종가 파일 자동 갱신 및 종가 JSON 전용 GitHub Pages 배포

## 실행 방법

브라우저에서 `index.html`을 직접 열 수 있습니다. 환율 자동 불러오기는 브라우저의 `file://` 보안 정책에 따라 차단될 수 있으므로 로컬 서버 사용을 권장합니다.

```powershell
python -m http.server 8000
```

접속 주소:

```text
http://localhost:8000/
```

## 테스트

별도 패키지 설치 없이 Node.js 내장 테스트 러너를 사용합니다.

```powershell
node --test .\tests\expiry.test.cjs .\tests\futures.test.cjs .\tests\options.test.cjs .\tests\fx.test.cjs .\tests\market-close.test.cjs
```

## 데이터 모델

`index.html`의 `PRODUCTS` 배열이 상품 정의의 단일 소스입니다.

- `instrumentType`: `option` 또는 `future`
- `underlyingAssetClass`: 기초자산군
- `pricingModel`: `premium` 또는 `futuresMargin`
- `valuePerQuoteUnit`: 가격 1단위당 계약가치
- `tickSize`, `tickValue`: 선물 최소 가격변동과 1계약 틱 가치
- `expiryRuleId`: 만기 계산 규칙
- `marginSnapshot`: 기준일·증권사·출처가 필요한 선물 증거금 예시
- `parseMode`: 일반 숫자·채권 32분할·농산물 센트 표기 구분

옵션 프리미엄과 선물 명목금액은 의미가 다르므로 계산 흐름을 분리합니다.

```text
옵션 프리미엄 총액 = 옵션가격 × 계약 승수

선물 명목금액 = 기초자산 기준가격 × 계약 승수 × 계약 수
위탁증거금 = 명목금액 × 위탁증거금률
유지증거금 = 명목금액 × 유지증거금률
평가손익 = (현재가격 - 진입가격) × 계약 승수 × 계약 수 × 방향부호
```

방향부호는 롱 `+1`, 숏 `-1`입니다.

### 상품 정의 변경 원칙

- `id`는 표시 코드가 중복되는 상품을 구분하고 `localStorage` 키로도 사용하므로 상품마다 고유하게 유지합니다.
- `instrumentType`은 `option` 또는 `future`, `pricingModel`은 `premium` 또는 `futuresMargin`으로 구분합니다.
- 표시 단위를 변경할 때는 `valuePerQuoteUnit`, `displayDecimals`, `quoteUnitLabel`을 함께 맞춥니다.
- 선물 증거금률과 기준가격은 변동 데이터이므로 `marginSnapshot`에 기준일·증권사·출처를 기록하고 화면에서 수정 가능하게 유지합니다.
- `PRODUCTS`를 변경하면 참고표인 `docs/파생상품_계약사양.md`도 함께 갱신합니다.
- `parseMode`는 일반 숫자 `number`, 채권 32분할 `bond32`, 농산물 센트/부셸 `agCents`를 사용합니다.

## 개발 구조와 변경 원칙

- 별도 빌드 도구나 패키지 매니저 없이 `index.html` 하나에 HTML·CSS·JavaScript를 인라인으로 구성합니다.
- 파싱·계산·차트 갱신은 기존 `parse*`, `recalculate`, `updateChart` 계열 함수 분리 방식을 유지합니다.
- 옵션과 선물의 계산 모델을 섞지 않고 `instrumentType`과 `pricingModel`에 따라 UI와 계산 흐름을 분리합니다.
- 로컬 저장소 접근은 `safeGetItem`과 `safeSetItem`으로 감싸 브라우저 저장소 예외가 앱 전체를 중단시키지 않게 합니다.
- 차트는 고정 버전의 Chart.js CDN을 사용합니다. 차트 사용 여부나 로딩 방식을 변경하면 CDN과 오프라인 안내 문구를 함께 조정합니다.
- 환율은 `api.frankfurter.app`, `open.er-api.com` 순서로 조회하며 네트워크 실패 시 수동 입력을 계속 사용할 수 있어야 합니다.
- 인증이 필요한 KRX 종가 API는 브라우저에서 직접 호출하지 않고 GitHub Actions에서 조회해 인증키 없는 공개 JSON만 배포합니다.

## 증거금 데이터 주의사항

기준가격과 증거금률은 고정 계약 사양이 아닙니다. 앱에 포함된 4개 선물의 수치는 조회일이 남아 있지 않은 과거 삼성증권 HTS 전사값을 재현한 예시입니다. 화면에서 값을 수정할 수 있으며, 실제 주문 전 당일 HTS 수치를 다시 입력해야 합니다.

`전일 KRX 종가 불러오기`는 기초자산의 KRX 본장 종가를 편의상 입력하는 기능입니다. 배당락·액면분할 등으로 증권사가 적용한 기준가격과 다를 수 있으므로, 실제 증거금 계산 전 삼성증권 HTS **2225·2206** 화면과 대조해야 합니다. 7일을 넘긴 자료는 자동 적용하지 않고 현재 입력값을 유지합니다.

`유지증거금 미달 추정 경계`는 다음을 가정한 단순 계산입니다.

- 입력한 증거금률이 유지됨
- 다른 포지션과 추가 입출금이 없음
- 입력한 예상 거래비용 합계 외 비용이 없음
- 유지증거금 미달과 실제 반대매매가 같은 시점이라는 의미가 아님

옵션 수수료도 앱의 기본 추정값입니다. 실제 수수료는 상품과 계좌 조건에 따라 달라질 수 있으므로 주문 전 증권사 수수료 화면을 확인해야 합니다.

## 입력 규칙

### 채권 옵션

- `110'16` → 110 + 16/32
- `110'16+` → 110 + 16.5/32
- `110 16/32` → 110 + 16/32

### 농산물 옵션

- `450'2` → 450 + 2/8
- `450'25` → 450 + 25/100
- `450 2/8` → 450 + 2/8

## 환율·수수료와 로컬 저장

- 환율 기본값: USD 1,350원, HKD 175원, KRW 1원
- 자동 환율 출처: `api.frankfurter.app`, `open.er-api.com`
- 자동·수동 환율은 통화별로 브라우저 `localStorage`에 저장하며 캐시 TTL은 6시간
- KRW 상품은 환율을 적용하지 않고 환율 입력·조회 UI를 숨기며 KRW 1로 계산
- 편도 수수료 기본 추정값은 KOSPI200·미니 KOSPI200·KOSDAQ150·한국 개별주식 옵션은 프리미엄의 0.15%, 그 외 옵션은 2.49 `product.currency`
- 수수료는 앱의 비교용 기본 추정값이므로 실제 계좌 수수료와 다를 수 있으며 주문 전 증권사 수수료를 확인
- 저장 키: `derivativesCalculator.*`

## 전일 KRX 종가 자동 갱신 설정

정적 페이지에 인증키가 노출되지 않도록 GitHub Actions가 공식 API를 호출하고, 생성된 `market-close.json` 하나만 GitHub Pages에 배포합니다. 로컬 HTML의 버튼은 공개 결과 파일인 `https://thefrostburn.github.io/derivatives-calculator/market-close.json`만 읽으므로 매일 `git pull`할 필요가 없습니다.

1. 공공데이터포털에서 [금융위원회 주식시세정보](https://www.data.go.kr/data/15094808/openapi.do)와 [금융위원회 지수시세정보](https://www.data.go.kr/data/15094807/openapi.do)를 활용 신청합니다.
2. GitHub 저장소의 `Settings → Secrets and variables → Actions`에 `DATA_GO_KR_SERVICE_KEY`라는 Repository secret을 추가합니다.
3. GitHub 저장소의 `Settings → Pages → Build and deployment`에서 Source를 `GitHub Actions`로 지정합니다.
4. Actions의 `전일 KRX 종가 갱신` 워크플로를 한 번 수동 실행합니다.

이후 워크플로는 평일 한국시간 오후 2시 30분에 실행되어 삼성전자·SK하이닉스·코스피200의 동일 기준일 종가만 반영하고 공개 JSON을 자동 배포합니다. 공식 API는 실시간 시세가 아니며 기준일 다음 영업일 오후 1시 이후 갱신되므로, 오전에는 최신 전일 자료가 아직 없을 수 있습니다. 인증키는 결과 파일이나 브라우저 코드에 기록되지 않으며 계산기 전체 소스가 아니라 `market-close.json` 하나만 Pages 배포 대상입니다.

로컬 `index.html`을 직접 연 상태에서도 버튼은 공개 JSON 주소를 조회하도록 구성되어 있습니다. 일부 브라우저의 `file://` 네트워크 정책이 조회를 막는 경우에만 `python -m http.server 8000`으로 실행하세요.

현재 저장소는 비공개이므로 GitHub Pages를 사용하려면 비공개 저장소의 Pages를 지원하는 GitHub 플랜이 필요합니다. 배포 대상은 종가 JSON뿐이지만 해당 Pages 주소는 공개 데이터 주소로 사용합니다.

로컬에서 직접 갱신할 때는 PowerShell 7에서 다음과 같이 실행합니다.

```powershell
$env:DATA_GO_KR_SERVICE_KEY = '<공공데이터포털 인증키>'
node .\scripts\update-market-close.mjs
Remove-Item Env:DATA_GO_KR_SERVICE_KEY
```

## 만기 일정 범위

화면의 기준 시각과 D-day는 한국시간을 사용하며, 최종거래일 판정은 거래소 현지 날짜를 유지합니다. 2028년 말까지 계산 자료를 내장하지만 거래소 공식 일정이 발표되지 않은 범위는 `규칙 기반 예상`으로 표시합니다.

앱은 실시간 상장 종목 조회 기능이 아닙니다. 표시된 표준 월물·분기물 및 일부 주간물과 실제 HTS 상장 계약이 다를 수 있습니다.
