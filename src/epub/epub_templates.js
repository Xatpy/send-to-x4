/**
 * EPUB Templates
 * Standard templates for EPUB structure
 */
const EpubTemplates = {
  /**
   * Generate mimetype file content
   */
  mimetype: 'application/epub+zip',

  /**
   * Generate container.xml
   */
  containerXml: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,

  /**
   * Generate content.opf
   * @param {Object} metadata - { title, author, date, uuid, coverMediaType }
   */
  contentOpf(metadata) {
    const { title, author, date, uuid, coverMediaType } = metadata;
    const creatorLine = author
      ? `    <dc:creator>${this.escapeXml(author)}</dc:creator>`
      : '';
    const dateLine = date
      ? `    <dc:date>${this.escapeXml(date)}</dc:date>`
      : '';

    // Cover metadata
    const coverMeta = coverMediaType
      ? `    <meta name="cover" content="cover-image" />`
      : '';

    const coverItem = coverMediaType
      ? `    <item id="cover-image" href="images/cover.jpg" media-type="${coverMediaType}" properties="cover-image"/>`
      : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>${this.escapeXml(title)}</dc:title>
${creatorLine}
${dateLine}
${coverMeta}
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>
${coverItem}
  </manifest>
  <spine toc="ncx">
    <itemref idref="content"/>
  </spine>
</package>`;
  },

  /**
   * Generate toc.ncx
   * @param {Object} metadata - { title, uuid }
   */
  tocNcx(metadata) {
    const { title, uuid, headings = [] } = metadata;
    const sectionNavPoints = headings.map((heading, index) => `
    <navPoint id="navpoint-${index + 2}" playOrder="${index + 2}">
      <navLabel>
        <text>${this.escapeXml(heading.title)}</text>
      </navLabel>
      <content src="content.xhtml#${this.escapeXml(heading.id)}"/>
    </navPoint>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:${uuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text>${this.escapeXml(title)}</text>
  </docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel>
        <text>${this.escapeXml(title)}</text>
      </navLabel>
      <content src="content.xhtml"/>
    </navPoint>${sectionNavPoints}
  </navMap>
</ncx>`;
  },

  /**
   * Give article headings stable anchors and return their EPUB navigation data.
   * Readability preserves heading elements from sites such as Substack, but
   * source pages do not consistently give them IDs that can be used in EPUB.
   */
  prepareHeadings(html) {
    const headings = [];
    let index = 0;
    const body = String(html || '').replace(
      /<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1\s*>/gi,
      (match, level, attributes, innerHtml) => {
        const title = this.htmlToText(innerHtml);
        if (!title) return match;

        index += 1;
        const id = `section-${index}`;
        headings.push({ id, title, level: Number(level) });

        // Source IDs may be missing, duplicated, or unsuitable for XHTML.
        // Replace any existing id so the NCX target is always predictable.
        const attrsWithoutId = attributes.replace(/\s+id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        return `<h${level}${attrsWithoutId} id="${id}">${innerHtml}</h${level}>`;
      }
    );
    return { body, headings };
  },

  /** Convert a heading's inline HTML into a safe plain-text NCX label. */
  htmlToText(html) {
    const namedEntities = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '
    };
    return String(html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, value) => {
        const normalized = value.toLowerCase();
        if (normalized.startsWith('#x')) return String.fromCodePoint(parseInt(normalized.slice(2), 16));
        if (normalized.startsWith('#')) return String.fromCodePoint(parseInt(normalized.slice(1), 10));
        return namedEntities[normalized];
      })
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * Generate content.xhtml for longpost
   * @param {Object} data - { title, author, date, body, url }
   */
  contentXhtml(data) {
    const { title, author, date, body, url } = data;

    // Build metadata line: @handle • date • Source: url
    const metaParts = [];
    if (author) metaParts.push(this.escapeXml(author));
    if (date) metaParts.push(this.escapeXml(date));
    if (url) metaParts.push(`<a href="${this.escapeXml(url)}">Source</a>`);
    const metaLine = metaParts.length > 0
      ? `<p class="meta">${metaParts.join(' • ')}</p>`
      : '';

    // Convert HTML body to XHTML (properly close self-closing tags)
    const xhtmlBody = this.htmlToXhtml(body);

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head>
  <meta http-equiv="Content-Type" content="application/xhtml+xml; charset=utf-8"/>
  <title>${this.escapeXml(title)}</title>
  <style type="text/css">
    body {
      margin: 1.5em;
      line-height: 1.7;
      font-family: Georgia, "Times New Roman", serif;
    }
    h1 {
      font-size: 1.5em;
      margin-bottom: 0.3em;
      line-height: 1.3;
    }
    h2, h3, h4, h5, h6 {
      margin-top: 1.8em;
      margin-bottom: 0.6em;
      line-height: 1.3;
      font-weight: bold;
    }
    h2 { font-size: 1.35em; }
    h3 { font-size: 1.2em; }
    h4, h5, h6 { font-size: 1.05em; }
    .meta {
      color: #666;
      font-size: 0.85em;
      margin-bottom: 1.5em;
      padding-bottom: 1em;
      border-bottom: 1px solid #ddd;
    }
    .meta a {
      color: #666;
    }
    p {
      margin: 0.9em 0;
      text-align: left;
    }
    blockquote {
      margin: 1em 1.5em;
      padding-left: 1em;
      border-left: 3px solid #ccc;
      font-style: italic;
    }
  </style>
</head>
<body>
  <h1>${this.escapeXml(title)}</h1>
  ${metaLine}
  <div class="content">
    ${xhtmlBody}
  </div>
</body>
</html>`;
  },

  /**
   * Escape XML special characters
   * @param {string} text
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
  },

  /**
   * Convert HTML to XHTML by properly closing self-closing tags
   * @param {string} html
   */
  htmlToXhtml(html) {
    if (!html) return '';

    // List of void/self-closing elements in HTML that must be self-closed in XHTML
    const voidElements = [
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
      'link', 'meta', 'param', 'source', 'track', 'wbr'
    ];

    // Pattern to match void elements that are not already self-closed
    // Matches: <tag ...> but not <tag ... /> or <tag .../>
    const pattern = new RegExp(
      `<(${voidElements.join('|')})([^>]*?)(?<!/)>`,
      'gi'
    );

    // Replace with self-closing version
    // Also ensures we don't double-close if the regex is too greedy, but (?<!/) handles the check.
    return html.replace(pattern, '<$1$2 />');
  }
};
