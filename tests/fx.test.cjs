const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const cacheMatch = html.match(
    /\/\/ FX_CACHE_START([\s\S]*?)\/\/ FX_CACHE_END/,
);
const fetchMatch = html.match(
    /\/\/ FX_FETCH_START([\s\S]*?)\/\/ FX_FETCH_END/,
);

assert.ok(cacheMatch, 'HTML에서 환율 캐시 블록을 찾을 수 있어야 합니다.');
assert.ok(fetchMatch, 'HTML에서 환율 조회 블록을 찾을 수 있어야 합니다.');

function createStorageContext(initialEntries = []) {
    const entries = new Map(initialEntries);
    const context = vm.createContext({
        Date,
        FX_CACHE_TTL_MS: 6 * 60 * 60 * 1000,
        FX_MEMORY: {},
        JSON,
        LOCAL_CURRENCY: 'KRW',
        Number,
        isLocalCurrency: (currency) => currency === 'KRW',
        safeGetItem: (key) => entries.get(key) ?? null,
        safeSetItem: (key, value) => entries.set(key, value),
    });

    vm.runInContext(`${cacheMatch[1]}
this.fxCache = {
    getFxRateForCurrency,
    getFxStoredInfo,
    getFxStorageKey,
    isFxStale,
    setFxRateForCurrency,
};`, context);

    return { cache: context.fxCache, entries };
}

test('통화별 환율과 저장 시각을 localStorage 형식으로 보존하고 복원한다', () => {
    const first = createStorageContext();
    const before = Date.now();
    first.cache.setFxRateForCurrency('USD', 1412.34, 'manual');
    const after = Date.now();

    const key = first.cache.getFxStorageKey('USD');
    assert.equal(key, 'derivativesCalculator.fx.USD');
    const persisted = JSON.parse(first.entries.get(key));
    assert.equal(persisted.rate, 1412.34);
    assert.equal(persisted.source, 'manual');
    assert.ok(persisted.ts >= before && persisted.ts <= after);

    const restored = createStorageContext(first.entries);
    assert.deepEqual(
        JSON.parse(JSON.stringify(restored.cache.getFxStoredInfo('USD'))),
        persisted,
    );
});

test('환율 캐시는 저장 후 6시간까지 유효하고 그 이후와 미래 시각은 오래된 것으로 본다', () => {
    const now = 2_000_000_000_000;
    const ttl = 6 * 60 * 60 * 1000;
    const fresh = createStorageContext([
        ['derivativesCalculator.fx.USD', JSON.stringify({ rate: 1400, ts: now - ttl, source: 'auto' })],
    ]);
    const stale = createStorageContext([
        ['derivativesCalculator.fx.USD', JSON.stringify({ rate: 1400, ts: now - ttl - 1, source: 'auto' })],
    ]);
    const future = createStorageContext([
        ['derivativesCalculator.fx.USD', JSON.stringify({ rate: 1400, ts: now + 1, source: 'auto' })],
    ]);

    assert.equal(fresh.cache.isFxStale('USD', now), false);
    assert.equal(stale.cache.isFxStale('USD', now), true);
    assert.equal(future.cache.isFxStale('USD', now), true);
});

test('손상된 캐시와 유효하지 않은 환율은 안전하게 무시한다', () => {
    const broken = createStorageContext([
        ['derivativesCalculator.fx.HKD', '{invalid json'],
    ]);
    assert.deepEqual(
        JSON.parse(JSON.stringify(broken.cache.getFxStoredInfo('HKD'))),
        { rate: null, ts: null, source: '' },
    );

    broken.cache.setFxRateForCurrency('HKD', 0, 'manual');
    assert.equal(broken.entries.get('derivativesCalculator.fx.HKD'), '{invalid json');
    assert.deepEqual(
        JSON.parse(JSON.stringify(broken.cache.getFxStoredInfo('KRW'))),
        { rate: 1, ts: null, source: '' },
    );
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, reject, resolve };
}

function createFetchContext() {
    const requests = [];
    const state = {
        recalculations: 0,
        statuses: [],
    };
    const context = vm.createContext({
        console: { error() {} },
        el: {
            fxFetchBtn: { disabled: false },
            fxRate: { value: '' },
        },
        fetchFxRateToKrw: (currency) => {
            const pending = deferred();
            requests.push({ currency, ...pending });
            return pending.promise;
        },
        fxRequestSequence: 0,
        isFxStale: () => true,
        isLocalCurrency: (currency) => currency === 'KRW',
        recalculate: () => { state.recalculations += 1; },
        selectedProduct: { currency: 'USD' },
        setFxRateForCurrency: (currency, rate, source) => {
            state.saved = { currency, rate, source };
        },
        setFxStatus: (message, tone) => state.statuses.push({ message, tone }),
        updateFxStatus: () => { state.statusUpdated = true; },
    });

    vm.runInContext(`${fetchMatch[1]}
this.fetchAndApplyFxRate = fetchAndApplyFxRate;`, context);
    return { context, fetchAndApplyFxRate: context.fetchAndApplyFxRate, requests, state };
}

test('늦게 도착한 이전 통화 응답은 현재 상품 환율을 덮어쓰지 않는다', async () => {
    const fixture = createFetchContext();
    const usdRequest = fixture.fetchAndApplyFxRate();
    fixture.context.selectedProduct = { currency: 'HKD' };
    const hkdRequest = fixture.fetchAndApplyFxRate();

    fixture.requests[0].resolve(1400);
    await usdRequest;
    assert.equal(fixture.context.el.fxRate.value, '');
    assert.equal(fixture.state.saved, undefined);
    assert.equal(fixture.context.el.fxFetchBtn.disabled, true);

    fixture.requests[1].resolve(180.126);
    await hkdRequest;
    assert.equal(fixture.context.el.fxRate.value, '180.13');
    assert.deepEqual(fixture.state.saved, {
        currency: 'HKD',
        rate: 180.13,
        source: 'auto',
    });
    assert.equal(fixture.state.recalculations, 1);
    assert.equal(fixture.context.el.fxFetchBtn.disabled, false);
});

test('신선한 캐시는 자동 전환에서 재사용하고 수동 갱신만 강제 조회한다', async () => {
    const fixture = createFetchContext();
    fixture.context.isFxStale = () => false;

    await fixture.fetchAndApplyFxRate();
    assert.equal(fixture.requests.length, 0);
    assert.equal(fixture.state.statusUpdated, true);

    const forced = fixture.fetchAndApplyFxRate(true);
    assert.equal(fixture.requests.length, 1);
    fixture.requests[0].resolve(1399);
    await forced;
});

test('상품 자동 전환은 캐시를 존중하고 버튼만 강제 갱신한다', () => {
    assert.equal(
        (html.match(/fetchAndApplyFxRate\(true\)/g) || []).length,
        1,
        '강제 갱신 호출은 환율 불러오기 버튼 하나여야 합니다.',
    );
    assert.match(
        html,
        /fxFetchBtn\.addEventListener\('click', \(\) => fetchAndApplyFxRate\(true\)\)/,
    );
});
