/**
 * X4 Send - Service Worker (Background Script)
 * Handles EPUB generation, X4 upload, and download fallback
 */

// Cross-browser compatibility
// Cross-browser compatibility
// browserAPI is defined in settings.js, which is loaded before this script in manifest.json
// const browserAPI = typeof browser !== 'undefined' ? browser : chrome;

// Import required modules (paths relative to service worker location in src/background/)
// Import required modules
// Note: In Firefox 'scripts' (Background Page), these are loaded via manifest.json.
// In Chrome 'service_worker', importScripts works and is required.
if (typeof importScripts === 'function') {
    try {
        importScripts(
            '../epub/jszip.min.js',
            '../utils/logger.js',
            '../utils/sanitize.js',
            '../epub/epub_templates.js',
            '../epub/epub_builder.js',
            '../upload/x4_upload_tab.js',
            '../upload/crosspoint_upload.js',
            '../utils/settings.js'
        );
    } catch (e) {
        console.error('[X4 SW] importScripts failed:', e);
    }
}

console.log('[X4 Service Worker] Initialized');

// Message handler
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'X4_SEND_ARTICLE') {
        handleSendArticle(message, sender, sendResponse);
        return true; // Keep channel open for async response
    }

    if (message.type === 'X4_DOWNLOAD_ARTICLE') {
        handleDownloadArticle(message.payload, sendResponse);
        return true;
    }

    if (message.type === 'X4_DOWNLOAD_EPUB') {
        handleDownloadEpub(message.payload)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({
                success: false,
                error: error.message
            }));
        return true;
    }

    if (message.type === 'X4_FETCH') {
        handleFetch(message.payload)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({
                success: false,
                error: error.message
            }));
        return true;
    }
});

/**
 * External API bridge for trusted websites (e.g. Antoine's Archive).
 * Minimal surface:
 * - x4.ping
 * - x4.status ({ firmwareType, host })
 * - x4.upload ({ firmwareType, host, filename, dataBase64 })
 */
browserAPI.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'X4_EXTERNAL_API') return;

    (async () => {
        try {
            let data;
            switch (message.action) {
                case 'x4.ping':
                    data = { ok: true };
                    break;
                case 'x4.status':
                    data = await handleExternalStatus(message.payload || {});
                    break;
                case 'x4.upload':
                    data = await handleExternalUpload(message.payload || {});
                    break;
                default:
                    throw new Error(`Unsupported action: ${String(message.action)}`);
            }
            sendResponse({ ok: true, data });
        } catch (error) {
            sendResponse({ ok: false, error: error instanceof Error ? error.message : 'External API error' });
        }
    })();

    return true;
});

function decodeBase64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

async function handleExternalStatus(payload) {
    const firmwareType = payload?.firmwareType === 'stock' ? 'stock' : 'crosspoint';
    const host = (payload?.host || (firmwareType === 'crosspoint' ? '192.168.4.1' : '192.168.3.3')).trim();
    const base = host.includes('://') ? host.replace(/\/+$/, '') : `http://${host.replace(/\/+$/, '')}`;

    if (firmwareType === 'crosspoint') {
        const response = await fetch(`${base}/api/status`, { method: 'GET' });
        if (!response.ok) return { connected: false, error: `Status ${response.status}` };
        const data = await response.json().catch(() => ({}));
        return {
            connected: true,
            version: data?.version,
            ip: data?.ip,
            mode: data?.mode,
        };
    }

    const response = await fetch(`${base}/list?dir=/`, { method: 'GET' });
    if (!response.ok) return { connected: false, error: `Status ${response.status}` };
    return { connected: true };
}

async function handleExternalUpload(payload) {
    const firmwareType = payload?.firmwareType === 'stock' ? 'stock' : 'crosspoint';
    const host = (payload?.host || (firmwareType === 'crosspoint' ? '192.168.4.1' : '192.168.3.3')).trim();
    const filename = (payload?.filename || 'book.epub').trim() || 'book.epub';
    const dataBase64 = payload?.dataBase64;
    if (!dataBase64 || typeof dataBase64 !== 'string') {
        return { success: false, error: 'Missing dataBase64' };
    }

    const arrayBuffer = decodeBase64ToArrayBuffer(dataBase64);

    if (firmwareType === 'crosspoint') {
        CrossPointUpload.setIp(host.replace(/^https?:\/\//i, ''));
        return await CrossPointUpload.uploadEpub(arrayBuffer, filename);
    }

    X4UploadTab.setIp(host.replace(/^https?:\/\//i, ''));
    return await X4UploadTab.uploadEpub(arrayBuffer, filename);
}

/**
 * Handle fetch proxy (to bypass CORS/Mixed Content in popup)
 */
async function handleFetch(payload) {
    const { url, options } = payload;
    console.log('[X4 SW] Proxy fetch:', url, options?.method || 'GET');

    // Firefox Fallback: Use XMLHttpRequest to bypass potential Mixed Content/Fetch quirks
    if (typeof XMLHttpRequest !== 'undefined') {
        console.log('[X4 SW] Using XMLHttpRequest (Firefox compat mode)');
        return new Promise((resolve) => {
            const xhr = new XMLHttpRequest();
            xhr.open(options?.method || 'GET', url, true);

            // Set headers
            if (options?.headers) {
                for (const [key, value] of Object.entries(options.headers)) {
                    xhr.setRequestHeader(key, value);
                }
            }

            xhr.onload = function () {
                const success = xhr.status >= 200 && xhr.status < 300;
                // Parse body logic simplified
                let data = xhr.responseText;
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    // Start is not JSON, keep as text
                }

                resolve({
                    success: success,
                    status: xhr.status,
                    statusText: xhr.statusText,
                    data: data
                });
            };

            xhr.onerror = function () {
                console.error('[X4 SW] XHR Error');
                resolve({
                    success: false,
                    error: 'Network Request Failed (XHR)'
                });
            };

            xhr.ontimeout = function () {
                resolve({
                    success: false,
                    error: 'Timeout'
                });
            };

            if (options?.body) {
                xhr.send(options.body);
            } else {
                xhr.send();
            }
        });
    }

    // Chrome / Service Worker: Use fetch
    try {
        const response = await fetch(url, options);

        // We need to read the body to send it back
        const contentType = response.headers.get('content-type');
        let data;

        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }

        return {
            success: response.ok,
            status: response.status,
            statusText: response.statusText,
            data: data
        };
    } catch (error) {
        console.error('[X4 SW] Fetch error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Handle download article request (generate EPUB and download locally)
 */
async function handleDownloadArticle(article, sendResponse) {
    console.log('[X4 SW] Handling download article:', article.title);

    try {
        // Generate EPUB - returns a Blob
        const epubBlob = await EpubBuilder.build(article);

        if (!epubBlob || !(epubBlob instanceof Blob)) {
            throw new Error('EPUB generation failed');
        }

        const filename = EpubBuilder.generateFilename(article);
        const arrayBuffer = await EpubBuilder.blobToArrayBuffer(epubBlob);

        console.log('[X4 SW] EPUB generated for download:', filename, 'size:', arrayBuffer.byteLength);

        // Download the EPUB
        await downloadEpubFallback(arrayBuffer, filename);

        sendResponse({ success: true, message: 'Downloaded!' });

    } catch (error) {
        console.error('[X4 SW] Download error:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Send status update to popup
 */
async function sendStatusUpdate(sender, status, message) {
    try {
        // Send to runtime (reaches popup)
        await browserAPI.runtime.sendMessage({
            type: 'X4_STATUS_UPDATE',
            status: status,
            message: message
        });
    } catch (e) {
        // Ignore errors (popup might be closed)
        // console.log('[X4 SW] internal message error:', e.message);
    }
}

async function logToPopup(message) {
    try {
        await chrome.runtime.sendMessage({
            type: 'X4_DEBUG_LOG',
            message: message
        });
    } catch (e) { /* ignore */ }
}

/**
 * Handle send article request
 * Strategy: Try upload first, download as fallback
 */
async function handleSendArticle(messageData, sender, sendResponse) {
    const article = messageData.payload;
    const settings = messageData.settings || {};
    const tabId = sender.tab?.id;
    console.log('[X4 SW] Handling send article:', article.title);
    console.log('[X4 SW] Settings:', settings);

    try {
        await logToPopup(`Starting Send Article: ${article.title}`);

        // Step 1: Generate EPUB
        if (tabId) await sendStatusUpdate(sender, 'generating', 'Creating EPUB...');
        await logToPopup('Generating EPUB...');

        const epubBlob = await EpubBuilder.build(article);
        const filename = EpubBuilder.generateFilename(article);
        const arrayBuffer = await EpubBuilder.blobToArrayBuffer(epubBlob);

        await logToPopup(`EPUB generated: ${filename} (${arrayBuffer.byteLength} bytes)`);

        // Step 2: Choose uploader based on settings
        const isCrosspoint = settings.firmwareType === 'crosspoint';
        const deviceIp = settings.deviceIp || (isCrosspoint ? '192.168.4.1' : '192.168.3.3');

        const uploader = isCrosspoint ? CrossPointUpload : X4UploadTab;
        const apiName = isCrosspoint ? 'CrossPoint' : 'standard X4';

        await logToPopup(`Configuring ${apiName} with IP: ${deviceIp}`);

        if (isCrosspoint) {
            CrossPointUpload.setIp(deviceIp);
        } else {
            if (typeof X4UploadTab.setIp === 'function') {
                X4UploadTab.setIp(deviceIp);
            }
        }

        // Step 3: Upload
        if (tabId) await sendStatusUpdate(sender, 'uploading', 'Sending to X4...');
        await logToPopup(`Attempting upload to ${deviceIp}...`);

        const uploadResult = await uploader.uploadEpub(arrayBuffer, filename);
        await logToPopup(`Upload result: ${JSON.stringify(uploadResult)}`);

        if (uploadResult.success) {
            await logToPopup('Upload successful!');
            sendResponse({
                success: true,
                message: 'Sent to X4!'
            });
            return;
        }

        // Step 3: Fallback
        await logToPopup(`Upload failed (${uploadResult.error}), falling back to download.`);
        if (tabId) await sendStatusUpdate(sender, 'downloading', 'Downloading (X4 upload failed)...');

        await downloadEpubFallback(arrayBuffer, filename);

        sendResponse({
            success: true,
            message: '📥 EPUB downloaded',
            downloadTriggered: true,
            uploadError: uploadResult.error
        });

    } catch (error) {
        await logToPopup(`Error: ${error.message}`);
        console.error('[X4 SW] Error:', error);
        sendResponse({
            success: false,
            error: error.message
        });
    }
}

/**
 * Download EPUB as fallback
 * Chrome MV3 service workers: Use data URL (can't use createObjectURL)
 * Firefox MV3 service workers: Use Blob URL (data URLs blocked for security)
 */
async function downloadEpubFallback(arrayBuffer, filename) {
    try {
        console.log('[X4 SW] Triggering download fallback...');

        // Detect if we're in Firefox (has 'browser' namespace) or Chrome
        const isFirefox = typeof browser !== 'undefined' && typeof browser.runtime !== 'undefined';
        console.log('[X4 SW] Browser detected:', isFirefox ? 'Firefox' : 'Chrome');

        let downloadUrl;

        if (isFirefox) {
            // Firefox: Use Blob URL (works in MV3 service workers)
            console.log('[X4 SW] Using Blob URL for Firefox...');
            const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
            downloadUrl = URL.createObjectURL(blob);
            console.log('[X4 SW] Blob URL created:', downloadUrl);
        } else {
            // Chrome: Use data URL (works in service workers)
            console.log('[X4 SW] Converting to data URL for Chrome...');
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            downloadUrl = `data:application/epub+zip;base64,${base64}`;
            console.log('[X4 SW] Data URL length:', downloadUrl.length);
        }

        // Trigger download
        console.log('[X4 SW] Calling browserAPI.downloads.download...');
        const downloadId = await browserAPI.downloads.download({
            url: downloadUrl,
            filename: filename,
            saveAs: false
        });

        console.log('[X4 SW] Download triggered successfully, ID:', downloadId);

        // Clean up Blob URL after download starts (Firefox only)
        if (isFirefox) {
            // Give the download a moment to start before revoking
            setTimeout(() => {
                URL.revokeObjectURL(downloadUrl);
                console.log('[X4 SW] Blob URL revoked');
            }, 1000);
        }
    } catch (error) {
        console.error('[X4 SW] Download failed:', error);
        throw error;
    }
}

/**
 * Handle direct download request (for popup action)
 */
async function handleDownloadEpub(payload) {
    const { article } = payload;

    const epubBlob = await EpubBuilder.build(article);
    const filename = EpubBuilder.generateFilename(article);
    const arrayBuffer = await EpubBuilder.blobToArrayBuffer(epubBlob);

    await downloadEpubFallback(arrayBuffer, filename);

    return { success: true, filename };
}

console.log('[X4 Service Worker] Ready');
