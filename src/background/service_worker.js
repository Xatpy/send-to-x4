/**
 * X4 Send - Service Worker (Background Script)
 * Handles EPUB generation, X4 upload, and download fallback
 */

// `background.scripts` is a Manifest V2 field. Load the worker's dependencies
// explicitly so the same Manifest V3 package works in Chrome and Firefox.
if (typeof importScripts === 'function') {
    try {
        importScripts(
            '../epub/jszip.min.js',
            '../utils/logger.js',
            '../utils/sanitize.js',
            '../utils/transfer_utils.js',
            '../utils/folder_path.js',
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

    if (message.type === 'X4_UPLOAD_QUEUE_ITEM') {
        handleUploadQueueItem(message, sendResponse);
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
        // Re-sanitize here — do not trust the popup-supplied folder value
        const rawFolder = settings.targetFolder
            || (typeof Settings !== 'undefined' ? await Settings.getTargetFolder() : 'send-to-x4');
        const targetFolder = (typeof globalThis.FolderPath !== 'undefined')
            ? globalThis.FolderPath.sanitize(rawFolder)
            : (typeof Settings !== 'undefined'
                ? Settings.sanitizeFolderName(rawFolder)
                : rawFolder);

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
        await logToPopup(`Attempting upload to ${deviceIp}/${targetFolder}/...`);

        const uploadResult = await uploader.uploadEpub(arrayBuffer, filename, targetFolder);
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

/** Queue uploads intentionally do not download a fallback file on failure. */
async function handleUploadQueueItem(messageData, sendResponse) {
    try {
        const { itemId, targetDirectory, filename } = messageData.payload;
        const item = await readQueuedItem(itemId);
        if (!item) throw new Error('This queue item is no longer available locally.');
        const settings = messageData.settings || {};
        const isCrosspoint = settings.firmwareType === 'crosspoint';
        const uploader = isCrosspoint ? CrossPointUpload : X4UploadTab;
        const deviceIp = settings.deviceIp || (isCrosspoint ? '192.168.4.1' : '192.168.3.3');
        uploader.setIp(deviceIp);
        let data;
        let name = filename || item.filename;
        let mimeType = item.mimeType;
        if (item.kind === 'article') {
            const epub = await EpubBuilder.build(item.article);
            data = await EpubBuilder.blobToArrayBuffer(epub);
            name = filename || EpubBuilder.generateFilename(item.article);
            mimeType = 'application/epub+zip';
        } else {
            data = await item.blob.arrayBuffer();
        }
        const result = await uploader.uploadFile({ data, filename: name, mimeType, targetDirectory });
        sendResponse(result);
    } catch (error) {
        sendResponse({ success: false, error: error.message || 'Transfer failed.' });
    }
}

/**
 * Runtime messages are JSON-serialized in Chrome, so a queued Blob cannot be
 * passed from the popup to this worker. Read it from the shared extension
 * IndexedDB database instead.
 */
function readQueuedItem(id) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('send-to-x4-transfer-queue', 1);
        request.onerror = () => reject(request.error || new Error('Could not read the local transfer queue.'));
        request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction('items', 'readonly');
            const getRequest = transaction.objectStore('items').get(id);
            getRequest.onsuccess = () => { db.close(); resolve(getRequest.result || null); };
            getRequest.onerror = () => { db.close(); reject(getRequest.error || new Error('Could not read the queued item.')); };
        };
    });
}

/**
 * Download an EPUB without routing it through a page.
 *
 * Chrome MV3 service workers cannot reliably create object URLs, while Firefox
 * rejects `data:` URLs passed to downloads.download. Use the format supported
 * by each browser instead.
 */
async function downloadEpubFallback(arrayBuffer, filename) {
    try {
        console.log('[X4 SW] Triggering download fallback...');
        const isFirefox = typeof browser !== 'undefined' &&
            typeof browser.runtime?.getBrowserInfo === 'function';

        let downloadUrl;
        if (isFirefox) {
            const epubBlob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
            downloadUrl = URL.createObjectURL(epubBlob);
            console.log('[X4 SW] Using Blob URL for Firefox download.');
        } else {
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64 = btoa(binary);
            downloadUrl = `data:application/epub+zip;base64,${base64}`;
            console.log('[X4 SW] Using data URL for Chromium download.');
        }

        // Trigger download
        console.log('[X4 SW] Calling browserAPI.downloads.download...');
        const downloadId = await browserAPI.downloads.download({
            url: downloadUrl,
            filename: filename,
            saveAs: false
        });

        console.log('[X4 SW] Download triggered successfully, ID:', downloadId);

        if (isFirefox) {
            // The downloads API has consumed the object URL once its promise
            // resolves. Revoke it on the next task to avoid retaining EPUB data.
            setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
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
