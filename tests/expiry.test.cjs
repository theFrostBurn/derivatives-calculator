const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const engineMatch = html.match(
    /\/\/ EXPIRY_ENGINE_START([\s\S]*?)\/\/ EXPIRY_ENGINE_END/,
);

assert.ok(engineMatch, 'HTML에서 만기 엔진 블록을 찾을 수 있어야 합니다.');

const context = vm.createContext({
    Date,
    Intl,
    Map,
    Math,
    Set,
});

vm.runInContext(`${engineMatch[1]}
this.expiryEngine = {
    CALENDAR_PROFILES,
    EXPIRY_RULES,
    calculateCmeFxExpiry,
    calculateComexMetalsExpiry,
    calculateHkexExpiry,
    calculateKrxExpiry,
    calculateLastEligibleFridayExpiry,
    calculateNaturalGasExpiry,
    calculateThirdFridayExpiry,
    calculateTreasuryMonthlyExpiry,
    calculateWtiExpiry,
    formatExpiryDday,
    getCalendarCoverageState,
    getMarketDate,
    getUpcomingExpiriesByRule,
    getZonedDateTimeParts,
    isCmeBusinessDay,
    isCmeFxExpiryBusinessDay,
    isCbotInterestRateExpiryBusinessDay,
    isHkexBusinessDay,
    isKrxBusinessDay,
    isUsStockBusinessDay,
    makeYmd,
    ymdKey,
};`, context);

const engine = context.expiryEngine;
const referenceDate = engine.makeYmd(2026, 7, 20);

function keys(ruleId, date = referenceDate) {
    return Array.from(
        engine.getUpcomingExpiriesByRule(ruleId, date, 2),
        (candidate) => engine.ymdKey(candidate.expiryDate),
    );
}

test('전체 인라인 스크립트와 만기 패널 DOM 연결이 유효하다', () => {
    const inlineScriptMatch = html.match(/<script>\s*([\s\S]*?)<\/script>/);
    assert.ok(inlineScriptMatch, '인라인 스크립트를 찾을 수 있어야 합니다.');
    assert.doesNotThrow(() => new vm.Script(inlineScriptMatch[1]));

    const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, 'DOM id는 중복되지 않아야 합니다.');
    const referencedIds = Array.from(
        html.matchAll(/document\.getElementById\('([^']+)'\)/g),
        (match) => match[1],
    );
    for (const id of referencedIds) {
        assert.ok(ids.includes(id), `getElementById('${id}') 대상이 DOM에 있어야 합니다.`);
    }
});

test('옵션 26개와 선물 4개가 고유 ID와 등록된 만기 규칙을 사용한다', () => {
    const productsMatch = html.match(
        /const PRODUCTS = (\[[\s\S]*?\n\s*\]);/,
    );
    assert.ok(productsMatch, 'PRODUCTS 배열을 추출할 수 있어야 합니다.');

    const productsContext = vm.createContext({});
    vm.runInContext(`this.products = ${productsMatch[1]};`, productsContext);
    const products = productsContext.products;

    for (const product of products) {
        product.instrumentType ??= 'option';
        product.pricingModel ??= 'premium';
    }

    assert.equal(products.length, 30);
    assert.equal(products.filter((product) => product.instrumentType === 'option').length, 26);
    assert.equal(products.filter((product) => product.instrumentType === 'future').length, 4);
    assert.equal(new Set(products.map((product) => product.id ?? product.code)).size, products.length);
    for (const product of products) {
        assert.ok(product.expiryRuleId, `${product.id}에 expiryRuleId가 필요합니다.`);
        assert.ok(
            engine.EXPIRY_RULES[product.expiryRuleId],
            `${product.id}의 만기 규칙 ${product.expiryRuleId}가 등록되어야 합니다.`,
        );
    }

    for (const product of products.filter((item) => item.instrumentType === 'future')) {
        assert.equal(product.pricingModel, 'futuresMargin', product.id);
        assert.ok(product.marginSnapshot, `${product.id}에 증거금 스냅샷이 필요합니다.`);
        assert.ok(Number(product.valuePerQuoteUnit) > 0, `${product.id}에 승수가 필요합니다.`);
        assert.ok(Number(product.tickSize) > 0, `${product.id}에 틱 크기가 필요합니다.`);
    }
});

test('모든 만기 규칙이 2028년 말까지 내장된 달력 프로필을 참조한다', () => {
    for (const [ruleId, rule] of Object.entries(engine.EXPIRY_RULES)) {
        const profile = engine.CALENDAR_PROFILES[rule.calendarProfileId];
        assert.ok(profile, `${ruleId}의 달력 프로필이 등록되어야 합니다.`);
        assert.equal(profile.embeddedThrough, '2028-12-31', ruleId);
    }
});

test('거래소별 공식 일정 공개 범위를 2028 내장 범위와 분리한다', () => {
    assert.equal(engine.CALENDAR_PROFILES.CME_GROUP.officialThrough, '2026-12-31');
    assert.equal(engine.CALENDAR_PROFILES.KRX.officialThrough, '2026-12-31');
    assert.equal(engine.CALENDAR_PROFILES.HKEX.officialThrough, '2027-12-31');
    assert.equal(engine.CALENDAR_PROFILES.US_OPTIONS.officialThrough, '2027-12-31');
});

test('2026-07-20 기준 각 상품군의 최근 두 만기일이 기대값과 일치한다', () => {
    const expected = {
        cmeFxMonthly: ['2026-08-07', '2026-09-04'],
        cbotTreasuryMonthly: ['2026-07-24', '2026-08-21'],
        cmeEquityQuarterly: ['2026-09-18', '2026-12-18'],
        cmeEquityWeekly14: ['2026-07-24', '2026-08-07'],
        hkexIndexMonthly: ['2026-07-30', '2026-08-28'],
        krxEquityMonthly: ['2026-08-13', '2026-09-10'],
        usStockMonthly: ['2026-08-21', '2026-09-18'],
        comexMetalsMonthly: ['2026-07-28', '2026-08-26'],
        nymexWtiMonthly: ['2026-08-17', '2026-09-17'],
        nymexGasMonthly: ['2026-07-28', '2026-08-26'],
        cbotAgMonthly: ['2026-07-24', '2026-08-21'],
    };

    for (const [ruleId, dates] of Object.entries(expected)) {
        assert.deepEqual(keys(ruleId), dates, ruleId);
    }
});

test('OES/ONQ 표준물은 분기월만, OESW는 1~4주차 금요일만 포함한다', () => {
    assert.deepEqual(keys('cmeEquityQuarterly'), ['2026-09-18', '2026-12-18']);
    assert.deepEqual(keys('cmeEquityWeekly14'), ['2026-07-24', '2026-08-07']);
    assert.ok(!keys('cmeEquityWeekly14').includes('2026-07-31'));
});

test('금·은은 전월의 뒤에서 네 번째 영업일과 금요일 조정을 적용한다', () => {
    assert.equal(
        engine.ymdKey(engine.calculateComexMetalsExpiry(engine.makeYmd(2026, 8, 1))),
        '2026-07-28',
    );
    assert.equal(
        engine.ymdKey(engine.calculateComexMetalsExpiry(engine.makeYmd(2026, 10, 1))),
        '2026-09-24',
    );
});

test('농산물은 월말보다 최소 2영업일 앞선 마지막 금요일을 사용한다', () => {
    assert.equal(
        engine.ymdKey(engine.calculateLastEligibleFridayExpiry(engine.makeYmd(2026, 9, 1))),
        '2026-08-21',
    );
});

test('미국채는 월말 직전 금요일이 휴일인 규정 예외를 적용한다', () => {
    assert.equal(
        engine.ymdKey(engine.calculateTreasuryMonthlyExpiry(engine.makeYmd(2026, 9, 1))),
        '2026-08-21',
    );
    assert.equal(
        engine.ymdKey(engine.calculateTreasuryMonthlyExpiry(engine.makeYmd(2059, 4, 1))),
        '2059-03-27',
    );
});

test('WTI와 천연가스의 기초선물 연동 영업일 규칙을 적용한다', () => {
    assert.equal(
        engine.ymdKey(engine.calculateWtiExpiry(engine.makeYmd(2026, 9, 1))),
        '2026-08-17',
    );
    assert.equal(
        engine.ymdKey(engine.calculateNaturalGasExpiry(engine.makeYmd(2026, 8, 1))),
        '2026-07-28',
    );
});

test('KRX 둘째 목요일과 HKEX 공식 거래 달력을 적용한다', () => {
    assert.equal(
        engine.ymdKey(engine.calculateKrxExpiry(engine.makeYmd(2026, 8, 1))),
        '2026-08-13',
    );
    const hkex = engine.calculateHkexExpiry(engine.makeYmd(2026, 7, 1));
    assert.equal(engine.ymdKey(hkex.expiryDate), '2026-07-30');
    assert.equal(hkex.official, true);

    const hkex2027 = engine.calculateHkexExpiry(engine.makeYmd(2027, 8, 1));
    assert.equal(engine.ymdKey(hkex2027.expiryDate), '2027-08-30');
    assert.equal(hkex2027.official, true);
});

test('코스피200 선물은 분기월물의 둘째 목요일만 표시한다', () => {
    assert.deepEqual(keys('krxEquityQuarterly'), ['2026-09-10', '2026-12-10']);
});

test('KRX 규칙일이 휴일이면 직전 거래일로 앞당기고 확정 범위 밖은 예상으로 표시한다', () => {
    assert.equal(
        engine.ymdKey(engine.calculateKrxExpiry(engine.makeYmd(2027, 5, 1))),
        '2027-05-12',
    );
    const [future] = engine.getUpcomingExpiriesByRule(
        'krxEquityMonthly',
        engine.makeYmd(2028, 1, 1),
        1,
    );
    assert.equal(future.estimated, true);
});

test('미국 표준 월물은 Good Friday일 때 직전 영업일로 앞당긴다', () => {
    assert.equal(
        engine.ymdKey(engine.calculateThirdFridayExpiry(engine.makeYmd(2025, 4, 1))),
        '2025-04-17',
    );
});

test('미국 현충일은 5월의 마지막 월요일로 처리한다', () => {
    assert.equal(engine.isUsStockBusinessDay(engine.makeYmd(2026, 5, 25)), false);
    assert.equal(engine.isUsStockBusinessDay(engine.makeYmd(2026, 5, 26)), true);
});

test('2028년 내장 달력의 대표 휴장일과 2027년 연말 예외를 적용한다', () => {
    assert.equal(engine.isCmeBusinessDay(engine.makeYmd(2028, 4, 14)), false);
    assert.equal(engine.isUsStockBusinessDay(engine.makeYmd(2028, 7, 4)), false);
    assert.equal(engine.isUsStockBusinessDay(engine.makeYmd(2027, 12, 31)), true);
    assert.equal(engine.isKrxBusinessDay(engine.makeYmd(2028, 4, 12)), false);
    assert.equal(engine.isKrxBusinessDay(engine.makeYmd(2028, 4, 13)), true);
    assert.equal(engine.isHkexBusinessDay(engine.makeYmd(2026, 9, 28)), true);
    assert.equal(engine.isHkexBusinessDay(engine.makeYmd(2028, 1, 26)), false);
    assert.equal(engine.isHkexBusinessDay(engine.makeYmd(2028, 5, 29)), false);
    assert.equal(engine.isHkexBusinessDay(engine.makeYmd(2028, 5, 30)), true);
});

test('CME Good Friday는 상품군별 만기 처리 차이를 보존한다', () => {
    const goodFriday2026 = engine.makeYmd(2026, 4, 3);
    assert.equal(engine.isCmeBusinessDay(goodFriday2026), false);
    assert.equal(engine.isCmeFxExpiryBusinessDay(goodFriday2026), true);
    assert.equal(engine.isCbotInterestRateExpiryBusinessDay(goodFriday2026), true);
    assert.equal(engine.isCmeFxExpiryBusinessDay(engine.makeYmd(2027, 3, 26)), false);
    assert.equal(engine.isCbotInterestRateExpiryBusinessDay(engine.makeYmd(2027, 3, 26)), false);
    assert.equal(
        engine.ymdKey(engine.calculateCmeFxExpiry(engine.makeYmd(2026, 4, 1))),
        '2026-04-03',
    );
    const aprilWeekly = engine.EXPIRY_RULES.cmeEquityWeekly14
        .generate(engine.makeYmd(2026, 4, 1))
        .find((candidate) => candidate.contractMonth.year === 2026
            && candidate.contractMonth.month === 4
            && candidate.weekNumber === 1);
    assert.equal(engine.ymdKey(aprilWeekly.expiryDate), '2026-04-02');
});

test('2028년 후보는 내장 예상값이고 2029년부터는 내장 달력 범위 밖이다', () => {
    const [in2028] = engine.getUpcomingExpiriesByRule(
        'krxEquityMonthly',
        engine.makeYmd(2028, 1, 1),
        1,
    );
    assert.equal(in2028.estimated, true);
    assert.equal(in2028.beyondEmbeddedCalendar, false);

    const [in2029] = engine.getUpcomingExpiriesByRule(
        'krxEquityMonthly',
        engine.makeYmd(2029, 1, 1),
        1,
    );
    assert.equal(in2029.estimated, true);
    assert.equal(in2029.beyondEmbeddedCalendar, true);
});

test('공식 일정 공개 종료 2개월 전부터 경고하고 종료 다음 날 만료로 강화한다', () => {
    const before = engine.getCalendarCoverageState(engine.makeYmd(2026, 10, 31));
    assert.equal(before.level, 'ok');
    assert.equal(before.affected.length, 0);

    const warning = engine.getCalendarCoverageState(engine.makeYmd(2026, 11, 1));
    assert.equal(warning.level, 'critical');
    assert.deepEqual(
        Array.from(warning.affected, (profile) => profile.id),
        ['CME_GROUP', 'KRX'],
    );
    assert.ok(warning.affected.every((profile) => profile.warningStartsOn === '2026-11-01'));

    const expired = engine.getCalendarCoverageState(engine.makeYmd(2027, 1, 1));
    assert.equal(expired.level, 'expired');
    assert.ok(expired.affected.some((profile) => profile.level === 'expired'));

    const laterWarning = engine.getCalendarCoverageState(engine.makeYmd(2027, 11, 1));
    const laterById = Object.fromEntries(
        Array.from(laterWarning.affected, (profile) => [profile.id, profile]),
    );
    assert.equal(laterById.HKEX.level, 'critical');
    assert.equal(laterById.US_OPTIONS.level, 'critical');

    const finalPublishedDay = engine.getCalendarCoverageState(engine.makeYmd(2027, 12, 31));
    const finalById = Object.fromEntries(
        Array.from(finalPublishedDay.affected, (profile) => [profile.id, profile]),
    );
    assert.equal(finalById.HKEX.level, 'critical');
    assert.equal(finalById.US_OPTIONS.level, 'critical');

    const allExpired = engine.getCalendarCoverageState(engine.makeYmd(2028, 1, 1));
    assert.ok(allExpired.affected.every((profile) => profile.level === 'expired'));
});

test('크리티컬 경고는 닫기 기능 없이 assertive alert로 고정된다', () => {
    const alertMatch = html.match(
        /<aside[\s\S]*?id="calendarCriticalAlert"[\s\S]*?<\/aside>/,
    );
    assert.ok(alertMatch, '크리티컬 달력 경고 영역이 필요합니다.');
    assert.match(alertMatch[0], /role="alert"/);
    assert.match(alertMatch[0], /aria-live="assertive"/);
    assert.doesNotMatch(alertMatch[0], /<button\b/);
});

test('같은 UTC 시각도 거래소 현지 날짜에 맞춰 기준일을 분리한다', () => {
    const instant = new Date('2026-07-25T02:00:00.000Z');
    assert.equal(engine.ymdKey(engine.getMarketDate('America/New_York', instant)), '2026-07-24');
    assert.equal(engine.ymdKey(engine.getMarketDate('Asia/Seoul', instant)), '2026-07-25');
});

test('한국시간을 주 기준으로 사용하면서 거래소 현지 날짜를 별도로 유지한다', () => {
    const instant = new Date('2026-07-19T19:51:00.000Z');
    const korea = engine.getZonedDateTimeParts('Asia/Seoul', instant);
    const chicago = engine.getZonedDateTimeParts('America/Chicago', instant);

    assert.deepEqual(
        { year: korea.year, month: korea.month, day: korea.day, hour: korea.hour, minute: korea.minute },
        { year: 2026, month: 7, day: 20, hour: 4, minute: 51 },
    );
    assert.deepEqual(
        { year: chicago.year, month: chicago.month, day: chicago.day },
        { year: 2026, month: 7, day: 19 },
    );
});

test('D-day는 한국 날짜 기준이며 거래소가 아직 만기 당일이면 경계를 보존한다', () => {
    const koreaDate = engine.makeYmd(2026, 7, 20);
    const chicagoDate = engine.makeYmd(2026, 7, 19);

    assert.equal(
        engine.formatExpiryDday(engine.makeYmd(2026, 9, 18), koreaDate, chicagoDate),
        'D-60',
    );
    assert.equal(
        engine.formatExpiryDday(engine.makeYmd(2026, 7, 19), koreaDate, chicagoDate),
        '현지 D-DAY',
    );
    assert.equal(
        engine.formatExpiryDday(koreaDate, koreaDate, koreaDate),
        'D-DAY',
    );
});

test('만기 당일은 날짜 기준으로 가장 가까운 만기에 포함한다', () => {
    const sameDay = engine.makeYmd(2026, 7, 24);
    assert.equal(keys('cmeEquityWeekly14', sameDay)[0], '2026-07-24');
});
