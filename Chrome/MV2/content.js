(function () {
    const API_KEY = 'YOUR_API_KEY'; // Replace with your actual Rebrickable API key
    const debugMode = false; // Set to true to enable debug logs

    // -------------------------
    // Logging
    // -------------------------
    function logDebug(message, data = null) {
        if (debugMode) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] ${message}`, data || '');
        }
    }

    // -------------------------
    // Cache helpers
    // -------------------------
    function getCacheItem(productId) {
        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                chrome.storage.local.get(productId, (result) => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        logDebug('Error getting cache item from storage:', chrome.runtime.lastError);
                        resolve(null);
                    } else {
                        resolve(result[productId] || null);
                    }
                });
            } else {
                logDebug('chrome.storage.local is not available');
                resolve(null);
            }
        });
    }

    function setCacheItem(productId, data) {
        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage) {
                chrome.storage.local.set({ [productId]: data }, () => {
                    if (chrome.runtime && chrome.runtime.lastError) {
                        logDebug('Error setting cache item in storage:', chrome.runtime.lastError);
                    } else {
                        logDebug(`Cache item for ${productId} successfully updated in chrome.storage.local.`);
                    }
                    resolve();
                });
            } else {
                logDebug('chrome.storage.local is not available');
                resolve();
            }
        });
    }

    function logCacheMetrics() {
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

    // -------------------------
    // Rebrickable fetch
    // -------------------------
    async function fetchRebrickableData(productId) {
        const normalizedProductId = productId.toUpperCase();
        logDebug(`Normalized product ID: ${normalizedProductId}`);

        const cachedData = await getCacheItem(normalizedProductId);
        logCacheMetrics();

        if (cachedData) {
            logDebug(`Cache hit for product ID: ${normalizedProductId}`, cachedData);
            return cachedData;
        } else {
            logDebug(`Cache miss for product ID: ${normalizedProductId}`);
        }

        // Reverse the numeric part (M12345 -> 54321)
        const reversedId = productId.slice(1).split('').reverse().join('');
        logDebug(`Reversed ID for Rebrickable lookup: ${reversedId}`);

        const url = `https://rebrickable.com/api/v3/lego/sets/${reversedId}-1/`;
        logDebug(`Rebrickable API URL: ${url}`);

        const startTime = performance.now();

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `key ${API_KEY}`
                }
            });

            const endTime = performance.now();
            logDebug(`Network request completed in ${(endTime - startTime).toFixed(2)} ms`);

            if (!response.ok) {
                if (response.status === 429) {
                    logDebug('Rebrickable rate-limited (429). Backing off for this product ID.');
                } else {
                    logDebug(`Failed to fetch data from Rebrickable (${response.status}) for product ID: ${normalizedProductId}`, response.statusText);
                }
                return null;
            }

            const data = await response.json();
            if (data && data.name) {
                const productName = String(data.name || '').trim();
                const productImageUrl = data.set_img_url || '';
                logDebug(`Product name found on Rebrickable: ${productName}`);
                logDebug(`Product image URL: ${productImageUrl}`);

                const payload = { name: productName, imageUrl: productImageUrl };
                await setCacheItem(normalizedProductId, payload);
                return payload;
            } else {
                logDebug(`Product name not found in Rebrickable data for product ID: ${normalizedProductId}`);
            }
        } catch (error) {
            logDebug(`Error fetching data from Rebrickable for product ID: ${normalizedProductId}`, error);
        }

        return null;
    }

    // -------------------------
    // DOM helpers
    // -------------------------
    function getProductCardWrapper(node) {
        if (!node) return null;
        return node.closest('theme-product-card')
            || node.closest('.block-product-card')
            || node.closest('product-item')
            || node.closest('.product-card-wrapper')
            || node.closest('li.product-block')
            || node.closest('.recommend-product-item')
            || node;
    }

    function markAsProcessed(node) {
        const card = getProductCardWrapper(node);
        if (card) card.dataset.mstProcessed = '1';
    }

    function isProcessed(node) {
        const card = getProductCardWrapper(node);
        return !!(card && card.dataset.mstProcessed === '1');
    }

    function findProductImageElementFromTitle(titleEl) {
        // Product detail page
        if (titleEl.matches('h1.product-detail__title, h1.product__title, h1.product-title, h1.product-info__header_title.dj_skin_product_title')) {
            return document.querySelector('img.media-gallery__image, .product-detail__media img, .product-single__photo img, img.product-featured-media');
        }

        const card = getProductCardWrapper(titleEl);
        if (!card) return null;

        // Primary target in new theme
        let img = card.querySelector('img.block-product-image__image')
            || card.querySelector('a.card__media img')
            || card.querySelector('.recommend-product-item-image img')
            || card.querySelector('.recommend-product-item-image-media img')
            || card.querySelector('.recommend-product-item-image-wrapper img');
        if (img) return img;

        // Fallbacks across variants
        img = card.querySelector('img.collection-hero__image')
            || card.querySelector('.card__inner img')
            || card.querySelector('.block-product-image__image-wrapper img')
            || card.querySelector('img');
        return img || null;
    }

    // -------------------------
    // Update title + image
    // -------------------------
    async function updateProductTitleAndImage(productTitleElement, productId) {
        logDebug(`Updating product with ID: ${productId}`);

        const rebrickableData = await fetchRebrickableData(productId);
        const invalidKeywords = ["Plates", "Beams", "Bricks", "Miscellaneous"];

        if (rebrickableData && !invalidKeywords.some(keyword => rebrickableData.name.includes(keyword))) {
            // Normalize whitespace in case the theme injects odd spacing
            productTitleElement.textContent = rebrickableData.name.replace(/\s+/g, ' ').trim();
            logDebug(`Updated product title to: ${rebrickableData.name}`);

            const productImageElement =
                findProductImageElementFromTitle(productTitleElement) ||
                (productTitleElement.closest('.p-cursor-pointer') && productTitleElement.closest('.p-cursor-pointer').querySelector('img')); // wishlist fallback

            if (productImageElement && rebrickableData.imageUrl) {
                productImageElement.src = rebrickableData.imageUrl;
                productImageElement.srcset = [
                    `${rebrickableData.imageUrl} 375w`,
                    `${rebrickableData.imageUrl} 540w`,
                    `${rebrickableData.imageUrl} 720w`,
                    `${rebrickableData.imageUrl} 800w`
                ].join(', ');
                productImageElement.alt = rebrickableData.name;
                productImageElement.style.objectFit = 'contain';
                logDebug(`Updated product image to: ${rebrickableData.imageUrl}`);
            } else {
                logDebug('Product image element not found or no image URL provided.');
            }
        } else {
            logDebug('No matching title found on Rebrickable or title seems incorrect.');
        }
    }

    // -------------------------
    // Page processors
    // -------------------------
    function processProductPage() {
        logDebug('Processing product page...');
        const productTitleElement = document.querySelector(
            'h1.product-detail__title, h1.product__title, h1.product-title, h1.product-info__header_title.dj_skin_product_title'
        );
        if (!productTitleElement) {
            logDebug('Product title element not found on product page.');
            return;
        }
        if (isProcessed(productTitleElement)) return;

        // Prefer extracting the ID from the URL (e.g. /products/moc-m87077-parts-kit)
        const urlPath = location.pathname;
        let match = urlPath.match(/\/products\/(?:moc-)?m?(\d+)/i);
        let productId = match ? `M${match[1]}` : null;

        // Fallback: scan text on page if needed
        if (!productId) {
            const text = `${productTitleElement.textContent} ${document.body.innerText}`;
            const idMatch = text.match(/\bM\s?(\d+)\b/i);
            if (idMatch) productId = `M${idMatch[1]}`;
        }

        if (productId) {
            logDebug(`Product ID found: ${productId}`);
            Promise.resolve(updateProductTitleAndImage(productTitleElement, productId))
                .finally(() => markAsProcessed(productTitleElement));
        } else {
            logDebug('Product ID not found on product page.');
        }
    }

    function processProductListingPage() {
        logDebug('Processing product listing page...');
        const selectors = [
            '.block-product-title',
            '.recommend-product-item-title',
            'h3.product__title',
            '.product-card-wrapper a.full-unstyled-link .visually-hidden'
        ];
        
        let nodes = [];
        for (const selector of selectors) {
            const found = document.querySelectorAll(selector);
            if (found.length > 0) {
                nodes = nodes.concat(Array.from(found));
            }
        }
        
        if (nodes.length === 0) {
            // Ultimate fallback
            const cardSelector = 'theme-product-card, .block-product-card, product-item, .product-card-wrapper, li.product-block, .recommend-product-item';
            const cards = document.querySelectorAll(cardSelector);
            if (cards.length > 0) {
                nodes = Array.from(cards).map(card => {
                    return card.querySelector('a[href*="/products/"]');
                }).filter(el => el !== null);
            }
        }

        nodes.forEach((titleEl, index) => {
            if (isProcessed(titleEl)) return;

            const card = getProductCardWrapper(titleEl);
            let link = null;
            if (titleEl.tagName === 'A' && titleEl.href && titleEl.href.includes('/products/')) {
                link = titleEl;
            } else if (card && card.tagName === 'A' && card.href && card.href.includes('/products/')) {
                link = card;
            } else if (card) {
                link = card.querySelector('a.full-unstyled-link, a.card__media, a.block-product-title, a.recommend-product-item, a[href*="/products/"]');
            }

            let productId = null;
            if (link && link.href) {
                const m = link.href.match(/\/products\/(?:moc-)?m?(\d+)/i);
                if (m) productId = `M${m[1]}`;
            }

            if (!productId) {
                const text = titleEl.textContent.trim();
                const idMatch = text.match(/\bM\s?(\d+)\b/i);
                if (idMatch) productId = `M${idMatch[1]}`;
            }

            if (productId) {
                logDebug(`Product ID found for element ${index}: ${productId}`);
                Promise.resolve(updateProductTitleAndImage(titleEl, productId))
                    .finally(() => markAsProcessed(titleEl));
            } else {
                logDebug(`No product ID found for element ${index}.`);
            }
        });
    }

    function processWishlistPage() {
        logDebug('Processing wishlist page...');
        const productTitleElements = document.querySelectorAll('p.p-text-wish_desc');

        productTitleElements.forEach((element, index) => {
            if (isProcessed(element)) return;

            const productIdText = element.textContent.trim();
            const productIdMatch = productIdText.match(/M\d+/);

            if (productIdMatch) {
                const productId = productIdMatch[0];
                logDebug(`Product ID found for wishlist item ${index}: ${productId}`);
                Promise.resolve(updateProductTitleAndImage(element, productId))
                    .finally(() => markAsProcessed(element));
            } else {
                logDebug(`No product ID found for wishlist item ${index}.`);
            }
        });
    }

    // -------------------------
    // Page detection
    // -------------------------
    function determineAndProcessPage() {
        // Run main product processor if applicable
        if (document.querySelector('h1.product-detail__title, h1.product__title, h1.product-title, h1.product-info__header_title.dj_skin_product_title')) {
            processProductPage();
        }
        
        // Run wishlist processor if applicable
        if (document.querySelector('p.p-text-wish_desc')) {
            processWishlistPage();
        }
        
        // Always run listing processor to catch collection grids, search results, or recommendations
        processProductListingPage();
    }

    // -------------------------
    // MutationObserver for dynamic content
    // -------------------------
    let listingDebounce;
    function debounce(fn, ms) {
        return (...args) => {
            clearTimeout(listingDebounce);
            listingDebounce = setTimeout(() => fn(...args), ms);
        };
    }

    function observeDom() {
        const rerun = debounce(() => {
            const hasTargets = document.querySelector(
                'li.product-block, .product-card-wrapper, h3.product__title, theme-product-card, .block-product-card, .block-product-title, .recommend-product-item-title, p.p-text-wish_desc'
            );
            if (hasTargets) {
                logDebug('DOM changed: re-processing page elements');
                determineAndProcessPage();
            }
        }, 300);

        const obs = new MutationObserver(rerun);
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // -------------------------
    // Runtime message listener
    // -------------------------
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request && request.action === 'convert') {
                logDebug('Manual conversion triggered.');
                determineAndProcessPage();
                sendResponse && sendResponse({ status: 'Update complete!' });
            }
        });
    }

    // -------------------------
    // Kickoff
    // -------------------------
    determineAndProcessPage(); // initial pass
    observeDom();              // keep up with lazy-loaded / dynamically injected cards
})();