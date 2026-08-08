(function (root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.X4ExtractionHelpers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const HEADING_CLASS_TOKEN_RE = /(^|[-_])(header|anchor)([-_]|$)/i;

  function countHeadingTags(html, minLevel = 2, maxLevel = 3) {
    if (!html || minLevel > maxLevel) return 0;

    let total = 0;
    for (let level = minLevel; level <= maxLevel; level++) {
      const re = new RegExp(`<h${level}\\b`, 'gi');
      total += (html.match(re) || []).length;
    }
    return total;
  }

  function sanitizeHeadingClasses(rootNode) {
    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') {
      return 0;
    }

    let removedCount = 0;
    const headings = rootNode.querySelectorAll('h1,h2,h3,h4,h5,h6');

    headings.forEach((heading) => {
      if (!heading || typeof heading.className !== 'string' || !heading.className) {
        return;
      }

      const classes = heading.className.split(/\s+/).filter(Boolean);
      if (classes.length === 0) return;

      const kept = classes.filter((token) => !HEADING_CLASS_TOKEN_RE.test(token));
      removedCount += classes.length - kept.length;

      if (kept.length !== classes.length) {
        heading.className = kept.join(' ');
      }
    });

    return removedCount;
  }

  function shouldUseHeadingFallback(sourceHtml, parsedHtml) {
    return countHeadingTags(sourceHtml) > 0 && countHeadingTags(parsedHtml) === 0;
  }

  return {
    countHeadingTags,
    sanitizeHeadingClasses,
    shouldUseHeadingFallback
  };
});
