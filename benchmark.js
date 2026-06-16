const fs = require('fs');

// We will mock chrome API
global.chrome = {
    storage: {
        local: {
            get: (key, cb) => {
                // simulate some delay
                let data = {};
                for(let i=0; i<1000; i++) {
                    data['M'+i] = { name: 'Test Set ' + i, imageUrl: 'http://example.com/' + i };
                }
                if (key === null) {
                    cb(data);
                } else {
                    cb({ [key]: data[key] });
                }
            },
            getBytesInUse: (key, cb) => {
                cb(100000);
            }
        }
    }
};

global.debugMode = false;
global.logDebug = () => {};
global.performance = require('perf_hooks').performance;

function logCacheMetricsBaseline() {
    if (!(typeof chrome !== 'undefined' && chrome.storage)) return;
    chrome.storage.local.get(null, (items) => {
        const productKeys = Object.keys(items).filter(key => key.startsWith('M'));
        const itemCount = productKeys.length;
        const cacheSizeInBytes = new Blob([JSON.stringify(items)]).size;
        logDebug(`Cache contains ${itemCount} items, size: ${cacheSizeInBytes} bytes`);

        chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
            logDebug(`Storage currently using ${bytesInUse} bytes`);
        });

        if (debugMode) {
            logDebug(`Cached data: ${JSON.stringify(items)}`);
        }
    });
}

function logCacheMetricsOptimized() {
    if (!debugMode) return;
    if (!(typeof chrome !== 'undefined' && chrome.storage)) return;
    chrome.storage.local.get(null, (items) => {
        const productKeys = Object.keys(items).filter(key => key.startsWith('M'));
        const itemCount = productKeys.length;
        const cacheSizeInBytes = new Blob([JSON.stringify(items)]).size;
        logDebug(`Cache contains ${itemCount} items, size: ${cacheSizeInBytes} bytes`);

        chrome.storage.local.getBytesInUse(null, (bytesInUse) => {
            logDebug(`Storage currently using ${bytesInUse} bytes`);
        });

        if (debugMode) {
            logDebug(`Cached data: ${JSON.stringify(items)}`);
        }
    });
}

async function runBenchmark() {
    const iterations = 1000;

    // Baseline
    let start = performance.now();
    for (let i = 0; i < iterations; i++) {
        logCacheMetricsBaseline();
    }
    let baselineTime = performance.now() - start;

    // Optimized
    start = performance.now();
    for (let i = 0; i < iterations; i++) {
        logCacheMetricsOptimized();
    }
    let optimizedTime = performance.now() - start;

    console.log(`Baseline time: ${baselineTime.toFixed(2)} ms`);
    console.log(`Optimized time: ${optimizedTime.toFixed(2)} ms`);
    console.log(`Improvement: ${((baselineTime - optimizedTime) / baselineTime * 100).toFixed(2)}%`);
}

runBenchmark();
