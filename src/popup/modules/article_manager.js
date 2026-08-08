import { extractArticle } from './extraction_logic.js';

// Cross-browser compatibility
const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

/**
 * Article Manager
 * Handles article detection and extraction via content scripts
 */
export class ArticleManager {
    constructor() {
        this.articleData = null;
    }

    /**
     * Check if current tab has a valid article
     * @returns {Promise<Object>} The extracted article data or null
     */
    async checkArticle() {
        try {
            const [tab] = await browserAPI.tabs.query({ active: true, currentWindow: true });

            if (!tab || !tab.id) {
                throw new Error('No active tab found');
            }

            // check if we can access the tab (e.g. chrome:// urls are restricted)
            if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
                throw new Error('Cannot access this page type');
            }

            console.log('[Article Manager] Checking tab:', tab.url);

            // First, inject Readability into the page if not already present
            try {
                // We inject it every time just in case. Content scripts usually run once but popup re-runs.
                // However, executeScript files: [] runs immediately.
                await browserAPI.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['src/content/extraction_helpers.js', 'src/content/readability.min.js']
                });
                console.log('[Article Manager] Readability injected');
            } catch (injectError) {
                console.log('[Article Manager] Could not inject Readability (maybe already there?):', injectError.message);
                // Continue anyway, extraction logic checks for Readability presence
            }

            // Now execute extraction logic
            const results = await browserAPI.scripting.executeScript({
                target: { tabId: tab.id },
                func: extractArticle
            });

            const result = results?.[0]?.result;
            console.log('[Article Manager] Extraction result:', result);

            if (result && result.success) {
                this.articleData = result.article;
                return result.article;
            } else {
                console.log('[Article Manager] No article found:', result?.reason);
                return null;
            }

        } catch (error) {
            console.error('[Article Manager] Article check error:', error);
            throw error;
        }
    }

    getArticleData() {
        return this.articleData;
    }
}
