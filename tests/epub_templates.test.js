const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { self: {} };
vm.runInNewContext(`${fs.readFileSync('src/epub/epub_templates.js', 'utf8')}; self.__templates = EpubTemplates;`, context);
const templates = context.self.__templates;

test('preserves article subheadings as anchored EPUB sections', () => {
    const result = templates.prepareHeadings(
        '<p>Introduction</p><h4 class="header-anchor-post">Nurtured &amp; Ready</h4><p>Body</p><h3 id="source-id">Conclusion</h3>'
    );

    assert.deepEqual(JSON.parse(JSON.stringify(result.headings)), [
        { id: 'section-1', title: 'Nurtured & Ready', level: 4 },
        { id: 'section-2', title: 'Conclusion', level: 3 }
    ]);
    assert.match(result.body, /<h4 class="header-anchor-post" id="section-1">/);
    assert.match(result.body, /<h3 id="section-2">Conclusion<\/h3>/);
});

test('adds each article subheading to the EPUB table of contents', () => {
    const toc = templates.tocNcx({
        title: 'Article',
        uuid: 'test-id',
        headings: [{ id: 'section-1', title: 'Nurtured & Ready', level: 4 }]
    });

    assert.match(toc, /<content src="content.xhtml#section-1"\/>/);
    assert.match(toc, /<text>Nurtured &amp; Ready<\/text>/);
});
