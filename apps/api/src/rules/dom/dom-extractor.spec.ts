import { extractDomEvidence } from './dom-extractor';
import { ElementComputedStyle } from '../../capture/capture.types';

describe('dom-extractor', () => {
  it('safely extracts document title', () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Test Page Title &amp; More</title>
        </head>
        <body>
          <h1>Hello World</h1>
        </body>
      </html>
    `;
    const doc = extractDomEvidence(html);
    expect(doc.hasTitleTag).toBe(true);
    expect(doc.title).toBe('Test Page Title & More');
    expect(doc.isMalformed).toBe(false);
  });

  it('strips script, style, and comments before extraction', () => {
    const html = `
      <html>
        <head>
          <!-- Comment with <img src="bad.jpg"> -->
          <style>button { color: red; }</style>
          <script>const html = "<button>Click</button>";</script>
          <title>Safe Title</title>
        </head>
        <body>
          <img src="real.png" alt="Real Image" id="logo" class="brand primary">
          <button id="submit-btn" class="btn primary">Submit Form</button>
          <h1>Main Topic</h1>
        </body>
      </html>
    `;
    const doc = extractDomEvidence(html);
    expect(doc.title).toBe('Safe Title');
    expect(doc.images).toHaveLength(1);
    expect(doc.images[0].src).toBe('real.png');
    expect(doc.images[0].alt).toBe('Real Image');
    expect(doc.images[0].selector).toBe('img#logo');

    expect(doc.buttons).toHaveLength(1);
    expect(doc.buttons[0].textContent).toBe('Submit Form');
    expect(doc.buttons[0].selector).toBe('button#submit-btn');

    expect(doc.headings).toHaveLength(1);
    expect(doc.headings[0].level).toBe(1);
    expect(doc.headings[0].textContent).toBe('Main Topic');
  });

  it('correlates extracted elements with matching ElementComputedStyle', () => {
    const computedStyles: ElementComputedStyle[] = [
      {
        selector: 'img#hero',
        tagName: 'img',
        boundingBox: { x: 10, y: 20, width: 200, height: 100 },
        styles: {
          color: 'rgb(0, 0, 0)',
          backgroundColor: 'rgb(255, 255, 255)',
          fontSize: '16px',
          fontWeight: '400',
          lineHeight: '24px',
          display: 'block',
          visibility: 'visible',
          margin: '0px',
          padding: '0px',
        },
      },
    ];

    const html = `<html><body><img src="hero.jpg" id="hero" alt="Hero banner"></body></html>`;
    const doc = extractDomEvidence(html, computedStyles);

    expect(doc.images).toHaveLength(1);
    expect(doc.images[0].matchingComputedStyle).toBeDefined();
    expect(doc.images[0].matchingComputedStyle?.boundingBox).toEqual({
      x: 10,
      y: 20,
      width: 200,
      height: 100,
    });
  });

  it('marks empty or non-string html as malformed', () => {
    const doc1 = extractDomEvidence('');
    expect(doc1.isMalformed).toBe(true);
    expect(doc1.parsingErrors).toHaveLength(1);

    const doc2 = extractDomEvidence(null as unknown as string);
    expect(doc2.isMalformed).toBe(true);
  });
});
