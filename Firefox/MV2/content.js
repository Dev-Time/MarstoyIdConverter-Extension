(function () {
    const API_KEY = 'YOUR_API_KEY'; // Replace with your actual Rebrickable API key
    const debugMode = false; // Set to true to enable debug logs
    const PRODUCT_TITLE_SELECTOR = 'h1.product-detail__title, h1.product__title, h1.product-title, h1.product-info__header_title.dj_skin_product_title';

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
    // Cache helpers (Firefox browser.storage)
    // -------------------------
    async function getCacheItem(productId) {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
            try {
                const result = await browser.storage.local.get(productId);
                return result[productId] || null;
            } catch (error) {
                logDebug('Error getting cache item from storage:', error);
                return null;
            }
        } else {
            logDebug('browser.storage.local is not available');
            return null;
        }
    }

    async function setCacheItem(productId, data) {
        if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
            try {
                await browser.storage.local.set({ [productId]: data });
                logDebug(`Cache item for ${productId} successfully updated in browser.storage.local.`);
            } catch (error) {
                logDebug('Error setting cache item in storage:', error);
            }
        } else {
            logDebug('browser.storage.local is not available');
        }
    }

    async function logCacheMetrics() {
        if (!debugMode) return;
        if (!(typeof browser !== 'undefined' && browser.storage && browser.storage.local)) return;
        try {
            const items = await browser.storage.local.get(null);
            const productKeys = Object.keys(items).filter(key => key.startsWith('M'));
            const itemCount = productKeys.length;
            const cacheSizeInBytes = new Blob([JSON.stringify(items)]).size;
            logDebug(`Cache contains ${itemCount} items, size: ${cacheSizeInBytes} bytes`);

            if (browser.storage.local.getBytesInUse) {
                const bytesInUse = await browser.storage.local.getBytesInUse(null);
                logDebug(`Storage currently using ${bytesInUse} bytes`);
            }

            if (debugMode) {
                logDebug(`Cached data: ${JSON.stringify(items)}`);
            }
        } catch (error) {
            logDebug('Error logging cache metrics:', error);
        }
    }

    // -------------------------
    // Rebrickable fetch
    // -------------------------
    async function fetchFromRebrickable(id) {
        const url = `https://rebrickable.com/api/v3/lego/sets/${id}-1/`;
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
                logDebug(`Failed to fetch data from Rebrickable (${response.status}) for ID: ${id}`);
                return null;
            }

            const data = await response.json();
            if (data && data.name) {
                return {
                    name: String(data.name || '').trim(),
                    imageUrl: data.set_img_url || '',
                    set_num: data.set_num || '',
                    year: data.year || '',
                    num_parts: data.num_parts || '',
                    set_url: data.set_url || ''
                };
            }
        } catch (error) {
            logDebug(`Error fetching from Rebrickable for ID: ${id}`, error);
        }
        return null;
    }

    async function fetchRebrickableData(productId) {
        const normalizedProductId = productId.toUpperCase();
        logDebug(`Normalized product ID: ${normalizedProductId}`);

        const cachedData = await getCacheItem(normalizedProductId);

        if (cachedData) {
            logDebug(`Cache hit for product ID: ${normalizedProductId}`, cachedData);
            return cachedData;
        } else {
            logDebug(`Cache miss for product ID: ${normalizedProductId}`);
        }

        const digits = productId.slice(1);
        let reversedId = digits.split('').reverse().join('');
        logDebug(`Reversed ID for Rebrickable lookup: ${reversedId}`);

        let data = await fetchFromRebrickable(reversedId);

        // Fallback for import/Shopify bug where reversedId has an extra trailing '1' (e.g. 759971 instead of 75997)
        if (!data && reversedId.length === 6 && !reversedId.startsWith('9') && reversedId.endsWith('1')) {
            const fallbackReversedId = reversedId.slice(0, -1);
            logDebug(`Attempting fallback Rebrickable lookup without trailing '1': ${fallbackReversedId}`);
            data = await fetchFromRebrickable(fallbackReversedId);
        }

        if (data) {
            await setCacheItem(normalizedProductId, data);
            return data;
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
        if (titleEl.matches(PRODUCT_TITLE_SELECTOR)) {
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
    function injectLegoDescription(productId, rebrickableData) {
        const infoDiv = document.querySelector('.product-detail__info');
        if (!infoDiv) return;

        let descContainer = document.getElementById('mst-lego-description');
        if (!descContainer) {
            descContainer = document.createElement('div');
            descContainer.id = 'mst-lego-description';
            descContainer.style.marginTop = '24px';
            descContainer.style.padding = '20px';
            descContainer.style.border = '1px solid #e5e7eb';
            descContainer.style.borderRadius = '12px';
            descContainer.style.backgroundColor = '#f9fafb';
            descContainer.style.fontFamily = 'Inter, sans-serif';
            descContainer.style.fontSize = '14px';
            descContainer.style.color = '#374151';
            descContainer.style.lineHeight = '1.6';
            infoDiv.appendChild(descContainer);
        }

        const isNSeries = productId.toUpperCase().startsWith('N');
        const setNum = rebrickableData.set_num || `${productId.slice(1).split('').reverse().join('')}-1`;
        const year = rebrickableData.year || 'N/A';
        const numParts = rebrickableData.num_parts || 'N/A';
        const setUrl = rebrickableData.set_url || `https://rebrickable.com/sets/${setNum}/`;

        const disclaimerHtml = isNSeries
            ? `<div style="margin-top: 16px; padding: 12px 16px; border-radius: 8px; border: 1px solid #fecaca; background-color: #fef2f2; color: #991b1b; display: flex; align-items: flex-start; gap: 8px;">
                <span style="font-size: 18px; line-height: 1;">⚠️</span>
                <div>
                    <strong style="display: block; font-weight: 700; margin-bottom: 2px;">Disclaimer (Basic Parts Only)</strong>
                    This is an N-series Parts Pack. It contains basic building bricks only. Minifigures, stickers, printed parts, and paper instructions are NOT included.
                </div>
               </div>`
            : `<div style="margin-top: 16px; padding: 12px 16px; border-radius: 8px; border: 1px solid #e5e7eb; background-color: #f3f4f6; color: #4b5563; display: flex; align-items: flex-start; gap: 8px;">
                <span style="font-size: 18px; line-height: 1;">ℹ️</span>
                <div>
                    <strong style="display: block; font-weight: 700; margin-bottom: 2px;">Building Kit Info</strong>
                    This is an M-series Building Toy Kit matching the original set design. Minifigures and stickers are generally included, but instructions may need to be downloaded.
                </div>
               </div>`;

        descContainer.innerHTML = `
            <div style="font-weight: 700; font-size: 16px; color: #111827; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                <span>🧱</span> Official LEGO® Set Information
            </div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px;">
                <div><strong>Lego Set:</strong> ${rebrickableData.name}</div>
                <div><strong>Set Number:</strong> ${setNum}</div>
                <div><strong>Year Released:</strong> ${year}</div>
                <div><strong>Part Count:</strong> ${numParts} pcs</div>
            </div>
            <div style="margin-top: 8px;">
                <a href="${setUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; font-weight: 500;">View this set on Rebrickable</a>
            </div>
            ${disclaimerHtml}
        `;
    }

    async function updateProductTitleAndImage(productTitleElement, productId) {
        logDebug(`Updating product with ID: ${productId}`);

        const rebrickableData = await fetchRebrickableData(productId);
        const invalidKeywords = ["Plates", "Beams", "Bricks", "Miscellaneous"];

        if (rebrickableData && !invalidKeywords.some(keyword => rebrickableData.name.includes(keyword))) {
            const isNSeries = productId.toUpperCase().startsWith('N');
            const suffix = isNSeries ? ' (Basic Parts Only)' : '';
            const cleanName = rebrickableData.name.replace(/\s+/g, ' ').trim();
            
            productTitleElement.textContent = cleanName + suffix;
            logDebug(`Updated product title to: ${cleanName}${suffix}`);

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
                productImageElement.alt = cleanName + suffix;
                productImageElement.style.objectFit = 'contain';
                logDebug(`Updated product image to: ${rebrickableData.imageUrl}`);
            } else {
                logDebug('Product image element not found or no image URL provided.');
            }

            if (productTitleElement.matches(PRODUCT_TITLE_SELECTOR)) {
                injectLegoDescription(productId, rebrickableData);
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
        const productTitleElement = document.querySelector(PRODUCT_TITLE_SELECTOR);
        if (!productTitleElement) {
            logDebug('Product title element not found on product page.');
            return;
        }
        if (isProcessed(productTitleElement)) return;

        // Prefer extracting the ID from the URL (e.g. /products/moc-m87077-parts-kit)
        const urlPath = location.pathname;
        let match = urlPath.match(/\/products\/(?:moc-)?([a-z])?(\d+)/i);
        let productId = null;
        if (match) {
            const prefix = match[1] ? match[1].toUpperCase() : 'M';
            productId = `${prefix}${match[2]}`;
        }

        // Fallback: scan text on page if needed
        if (!productId) {
            const text = `${productTitleElement.textContent} ${document.body.textContent}`;
            const idMatch = text.match(/\b([A-Z])\s?(\d+)\b/i);
            if (idMatch) {
                productId = `${idMatch[1].toUpperCase()}${idMatch[2]}`;
            }
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
        const found = document.querySelectorAll(selectors.join(','));
        if (found.length > 0) {
            nodes = Array.from(found);
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
                const m = link.href.match(/\/products\/(?:moc-)?([a-z])?(\d+)/i);
                if (m) {
                    const prefix = m[1] ? m[1].toUpperCase() : 'M';
                    productId = `${prefix}${m[2]}`;
                }
            }

            if (!productId) {
                const text = titleEl.textContent.trim();
                const idMatch = text.match(/\b([A-Z])\s?(\d+)\b/i);
                if (idMatch) {
                    productId = `${idMatch[1].toUpperCase()}${idMatch[2]}`;
                }
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

    // -------------------------
    // Wishlist page processor
    // -------------------------
    function processWishlistPage() {
        logDebug('Processing wishlist page...');
        const productTitleElements = document.querySelectorAll('p.p-text-wish_desc');

        productTitleElements.forEach((element, index) => {
            if (isProcessed(element)) return;

            const productIdText = element.textContent.trim();
            const productIdMatch = productIdText.match(/[a-z]\d+/i);

            if (productIdMatch) {
                const productId = productIdMatch[0].toUpperCase();
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
        if (document.querySelector(PRODUCT_TITLE_SELECTOR)) {
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

    let lastHref = location.href;

    function observeDom() {
        const rerun = debounce(() => {
            const urlChanged = location.href !== lastHref;
            if (urlChanged) {
                lastHref = location.href;
                logDebug('URL changed (SPA transition): clearing processed markers');
                document.querySelectorAll('[data-mst-processed]').forEach(el => {
                    delete el.dataset.mstProcessed;
                });
            }

            const hasTargets = document.querySelector(
                'li.product-block, .product-card-wrapper, h3.product__title, theme-product-card, .block-product-card, .block-product-title, .recommend-product-item-title, p.p-text-wish_desc, ' + PRODUCT_TITLE_SELECTOR
            );
            if (urlChanged || hasTargets) {
                logDebug('DOM or URL changed: re-processing page elements');
                determineAndProcessPage();
            }
        }, 300);

        const obs = new MutationObserver(rerun);
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // -------------------------
    // Runtime message listener (Firefox)
    // -------------------------
    if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.onMessage) {
        browser.runtime.onMessage.addListener((request, sender) => {
            if (request && request.action === 'convert') {
                logDebug('Manual conversion triggered.');
                determineAndProcessPage();
                // In Firefox, returning a Promise keeps the channel alive if needed
                return Promise.resolve({ status: 'Update complete!' });
            }
        });
    }

    // -------------------------
    // Kickoff
    // -------------------------
    determineAndProcessPage(); // initial pass
    observeDom();              // keep up with lazy-loaded / dynamically injected cards
})();