import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STOCK_API_URL = 'https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo';
const INDEX_API_URL = 'https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex';
const DAY_MS = 24 * 60 * 60 * 1000;
const API_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

const STOCK_TARGETS = [
    { productId: 'FUTURE_SAMSUNG', ticker: '005930', name: '삼성전자' },
    { productId: 'FUTURE_SK_HYNIX', ticker: '000660', name: 'SK하이닉스' },
];

function decodeServiceKey(rawKey) {
    const trimmed = String(rawKey ?? '').trim();
    if (!trimmed) throw new Error('DATA_GO_KR_SERVICE_KEY가 필요합니다.');
    try {
        return decodeURIComponent(trimmed);
    } catch {
        return trimmed;
    }
}

function formatApiDate(date) {
    return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function formatOutputDate(apiDate) {
    const value = String(apiDate ?? '');
    if (!/^\d{8}$/.test(value)) throw new Error(`유효하지 않은 기준일: ${value}`);
    return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function normalizeName(value) {
    return String(value ?? '').replace(/\s+/g, '').toUpperCase();
}

export function extractItems(payload) {
    const header = payload?.response?.header;
    const resultCode = String(header?.resultCode ?? '');
    if (resultCode && resultCode !== '00' && resultCode !== '0') {
        throw new Error(`공공데이터 API 오류: ${header?.resultMsg ?? resultCode}`);
    }

    const rawItems = payload?.response?.body?.items?.item;
    if (!rawItems) return [];
    return Array.isArray(rawItems) ? rawItems : [rawItems];
}

export function selectLatestCommonClose(stockItemsByProduct, indexItems) {
    const stockMaps = Object.fromEntries(Object.entries(stockItemsByProduct).map(([productId, items]) => {
        const prices = new Map();
        for (const item of items) {
            const close = Number(item.clpr);
            if (/^\d{8}$/.test(String(item.basDt)) && Number.isFinite(close) && close > 0) {
                prices.set(String(item.basDt), close);
            }
        }
        return [productId, prices];
    }));

    const indexPrices = new Map();
    for (const item of indexItems) {
        const normalized = normalizeName(item.idxNm);
        const close = Number(item.clpr);
        if (
            (normalized === '코스피200' || normalized === 'KOSPI200')
            && /^\d{8}$/.test(String(item.basDt))
            && Number.isFinite(close)
            && close > 0
        ) {
            indexPrices.set(String(item.basDt), close);
        }
    }

    const allMaps = [...Object.values(stockMaps), indexPrices];
    const commonDates = [...(allMaps[0]?.keys() ?? [])]
        .filter((date) => allMaps.every((prices) => prices.has(date)))
        .sort()
        .reverse();
    const asOf = commonDates[0];
    if (!asOf) throw new Error('모든 대상 종목에 공통으로 존재하는 최근 종가를 찾지 못했습니다.');

    return {
        asOf: formatOutputDate(asOf),
        stockPrices: Object.fromEntries(Object.entries(stockMaps).map(([productId, prices]) => [productId, prices.get(asOf)])),
        kospi200: indexPrices.get(asOf),
    };
}

export function hasSameMarketCloseItems(previousSnapshot, nextSnapshot) {
    return Boolean(
        previousSnapshot?.items
        && nextSnapshot?.items
        && isDeepStrictEqual(previousSnapshot.items, nextSnapshot.items),
    );
}

function createApiUrl(endpoint, serviceKey, params) {
    const url = new URL(endpoint);
    url.searchParams.set('serviceKey', serviceKey);
    url.searchParams.set('resultType', 'json');
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '100');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url;
}

function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function writeRetryLog(message) {
    process.stderr.write(`[종가 갱신] ${message}\n`);
}

function formatSafeError(error, serviceKey) {
    let message = error instanceof Error ? error.message : String(error);
    const causeCode = error?.cause?.code;
    if (causeCode && !message.includes(causeCode)) message = `${message} (${causeCode})`;

    const secretVariants = [serviceKey, encodeURIComponent(serviceKey)]
        .filter((value) => typeof value === 'string' && value.length >= 4);
    for (const secret of secretVariants) message = message.replaceAll(secret, '***');
    return message;
}

async function fetchApiItems(endpoint, serviceKey, params, options = {}) {
    const {
        fetchImpl = fetch,
        label = '공공데이터 API',
        logger = writeRetryLog,
        retryDelays = API_RETRY_DELAYS_MS,
        sleepImpl = wait,
    } = options;
    const requestUrl = createApiUrl(endpoint, serviceKey, params);
    const totalAttempts = retryDelays.length + 1;

    for (let attemptIndex = 0; attemptIndex < totalAttempts; attemptIndex += 1) {
        try {
            const response = await fetchImpl(requestUrl, {
                headers: { Accept: 'application/json' },
                signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return extractItems(await response.json());
        } catch (error) {
            const attempt = attemptIndex + 1;
            const safeError = formatSafeError(error, serviceKey);
            if (attempt === totalAttempts) {
                throw new Error(`${label} 조회 실패 (${attempt}/${totalAttempts}회 시도): ${safeError}`, {
                    cause: error,
                });
            }

            const retryDelay = retryDelays[attemptIndex];
            logger(`${label} 요청 실패 (${attempt}/${totalAttempts}): ${safeError} · ${retryDelay / 1000}초 후 재시도`);
            await sleepImpl(retryDelay);
        }
    }

    throw new Error(`${label} 조회에 실패했습니다.`);
}

export async function buildMarketCloseSnapshot({
    serviceKey,
    now = new Date(),
    fetchImpl = fetch,
    logger = writeRetryLog,
    retryDelays = API_RETRY_DELAYS_MS,
    sleepImpl = wait,
}) {
    const decodedKey = decodeServiceKey(serviceKey);
    const endDate = new Date(now.getTime() + DAY_MS);
    const beginDate = new Date(now.getTime() - 21 * DAY_MS);
    const dateParams = {
        beginBasDt: formatApiDate(beginDate),
        endBasDt: formatApiDate(endDate),
    };

    const stockEntries = await Promise.all(STOCK_TARGETS.map(async (target) => {
        const items = await fetchApiItems(STOCK_API_URL, decodedKey, {
            ...dateParams,
            likeSrtnCd: target.ticker,
        }, {
            fetchImpl,
            label: `주식시세 ${target.name}(${target.ticker})`,
            logger,
            retryDelays,
            sleepImpl,
        });
        const exactItems = items.filter((item) => String(item.srtnCd) === target.ticker);
        if (!exactItems.length) throw new Error(`${target.name}(${target.ticker}) 종가를 찾지 못했습니다.`);
        return [target.productId, exactItems];
    }));

    const indexItems = await fetchApiItems(INDEX_API_URL, decodedKey, {
        ...dateParams,
        likeIdxNm: '코스피',
    }, {
        fetchImpl,
        label: '지수시세 코스피200',
        logger,
        retryDelays,
        sleepImpl,
    });
    const selected = selectLatestCommonClose(Object.fromEntries(stockEntries), indexItems);

    return {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        source: {
            name: '금융위원회 공공데이터포털(KRX)',
            stockApi: 'https://www.data.go.kr/data/15094808/openapi.do',
            indexApi: 'https://www.data.go.kr/data/15094807/openapi.do',
            updateNote: '기준일 다음 영업일 오후 1시 이후 갱신되는 일별 종가',
        },
        items: {
            FUTURE_SAMSUNG: {
                underlying: '삼성전자',
                code: '005930',
                asOf: selected.asOf,
                close: selected.stockPrices.FUTURE_SAMSUNG,
            },
            FUTURE_SK_HYNIX: {
                underlying: 'SK하이닉스',
                code: '000660',
                asOf: selected.asOf,
                close: selected.stockPrices.FUTURE_SK_HYNIX,
            },
            FUTURE_KOSPI200_MINI: {
                underlying: '코스피200',
                code: 'KOSPI200',
                asOf: selected.asOf,
                close: selected.kospi200,
            },
            FUTURE_KOSPI200: {
                underlying: '코스피200',
                code: 'KOSPI200',
                asOf: selected.asOf,
                close: selected.kospi200,
            },
        },
    };
}

async function main() {
    const snapshot = await buildMarketCloseSnapshot({
        serviceKey: process.env.DATA_GO_KR_SERVICE_KEY,
    });
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const outputDirectory = path.join(projectRoot, 'data');
    const outputPath = path.join(outputDirectory, 'market-close.json');
    const temporaryPath = `${outputPath}.tmp`;

    try {
        const previousSnapshot = JSON.parse(await readFile(outputPath, 'utf8'));
        if (hasSameMarketCloseItems(previousSnapshot, snapshot)) {
            process.stdout.write(`전일 KRX 종가 변경 없음: ${snapshot.items.FUTURE_SAMSUNG.asOf}\n`);
            return;
        }
    } catch (error) {
        if (error?.code !== 'ENOENT') {
            process.stderr.write(`[종가 갱신] 기존 종가 파일을 읽지 못해 새로 작성합니다: ${error.message}\n`);
        }
    }

    await mkdir(outputDirectory, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, outputPath);
    process.stdout.write(`전일 KRX 종가 갱신 완료: ${snapshot.items.FUTURE_SAMSUNG.asOf}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
