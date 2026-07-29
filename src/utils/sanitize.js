/**
 * HTML Sanitization for EPUB content
 * This file is used by both content scripts and service worker.
 * Functions that need DOM (cleanForEpub) check for document first.
 */
const Sanitizer = {
    /**
     * Clean HTML for EPUB inclusion (requires DOM - content scripts only)
     * @param {string} html - Raw HTML string
     * @returns {string} - Clean XHTML string
     */
    cleanForEpub(html) {
        // Check if we have DOM access
        if (typeof document === 'undefined') {
            console.warn('[X4-Send] cleanForEpub called without DOM access, returning basic cleanup');
            return this.basicCleanup(html);
        }

        // Parse untrusted markup in a detached document before filtering it.
        // This avoids executing it in the popup/content-script document.
        const temp = new DOMParser().parseFromString(html, 'text/html').body;

        // Remove dangerous elements
        const dangerousTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math'];
        dangerousTags.forEach(tag => {
            temp.querySelectorAll(tag).forEach(el => el.remove());
        });

        // Remove embedded tweets (Twitter's card components)
        temp.querySelectorAll('[data-testid="tweetEmbed"], [data-testid="card.wrapper"]').forEach(el => el.remove());

        // Remove all event handler attributes and dangerous attributes
        const allElements = temp.querySelectorAll('*');
        allElements.forEach(el => {
            // Remove event handlers
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('on') || attr.name === 'style') {
                    el.removeAttribute(attr.name);
                }
            });

            // Convert links to text (remove href)
            if (el.tagName === 'A') {
                const text = el.textContent;
                el.replaceWith(temp.ownerDocument.createTextNode(text));
            }
        });

        // Convert to clean XHTML
        return this.toXhtml(temp.innerHTML);
    },

    /**
     * Basic cleanup without DOM (for service worker)
     * @param {string} html 
     * @returns {string}
     */
    basicCleanup(html) {
        return html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+on\w+="[^"]*"/gi, match => match.replace(/on\w+="[^"]*"/gi, ''));
    },

    /**
     * Convert HTML to XHTML (self-closing tags, etc.)
     * @param {string} html 
     * @returns {string}
     */
    toXhtml(html) {
        // Fix self-closing tags for XHTML
        const selfClosing = ['br', 'hr', 'img', 'meta', 'link', 'area', 'base', 'col', 'command', 'embed', 'input', 'keygen', 'param', 'source', 'track', 'wbr'];

        let xhtml = html;

        selfClosing.forEach(tag => {
            // Match tags that aren't self-closed and close them
            const regex = new RegExp(`<${tag}([^>]*?)(?<!/)>`, 'gi');
            xhtml = xhtml.replace(regex, `<${tag}$1 />`);
        });

        // Encode special characters that might break XML
        xhtml = xhtml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/g, '&amp;');

        return xhtml;
    },

    /**
     * Sanitize text for use in filenames
     * @param {string} text 
     * @param {number} maxLength 
     * @returns {string}
     */
    sanitizeFilename(text, maxLength = 80) {
        if (!text) return 'untitled';
        return text
            .replace(/[\/\\:*?"<>|]/g, '') // Remove illegal filename chars
            .replace(/\s+/g, ' ')           // Normalize whitespace
            .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
            .trim()
            .substring(0, maxLength) || 'untitled';
    },

    /**
     * Escape for XML/XHTML attributes and text
     * @param {string} text 
     * @returns {string}
     */
    escapeXml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&apos;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }
};
