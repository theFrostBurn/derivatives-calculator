const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const pricingMatch = html.match(
    /\/\/ OPTION_PRICING_START([\s\S]*?)\/\/ OPTION_PRICING_END/,
);

assert.ok(pricingMatch, 'HTML에서 옵션 가격 계산 블록을 찾을 수 있어야 합니다.');

const context = vm.createContext({ Number });
vm.runInContext(`${pricingMatch[1]}
this.optionPricing = {
    calculateOptionExitPrice,
    calculateOptionFee,
    calculateOptionNetProfit,
};`, context);
const pricing = context.optionPricing;

test('정액 수수료 옵션은 진입·청산 수수료를 모두 반영한다', () => {
    const product = { valuePerQuoteUnit: 50 };
    const feePolicy = { type: 'flat', amount: 2.49 };
    const breakEven = pricing.calculateOptionExitPrice(1, product, feePolicy, 0);

    assert.ok(Math.abs(breakEven - 1.0996) < 1e-12);
    assert.ok(Math.abs(pricing.calculateOptionNetProfit(1, breakEven, product, feePolicy)) < 1e-10);
    assert.ok(Math.abs(pricing.calculateOptionNetProfit(1, 0, product, feePolicy) + 54.98) < 1e-10);
});

test('비율 수수료 옵션은 청산가격에 따라 달라지는 매도 수수료를 반영한다', () => {
    const product = { valuePerQuoteUnit: 10 };
    const feePolicy = { type: 'percent', rate: 0.15 };
    const breakEven = pricing.calculateOptionExitPrice(100, product, feePolicy, 0);
    const target = pricing.calculateOptionExitPrice(100, product, feePolicy, 1000);

    assert.ok(Math.abs(pricing.calculateOptionNetProfit(100, breakEven, product, feePolicy)) < 1e-9);
    assert.ok(Math.abs(pricing.calculateOptionNetProfit(100, target, product, feePolicy) - 1000) < 1e-9);
    assert.equal(pricing.calculateOptionFee(2000, feePolicy), 3);
});

test('옵션 차트는 0원 손실 구간과 정확한 기준점을 숫자형 축에 표시한다', () => {
    const chartMatch = html.match(
        /function updateChart\([\s\S]*?\n\s*function updateFuturesChart/,
    );
    assert.ok(chartMatch, '옵션 차트 구현을 찾을 수 있어야 합니다.');
    assert.match(chartMatch[0], /priceValues\.push\(0, buyPrice, breakEvenPrice, targetProfitPrice\)/);
    assert.match(chartMatch[0], /type: 'linear'/);
    assert.match(chartMatch[0], /markerDataset\('손익분기'/);
    assert.match(html, /chart\.js@4\.4\.9\/dist\/chart\.umd\.min\.js/);
});
