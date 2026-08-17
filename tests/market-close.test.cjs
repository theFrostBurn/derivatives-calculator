const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const fetchMatch = html.match(
    /\/\/ MARKET_CLOSE_FETCH_START([\s\S]*?)\/\/ MARKET_CLOSE_FETCH_END/,
);

assert.ok(fetchMatch, 'HTML에서 전일 종가 조회 블록을 찾을 수 있어야 합니다.');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, reject, resolve };
}

function createClientContext() {
    const requests = [];
    const state = { recalculations: 0, statuses: [] };
    const context = vm.createContext({
        console: { error() {} },
        el: {
            futureReferencePrice: { value: '100' },
            marketCloseFetchBtn: { disabled: false },
        },
        fetchMarketCloseSnapshot: () => {
            const pending = deferred();
            requests.push(pending);
            return pending.promise;
        },
        formatMarketCloseDate: (value) => value,
        getMarketCloseAgeDays: () => 1,
        MARKET_CLOSE_MAX_AGE_DAYS: 7,
        marketCloseRequestSequence: 0,
        Number,
        recalculate: () => { state.recalculations += 1; },
        selectedProduct: {
            code: '삼성전자선물',
            displayDecimals: 0,
            id: 'FUTURE_SAMSUNG',
            instrumentType: 'future',
        },
        setMarketCloseStatus: (message, tone) => state.statuses.push({ message, tone }),
    });

    vm.runInContext(`${fetchMatch[1]}
this.fetchAndApplyMarketClose = fetchAndApplyMarketClose;`, context);
    return { context, fetchAndApplyMarketClose: context.fetchAndApplyMarketClose, requests, state };
}

test('선물 기준가격 옆에 전일 KRX 종가 조회 버튼과 상태 영역을 표시한다', () => {
    assert.match(html, /id="marketCloseFetchBtn"[^>]*>전일 KRX 종가 불러오기<\/button>/);
    assert.match(html, /id="marketCloseStatus" role="status" aria-live="polite"/);
    assert.match(
        html,
        /MARKET_CLOSE_DATA_URL = 'https:\/\/thefrostburn\.github\.io\/derivatives-calculator\/market-close\.json'/,
    );
});

test('종가 자동 갱신 워크플로는 공개용 종가 JSON 하나만 GitHub Pages에 배포한다', () => {
    const workflowPath = path.join(__dirname, '..', '.github', 'workflows', 'update-market-close.yml');
    const workflow = fs.readFileSync(workflowPath, 'utf8');

    assert.match(workflow, /uses: actions\/configure-pages@v6/);
    assert.match(workflow, /uses: actions\/upload-pages-artifact@v5/);
    assert.match(workflow, /cp data\/market-close\.json pages-market-close\/market-close\.json/);
    assert.match(workflow, /path: pages-market-close/);
    assert.match(workflow, /uses: actions\/deploy-pages@v5/);
    assert.doesNotMatch(workflow, /path: (?:['"]?\.['"]?|data)\s*$/m);
});

test('공식 종가를 현재 선물의 기준가격에 적용하고 다시 계산한다', async () => {
    const fixture = createClientContext();
    const request = fixture.fetchAndApplyMarketClose(true);
    fixture.requests[0].resolve({
        source: { name: '공식 테스트' },
        items: {
            FUTURE_SAMSUNG: { asOf: '2026-08-17', close: 274500 },
        },
    });
    await request;

    assert.equal(fixture.context.el.futureReferencePrice.value, '274500');
    assert.equal(fixture.state.recalculations, 1);
    assert.equal(fixture.context.el.marketCloseFetchBtn.disabled, false);
    assert.deepEqual(fixture.state.statuses.at(-1), {
        message: '2026-08-17 KRX 종가 · 공식 테스트',
        tone: 'success',
    });
});

test('종목 전환 뒤 늦게 도착한 응답은 현재 기준가격을 덮어쓰지 않는다', async () => {
    const fixture = createClientContext();
    const samsungRequest = fixture.fetchAndApplyMarketClose(true);
    fixture.context.selectedProduct = {
        code: 'SK하이닉스선물',
        displayDecimals: 0,
        id: 'FUTURE_SK_HYNIX',
        instrumentType: 'future',
    };
    const hynixRequest = fixture.fetchAndApplyMarketClose(true);

    fixture.requests[0].resolve({
        items: { FUTURE_SAMSUNG: { asOf: '2026-08-17', close: 274500 } },
    });
    await samsungRequest;
    assert.equal(fixture.context.el.futureReferencePrice.value, '100');

    fixture.requests[1].resolve({
        items: { FUTURE_SK_HYNIX: { asOf: '2026-08-17', close: 1718000 } },
    });
    await hynixRequest;
    assert.equal(fixture.context.el.futureReferencePrice.value, '1718000');
    assert.equal(fixture.state.recalculations, 1);
});

test('7일을 넘긴 종가와 조회 실패는 기존 수동 입력값을 유지한다', async () => {
    const fixture = createClientContext();
    fixture.context.getMarketCloseAgeDays = () => 8;
    const request = fixture.fetchAndApplyMarketClose(true);
    fixture.requests[0].resolve({
        items: { FUTURE_SAMSUNG: { asOf: '2026-08-01', close: 200000 } },
    });
    await request;

    assert.equal(fixture.context.el.futureReferencePrice.value, '100');
    assert.equal(fixture.state.recalculations, 0);
    assert.match(fixture.state.statuses.at(-1).message, /오래되어 적용하지 않았습니다/);
});

test('공식 시세 생성기는 동일 기준일의 주식·코스피200 종가만 선택한다', async () => {
    const modulePath = path.join(__dirname, '..', 'scripts', 'update-market-close.mjs');
    const { extractItems, selectLatestCommonClose } = await import(pathToFileURL(modulePath).href);

    assert.deepEqual(extractItems({ response: { body: { items: { item: { basDt: '20260817' } } } } }), [
        { basDt: '20260817' },
    ]);
    assert.throws(
        () => extractItems({ response: { header: { resultCode: '30', resultMsg: 'INVALID KEY' } } }),
        /공공데이터 API 오류/,
    );

    const selected = selectLatestCommonClose({
        FUTURE_SAMSUNG: [
            { basDt: '20260814', clpr: '260000' },
            { basDt: '20260817', clpr: '274500' },
        ],
        FUTURE_SK_HYNIX: [
            { basDt: '20260814', clpr: '1690000' },
            { basDt: '20260817', clpr: '1718000' },
        ],
    }, [
        { basDt: '20260814', idxNm: '코스피 200', clpr: '1000.1' },
        { basDt: '20260817', idxNm: '코스피 200', clpr: '1046.81' },
    ]);

    assert.deepEqual(selected, {
        asOf: '2026-08-17',
        stockPrices: {
            FUTURE_SAMSUNG: 274500,
            FUTURE_SK_HYNIX: 1718000,
        },
        kospi200: 1046.81,
    });
});

test('공식 API 응답으로 네 선물의 공개 종가 파일을 구성하고 인증키는 남기지 않는다', async () => {
    const modulePath = path.join(__dirname, '..', 'scripts', 'update-market-close.mjs');
    const { buildMarketCloseSnapshot } = await import(pathToFileURL(modulePath).href);
    const requestedUrls = [];
    const responses = [
        [{ basDt: '20260817', srtnCd: '005930', clpr: '274500' }],
        [{ basDt: '20260817', srtnCd: '000660', clpr: '1718000' }],
        [{ basDt: '20260817', idxNm: '코스피 200', clpr: '1046.81' }],
    ];
    const fetchImpl = async (url) => {
        requestedUrls.push(url);
        const items = responses.shift();
        return {
            ok: true,
            json: async () => ({
                response: {
                    header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' },
                    body: { items: { item: items } },
                },
            }),
        };
    };

    const snapshot = await buildMarketCloseSnapshot({
        serviceKey: 'encoded%2Btest%3D',
        now: new Date('2026-08-18T05:30:00.000Z'),
        fetchImpl,
    });

    assert.equal(snapshot.items.FUTURE_SAMSUNG.close, 274500);
    assert.equal(snapshot.items.FUTURE_SK_HYNIX.close, 1718000);
    assert.equal(snapshot.items.FUTURE_KOSPI200_MINI.close, 1046.81);
    assert.equal(snapshot.items.FUTURE_KOSPI200.close, 1046.81);
    assert.equal(JSON.stringify(snapshot).includes('encoded+test='), false);
    assert.equal(requestedUrls.length, 3);
    for (const url of requestedUrls) {
        assert.equal(url.searchParams.get('serviceKey'), 'encoded+test=');
        assert.equal(url.searchParams.get('resultType'), 'json');
    }
});
