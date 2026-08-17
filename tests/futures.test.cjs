const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const calculatorMatch = html.match(
    /\/\/ FUTURES_CALCULATOR_START([\s\S]*?)\/\/ FUTURES_CALCULATOR_END/,
);

assert.ok(calculatorMatch, 'HTML에서 선물 계산 엔진 블록을 찾을 수 있어야 합니다.');

const context = vm.createContext({ Math, Number });
vm.runInContext(`${calculatorMatch[1]}; this.calculate = calculateFuturesPosition;`, context);
const calculate = context.calculate;

test('선물 결과는 차트 아래 요약 영역에 배치되고 모드별 레이아웃 상태를 노출한다', () => {
    const chartIndex = html.indexOf('class="chart-container"');
    const summaryIndex = html.indexOf('class="future-summary future-only"');
    const firstMetricIndex = html.indexOf('id="futureNotional"');

    assert.ok(chartIndex >= 0, '차트 컨테이너가 있어야 합니다.');
    assert.ok(summaryIndex > chartIndex, '선물 요약은 차트 다음에 배치되어야 합니다.');
    assert.ok(firstMetricIndex > summaryIndex, '선물 핵심 수치는 요약 영역 안에 있어야 합니다.');
    assert.match(html, /id="calculatorContent" data-instrument-type="option"/);
    assert.match(html, /calculatorContent\.dataset\.instrumentType = selectedInstrumentType/);
    assert.match(html, /id="futureOneContractMargin"/);
    assert.match(html, /id="futureMinimumBoundary"/);
    assert.match(html, /for="futureReferencePrice">기초자산 기준가격<\/label>/);
    assert.match(html, /통상 전일 KRX 본장 종가 · HTS 값 입력/);
    assert.match(html, /class="button data-fetch-button" id="marketCloseFetchBtn"[^>]*>전일 KRX 종가 불러오기<\/button>/);
    assert.match(html, /id="futureAccountEquityHelp">종가 불러오기 시 현재 계약 수의 위탁증거금으로 자동 입력<\/div>/);
    assert.match(html, /for="futureCosts">예상 거래비용 합계<\/label>/);
    assert.match(html, /전체 계약 기준 · 진입·청산 수수료 등 직접 입력/);
    assert.match(html, /screenCode\.className = 'hts-screen-code'/);
    assert.match(html, /screenCode\.textContent = screen/);
    assert.match(html, /기초자산 기준가격 \$\{referencePriceText\} × 승수 \$\{selectedProduct\.multiplierText\} × 위탁증거금률/);
    assert.match(html, /formatAmount\(Number\(input\.initialMarginRate\), 2\)/);
});

test('선물 차트는 현재가와 정확한 위험 기준을 숫자형 가격축에 표시한다', () => {
    const chartMatch = html.match(
        /function updateFuturesChart\([\s\S]*?\n\s*function resetFuturesResults/,
    );
    assert.ok(chartMatch, '선물 차트 구현을 찾을 수 있어야 합니다.');
    assert.match(chartMatch[0], /const currentPrice = Number\(input\.currentPrice\)/);
    assert.match(chartMatch[0], /type: 'linear'/);
    assert.match(chartMatch[0], /markerDataset\('현재가격'/);
    assert.match(chartMatch[0], /입력 기초자산 기준가격 기준 유지증거금\(고정\)/);
});

function input(overrides = {}) {
    return {
        direction: 'long',
        contracts: 1,
        multiplier: 10,
        entryPrice: 262500,
        currentPrice: 262500,
        referencePrice: 262500,
        accountEquity: 1181250,
        initialMarginRate: 45,
        maintenanceMarginRate: 30,
        costs: 0,
        tickSize: 500,
        ...overrides,
    };
}

test('삼성전자선물 1계약의 명목금액·증거금·민감도를 계산한다', () => {
    const result = calculate(input());
    assert.equal(result.valid, true);
    assert.equal(result.notional, 2625000);
    assert.equal(result.initialMargin, 1181250);
    assert.equal(result.maintenanceMargin, 787500);
    assert.equal(result.tickValue, 5000);
    assert.equal(result.onePercentPnl, 26250);
    assert.equal(result.boundaryPrice, 223125);
    assert.equal(result.oneContractInitialMargin, 1181250);
    assert.equal(result.minimumBoundaryPrice, 223125);
    assert.equal(result.minimumBoundaryMovePercent, -15);
});

test('추가 예치 없는 1계약 마진콜 추정은 사용자 계좌 투입금과 분리한다', () => {
    const result = calculate(input({
        contracts: 3,
        accountEquity: 10000000,
        costs: 50000,
    }));

    assert.equal(result.oneContractInitialMargin, 1181250);
    assert.equal(result.oneContractMaintenanceMargin, 787500);
    assert.equal(result.minimumBoundaryPrice, 223125);
    assert.notEqual(result.boundaryPrice, result.minimumBoundaryPrice);
});

test('SK하이닉스선물 스냅샷 계산값을 재현한다', () => {
    const result = calculate(input({
        multiplier: 10,
        entryPrice: 1718000,
        currentPrice: 1718000,
        referencePrice: 1718000,
        accountEquity: 8323710,
        initialMarginRate: 48.45,
        maintenanceMarginRate: 32.3,
        tickSize: 1000,
    }));
    assert.equal(result.notional, 17180000);
    assert.ok(Math.abs(result.initialMargin - 8323710) < 0.0001);
    assert.ok(Math.abs(result.maintenanceMargin - 5549140) < 0.0001);
    assert.equal(result.tickValue, 10000);
    assert.equal(result.boundaryPrice, 1440543);
});

test('미니·정규 코스피200선물의 계약 규모와 틱 가치를 계산한다', () => {
    const mini = calculate(input({
        multiplier: 50000,
        entryPrice: 1046.81,
        currentPrice: 1046.81,
        referencePrice: 1046.81,
        accountEquity: 10991505,
        initialMarginRate: 21,
        maintenanceMarginRate: 14,
        tickSize: 0.02,
    }));
    const regular = calculate(input({
        multiplier: 250000,
        entryPrice: 1046.81,
        currentPrice: 1046.81,
        referencePrice: 1046.81,
        accountEquity: 54957525,
        initialMarginRate: 21,
        maintenanceMarginRate: 14,
        tickSize: 0.05,
    }));

    assert.equal(mini.notional, 52340500);
    assert.equal(mini.initialMargin, 10991505);
    assert.equal(mini.maintenanceMargin, 7327670.000000001);
    assert.equal(mini.tickValue, 1000);
    assert.ok(Math.abs(mini.boundaryPrice - 973.5333) < 0.0001);

    assert.equal(regular.notional, 261702500);
    assert.equal(regular.initialMargin, 54957525);
    assert.equal(regular.maintenanceMargin, 36638350);
    assert.equal(regular.tickValue, 12500);
    assert.ok(Math.abs(regular.boundaryPrice - 973.5333) < 0.0001);
});

test('롱과 숏의 손익 및 위험 경계 방향이 반대로 움직인다', () => {
    const long = calculate(input({ currentPrice: 263500 }));
    const short = calculate(input({ direction: 'short', currentPrice: 263500 }));
    assert.equal(long.pnl, 10000);
    assert.equal(short.pnl, -10000);
    assert.equal(long.boundaryPrice, 223125);
    assert.equal(short.boundaryPrice, 301875);
});

test('계약 수와 비용을 계좌평가액 및 증거금에 반영한다', () => {
    const result = calculate(input({
        contracts: 2,
        accountEquity: 2362500,
        currentPrice: 261500,
        costs: 2500,
    }));
    assert.equal(result.initialMargin, 2362500);
    assert.equal(result.maintenanceMargin, 1575000);
    assert.equal(result.pnl, -20000);
    assert.equal(result.estimatedEquity, 2340000);
    assert.equal(result.marginBuffer, 765000);
});

test('유효하지 않은 계약 수와 증거금률 조합을 거부한다', () => {
    assert.equal(calculate(input({ contracts: 1.5 })).valid, false);
    assert.equal(calculate(input({ contracts: 0 })).valid, false);
    assert.equal(calculate(input({ initialMarginRate: 10, maintenanceMarginRate: 20 })).valid, false);
    assert.equal(calculate(input({ entryPrice: 0 })).valid, false);
});
