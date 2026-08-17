const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const htmlPath = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const selectionMatch = html.match(
    /\/\/ DEFAULT_PRODUCT_SELECTION_START([\s\S]*?)\/\/ DEFAULT_PRODUCT_SELECTION_END/,
);

assert.ok(selectionMatch, 'HTML에서 기본 종목 선택 저장 블록을 찾을 수 있어야 합니다.');

function createSelectionFixture(entries = []) {
    const storage = new Map(entries);
    const context = vm.createContext({
        PRODUCTS: [
            { code: 'OPTION_A', id: 'OPTION_A', instrumentType: 'option' },
            { code: 'OPTION_B', id: 'OPTION_B', instrumentType: 'option' },
            { code: 'FUTURE_A', id: 'FUTURE_A', instrumentType: 'future' },
            { code: 'FUTURE_B', id: 'FUTURE_B', instrumentType: 'future' },
        ],
        STORAGE: {
            defaultFutureProductId: 'defaults.future',
            defaultOptionProductId: 'defaults.option',
            selectedProductCode: 'legacy.code',
            selectedProductId: 'legacy.id',
        },
        safeGetItem: (key) => storage.get(key) ?? null,
    });

    vm.runInContext(`${selectionMatch[1]}
this.getDefaultProductStorageKey = getDefaultProductStorageKey;
this.getSavedProductIdForInstrument = getSavedProductIdForInstrument;`, context);
    return context;
}

test('옵션과 선물의 기본 종목 저장 키를 분리한다', () => {
    const context = createSelectionFixture();
    assert.equal(context.getDefaultProductStorageKey('option'), 'defaults.option');
    assert.equal(context.getDefaultProductStorageKey('future'), 'defaults.future');
});

test('옵션과 선물 탭은 각 모드에 저장된 종목을 복원한다', () => {
    const context = createSelectionFixture([
        ['defaults.option', 'OPTION_B'],
        ['defaults.future', 'FUTURE_B'],
    ]);

    assert.equal(context.getSavedProductIdForInstrument('option'), 'OPTION_B');
    assert.equal(context.getSavedProductIdForInstrument('future'), 'FUTURE_B');
});

test('과거 단일 선택값은 같은 모드에서만 호환 기본값으로 사용한다', () => {
    const context = createSelectionFixture([
        ['legacy.id', 'FUTURE_B'],
    ]);

    assert.equal(context.getSavedProductIdForInstrument('future'), 'FUTURE_B');
    assert.equal(context.getSavedProductIdForInstrument('option'), null);
});

test('기본값 저장과 탭 전환·부트스트랩이 저장 전용 선택값을 사용한다', () => {
    assert.match(
        html,
        /safeSetItem\(getDefaultProductStorageKey\(selectedProduct\.instrumentType\), selectedKey\)/,
    );
    assert.match(html, /safeSetItem\(STORAGE\.defaultInstrumentType, selectedProduct\.instrumentType\)/);
    assert.match(
        html,
        /preferredProductId\s*\?\? getSavedProductIdForInstrument\(selectedInstrumentType\)/,
    );
    assert.match(
        html,
        /safeGetItem\(STORAGE\.defaultInstrumentType\)[\s\S]*?safeGetItem\(STORAGE\.selectedInstrumentType\)/,
    );

    const productUiMatch = html.match(
        /function updateProductUI\(product\) \{([\s\S]*?)\r?\n        \}\r?\n\r?\n        function setFxStatus/,
    );
    assert.ok(productUiMatch, '상품 UI 갱신 함수를 찾을 수 있어야 합니다.');
    assert.doesNotMatch(productUiMatch[1], /safeSetItem\(STORAGE\.selectedProduct/);
    assert.doesNotMatch(productUiMatch[1], /safeSetItem\(STORAGE\.selectedInstrumentType/);
});
