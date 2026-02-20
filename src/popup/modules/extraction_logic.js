/**
 * Article extraction logic
 * This function is stringified and injected into the page, so it must be self-contained.
 */
// Note: This function is stringified, so no imports allowed!
export function extractArticle() {
    try {
        console.log('[X4] Extracting article...');
        const hostname = window.location.hostname;
        const extractionHelpers = window.X4ExtractionHelpers || {
            countHeadingTags(html, minLevel = 2, maxLevel = 3) {
                if (!html || minLevel > maxLevel) return 0;
                let total = 0;
                for (let level = minLevel; level <= maxLevel; level++) {
                    const re = new RegExp(`<h${level}\\b`, 'gi');
                    total += (html.match(re) || []).length;
                }
                return total;
            },
            sanitizeHeadingClasses(rootNode) {
                if (!rootNode || typeof rootNode.querySelectorAll !== 'function') {
                    return 0;
                }
                const classTokenRe = /(^|[-_])(header|anchor)([-_]|$)/i;
                let removedCount = 0;
                rootNode.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((heading) => {
                    if (!heading || typeof heading.className !== 'string' || !heading.className) {
                        return;
                    }
                    const classes = heading.className.split(/\s+/).filter(Boolean);
                    if (classes.length === 0) return;
                    const kept = classes.filter((token) => !classTokenRe.test(token));
                    removedCount += classes.length - kept.length;
                    if (kept.length !== classes.length) {
                        heading.className = kept.join(' ');
                    }
                });
                return removedCount;
            },
            shouldUseHeadingFallback(sourceHtml, parsedHtml) {
                return this.countHeadingTags(sourceHtml) > 0 && this.countHeadingTags(parsedHtml) === 0;
            }
        };

        const getStructuredContentRoot = () => {
            // Prefer structured content roots (including Substack-like markup)
            // when Readability strips section headings from parsed output.
            const selectors = [
                '.available-content .body.markup',
                '.single-post-container .available-content',
                'article .body.markup',
                'article .markup',
                'article'
            ];

            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (el && (el.innerHTML || '').trim().length > 0) {
                    return el;
                }
            }

            return null;
        };

        // --- TWITTER / X SUPPORT ---
        if (hostname.includes('twitter.com') || hostname.includes('x.com')) {
            console.log('[X4] Detected Twitter/X');

            // 1. Identify Author from URL
            const urlParts = new URL(window.location.href).pathname.split('/');
            const authorHandle = urlParts[1]; // /username/status/...

            if (!authorHandle || !window.location.href.includes('/status/')) {
                // Fallback to Readability if not a specific thread/status
                console.log('[X4] Not a thread URL, using standard extraction');
            } else {
                console.log('[X4] Extracting Thread for:', authorHandle);

                // Select tweets
                const tweets = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
                let threadContent = [];
                let title = '';
                let firstTweetFound = false;

                console.log('[X4] Found tweets:', tweets.length);

                tweets.forEach((tweet, index) => {
                    // Check author via User-Name links
                    const userLinks = tweet.querySelectorAll('div[data-testid="User-Name"] a');
                    let isAuthor = false;
                    let debugLinks = [];

                    for (const link of userLinks) {
                        const href = link.getAttribute('href');
                        debugLinks.push(href);
                        if (href && href.replace('/', '').toLowerCase() === authorHandle.toLowerCase()) {
                            isAuthor = true;
                            break;
                        }
                    }

                    // console.log(`[X4] Tweet ${index} author check:`, isAuthor, debugLinks);

                    // Simple Thread Logic: Capture Author's tweets
                    if (isAuthor) {
                        // Extract Text
                        let textEl = tweet.querySelector('[data-testid="tweetText"]');
                        let isArticle = false;

                        // Fallback for Twitter Articles (Long Posts)
                        if (!textEl) {
                            textEl = tweet.querySelector('[data-testid="twitterArticleRichTextView"]');
                            isArticle = !!textEl;
                        }

                        const text = textEl ? textEl.innerHTML : '';
                        console.log(`[X4] Tweet ${index} text length:`, text.length);

                        // Extract Images
                        // const photoEls = tweet.querySelectorAll('[data-testid="tweetPhoto"] img');
                        // const photoUrls = Array.from(photoEls).map(img => img.src);

                        // Title logic
                        // For Articles, prefer the explicit article title
                        if (isArticle) {
                            const articleTitleEl = tweet.querySelector('[data-testid="twitter-article-title"]');
                            if (articleTitleEl) {
                                title = articleTitleEl.textContent.trim();
                            }
                        }
                        // Standard fallback
                        if (!title && textEl) {
                            title = textEl.textContent.substring(0, 50) + '...';
                        }

                        // Helper for XML escaping
                        const escapeXml = (str) => {
                            if (!str) return '';
                            return str.toString()
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/"/g, '&quot;')
                                .replace(/'/g, '&apos;');
                        };

                        let tweetHtml = `<div class="tweet" style="border-bottom: 1px solid #ccc; padding: 10px 0;">`;
                        if (isArticle && title) {
                            tweetHtml += `<h2>${escapeXml(title)}</h2>`;
                        }
                        if (text) tweetHtml += `<div>${text}</div>`; // Articles often have complex HTML structure, so use div

                        // Images disabled for X4 compatibility
                        /*
                        photoUrls.forEach(url => {
                            tweetHtml += `<img src="${escapeXml(url)}" style="max-width: 100%; margin: 10px 0; border-radius: 8px;" />`;
                        });
                        */
                        tweetHtml += `</div>`;

                        threadContent.push(tweetHtml);
                    }
                });
                console.log('[X4] Thread content items:', threadContent.length);

                if (threadContent.length > 0) {
                    const finalTitle = `${authorHandle} on X: "${title.replace(/"/g, "'")}"`;
                    // Date from first time element
                    const dateEl = document.querySelector('time');
                    const date = dateEl ? dateEl.getAttribute('datetime').split('T')[0] : new Date().toISOString().split('T')[0];

                    // Use first image found as cover
                    // We can look at the first tweet's photos
                    let coverUrl = null;
                    /*
                    // Cover disabled for X4 compatibility
                    const firstTweetPhotos = tweets[0].querySelectorAll('[data-testid="tweetPhoto"] img');
                    if (firstTweetPhotos.length > 0) {
                        coverUrl = firstTweetPhotos[0].src;
                    }
                    */

                    return {
                        success: true,
                        article: {
                            title: finalTitle,
                            author: `X (${authorHandle})`,
                            date,
                            coverUrl,
                            wordCount: threadContent.length * 30,
                            body: threadContent.join('\n'),
                            rawText: '',
                            sourceUrl: window.location.href
                        }
                    };
                }
            }
        }

        // --- STANDARD READABILITY ---
        // Check if Readability is available
        const hasReadability = typeof Readability !== 'undefined';
        console.log('[X4] Readability available:', hasReadability);

        let title = document.title;
        let author = '';
        let date = new Date().toISOString().split('T')[0];
        let body = '';
        let textContent = '';
        let wordCount = 0;

        if (hasReadability) {
            // Use Readability
            const docClone = document.cloneNode(true);
            extractionHelpers.sanitizeHeadingClasses(docClone);
            const reader = new Readability(docClone);
            const article = reader.parse();

            if (article && article.textContent && article.textContent.length >= 400) {
                title = article.title || document.title;
                author = article.byline || article.siteName || '';
                body = article.content;
                textContent = article.textContent;
                wordCount = textContent.split(/\s+/).length;

                const structuredRoot = getStructuredContentRoot();
                if (structuredRoot) {
                    const sourceHtml = structuredRoot.innerHTML || '';
                    if (extractionHelpers.shouldUseHeadingFallback(sourceHtml, body)) {
                        console.log('[X4] Readability dropped headings; using structured source body fallback');
                        body = sourceHtml;
                        textContent = structuredRoot.innerText || structuredRoot.textContent || textContent;
                        wordCount = textContent.split(/\s+/).filter(Boolean).length;
                    }
                }

                // Try to get date
                const dateEl = document.querySelector('meta[property="article:published_time"]') ||
                    document.querySelector('time[datetime]');
                if (article.publishedTime) {
                    date = article.publishedTime.split('T')[0];
                } else if (dateEl) {
                    const dt = dateEl.getAttribute('content') || dateEl.getAttribute('datetime');
                    if (dt) date = dt.split('T')[0];
                }

                // Get author from meta if not in article
                if (!author) {
                    author = document.querySelector('meta[name="author"]')?.content ||
                        document.querySelector('meta[property="article:author"]')?.content ||
                        new URL(window.location.href).hostname.replace('www.', '');
                }

                console.log('[X4] Readability extracted:', title, wordCount, 'words');

                return {
                    success: true,
                    article: {
                        title,
                        author,
                        date,
                        wordCount,
                        body,
                        rawText: textContent,
                        sourceUrl: window.location.href
                    }
                };
            }
        }

        // Fallback: basic extraction
        console.log('[X4] Using fallback extraction');

        // Get main content area
        const mainContent = document.querySelector('article') ||
            document.querySelector('[role="main"]') ||
            document.querySelector('main') ||
            document.body;

        textContent = mainContent.innerText || mainContent.textContent || '';
        wordCount = textContent.split(/\s+/).length;

        if (textContent.length < 400) {
            console.log('[X4] Content too short:', textContent.length);
            return { success: false, reason: 'content_too_short', length: textContent.length };
        }

        // Get metadata
        author = document.querySelector('meta[name="author"]')?.content ||
            document.querySelector('meta[property="article:author"]')?.content ||
            new URL(window.location.href).hostname.replace('www.', '');

        const dateEl = document.querySelector('meta[property="article:published_time"]') ||
            document.querySelector('time[datetime]');
        if (dateEl) {
            const dt = dateEl.getAttribute('content') || dateEl.getAttribute('datetime');
            if (dt) date = dt.split('T')[0];
        }

        // Create simple HTML body
        const paragraphs = textContent.split(/\n\n+/).filter(p => p.trim().length > 0);
        body = paragraphs.map(p => `<p>${p.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`).join('\n');

        return {
            success: true,
            article: {
                title,
                author,
                date,
                wordCount,
                body,
                rawText: textContent,
                sourceUrl: window.location.href
            }
        };

    } catch (error) {
        console.error('[X4] Extraction error:', error);
        return { success: false, reason: error.message };
    }
}
