const test = require('node:test');
const assert = require('node:assert/strict');

const {
  countHeadingTags,
  sanitizeHeadingClasses,
  shouldUseHeadingFallback
} = require('../src/content/extraction_helpers.js');

test('countHeadingTags counts h2/h3 by default', () => {
  const html = '<h2>One</h2><p>x</p><h3>Two</h3><h4>Three</h4>';
  assert.equal(countHeadingTags(html), 2);
});

test('sanitizeHeadingClasses removes header/anchor-like class tokens on headings', () => {
  const headingA = { className: 'header-anchor-post keep-me' };
  const headingB = { className: 'section-title anchor-link' };
  const headingC = { className: '' };
  const root = {
    querySelectorAll() {
      return [headingA, headingB, headingC];
    }
  };

  const removed = sanitizeHeadingClasses(root);

  assert.equal(removed, 2);
  assert.equal(headingA.className, 'keep-me');
  assert.equal(headingB.className, 'section-title');
  assert.equal(headingC.className, '');
});

test('shouldUseHeadingFallback is true only when source has headings and parsed has none', () => {
  assert.equal(
    shouldUseHeadingFallback('<p>x</p><h2>Section</h2>', '<p>x</p>'),
    true
  );
  assert.equal(
    shouldUseHeadingFallback('<p>x</p><h2>Section</h2>', '<p>x</p><h2>Section</h2>'),
    false
  );
  assert.equal(
    shouldUseHeadingFallback('<p>x</p>', '<p>x</p>'),
    false
  );
});
