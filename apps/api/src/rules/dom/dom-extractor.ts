import { ElementComputedStyle } from '../../capture/capture.types';
import { RULE_CONSTANTS } from '../rules.constants';

/**
 * Parsed Image element record.
 */
export interface ParsedImageElement {
  selector: string;
  src?: string;
  alt?: string;
  hasAltAttribute: boolean;
  role?: string;
  ariaHidden?: boolean;
  ariaLabel?: string;
  id?: string;
  classList: string[];
  rawSnippet: string;
  matchingComputedStyle?: ElementComputedStyle;
}

/**
 * Parsed Button element record.
 */
export interface ParsedButtonElement {
  selector: string;
  type?: string;
  textContent: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  title?: string;
  ariaHidden?: boolean;
  disabled?: boolean;
  id?: string;
  classList: string[];
  rawSnippet: string;
  matchingComputedStyle?: ElementComputedStyle;
}

/**
 * Parsed Heading element record.
 */
export interface ParsedHeadingElement {
  selector: string;
  level: number;
  textContent: string;
  id?: string;
  classList: string[];
  rawSnippet: string;
  matchingComputedStyle?: ElementComputedStyle;
}

/**
 * Structured, safe DOM representation extracted without code evaluation.
 */
export interface ParsedDomDocument {
  hasTitleTag: boolean;
  title: string | null;
  images: ParsedImageElement[];
  buttons: ParsedButtonElement[];
  headings: ParsedHeadingElement[];
  documentIds: Map<string, string>;
  isMalformed: boolean;
  parsingErrors: string[];
}

/**
 * Decodes standard HTML entities into plain text.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Parses raw HTML attribute string into a key-value record.
 */
export function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!rawAttrs) return attrs;

  // Regex matches: attr="val", attr='val', attr=val, or boolean attr
  const attrRegex = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = decodeHtmlEntities(val);
  }

  return attrs;
}

/**
 * Extracts plain text from an HTML snippet by stripping all nested tags.
 */
export function stripHtmlTags(html: string): string {
  if (!html) return '';
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Generates a stable CSS selector matching the convention in CaptureService.
 */
function buildSelector(
  tagName: string,
  id: string | undefined,
  classList: string[] | undefined,
  occurrenceIndex: number,
): string {
  let sel = tagName.toLowerCase();
  if (id) {
    sel += `#${id}`;
  } else if (classList && classList.length > 0) {
    sel += `.${classList.slice(0, 3).join('.')}`;
  } else {
    sel += `:nth-of-type(${occurrenceIndex})`;
  }
  return sel;
}

/**
 * Finds a matching ElementComputedStyle record from the capture output.
 */
function findMatchingStyle(
  tagName: string,
  id: string | undefined,
  classList: string[],
  textContent: string,
  computedStyles: ElementComputedStyle[],
): ElementComputedStyle | undefined {
  if (!computedStyles || computedStyles.length === 0) {
    return undefined;
  }

  // 1. Try exact ID match
  if (id) {
    const idSelector = `${tagName.toLowerCase()}#${id}`;
    const match = computedStyles.find(
      (cs) => cs.selector === idSelector || cs.selector.includes(`#${id}`),
    );
    if (match) return match;
  }

  // 2. Try class-based match
  if (classList.length > 0) {
    const classSelector = `${tagName.toLowerCase()}.${classList.slice(0, 3).join('.')}`;
    const match = computedStyles.find(
      (cs) => cs.selector === classSelector || classList.some((c) => cs.selector.includes(`.${c}`)),
    );
    if (match) return match;
  }

  // 3. Try matching by tagName and textSnippet
  if (textContent) {
    const normalizedText = textContent.slice(0, 50).trim();
    if (normalizedText.length > 0) {
      const match = computedStyles.find(
        (cs) =>
          cs.tagName.toLowerCase() === tagName.toLowerCase() &&
          cs.textSnippet &&
          cs.textSnippet.includes(normalizedText),
      );
      if (match) return match;
    }
  }

  // 4. Fallback to first matching tag if unique
  return computedStyles.find((cs) => cs.tagName.toLowerCase() === tagName.toLowerCase());
}

/**
 * Safely parses HTML into structured evidence without evaluating scripts or executing code.
 */
export function extractDomEvidence(
  html: string,
  computedStyles: ElementComputedStyle[] = [],
): ParsedDomDocument {
  const result: ParsedDomDocument = {
    hasTitleTag: false,
    title: null,
    images: [],
    buttons: [],
    headings: [],
    documentIds: new Map<string, string>(),
    isMalformed: false,
    parsingErrors: [],
  };

  if (!html || typeof html !== 'string' || html.trim().length === 0) {
    result.isMalformed = true;
    result.parsingErrors.push('HTML snapshot is empty or not a string');
    return result;
  }

  // 1. Strip script and style blocks and comments to avoid parsing non-DOM contents
  const cleanedHtml = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 2. Extract <title>...</title>
  const titleMatch = cleanedHtml.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    result.hasTitleTag = true;
    result.title = decodeHtmlEntities(titleMatch[1]).trim();
  } else {
    // Check if empty unclosed title tag exists
    const rawTitleTag = cleanedHtml.match(/<title\b[^>]*>/i);
    if (rawTitleTag) {
      result.hasTitleTag = true;
      result.title = '';
    }
  }

  // 3. Scan all elements with id="..." to build a document ID registry for accessible reference resolution
  const idRegex = /<([a-zA-Z0-9_:-]+)\b([^>]*\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*)>(?:([\s\S]*?)<\/\1>)?/gi;
  let idMatch: RegExpExecArray | null;
  let idCount = 0;

  while (
    (idMatch = idRegex.exec(cleanedHtml)) !== null &&
    idCount < RULE_CONSTANTS.MAX_DOM_SCAN_ELEMENTS
  ) {
    idCount++;
    const elementId = idMatch[3] ?? idMatch[4] ?? idMatch[5];
    if (elementId) {
      const innerText = idMatch[6] ? stripHtmlTags(idMatch[6]) : '';
      result.documentIds.set(elementId, innerText);
    }
  }

  // 4. Extract <img> elements (void / self-closing)
  const imgRegex = /<img\b([^>]*)>/gi;
  let imgMatch: RegExpExecArray | null;
  let imgCount = 0;

  while (
    (imgMatch = imgRegex.exec(cleanedHtml)) !== null &&
    imgCount < RULE_CONSTANTS.MAX_DOM_SCAN_ELEMENTS
  ) {
    imgCount++;
    const rawAttrs = imgMatch[1];
    const attrs = parseAttributes(rawAttrs);
    const id = attrs['id'];
    const classList = attrs['class'] ? attrs['class'].split(/\s+/).filter(Boolean) : [];
    const selector = buildSelector('img', id, classList, imgCount);

    const hasAlt = Object.prototype.hasOwnProperty.call(attrs, 'alt');
    const matchingStyle = findMatchingStyle('img', id, classList, '', computedStyles);

    result.images.push({
      selector,
      src: attrs['src'],
      alt: hasAlt ? attrs['alt'] : undefined,
      hasAltAttribute: hasAlt,
      role: attrs['role'],
      ariaHidden: attrs['aria-hidden'] === 'true',
      ariaLabel: attrs['aria-label'],
      id,
      classList,
      rawSnippet: imgMatch[0].slice(0, 150),
      matchingComputedStyle: matchingStyle,
    });
  }

  // 5. Extract <button>...</button>
  const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let btnMatch: RegExpExecArray | null;
  let btnCount = 0;

  while (
    (btnMatch = buttonRegex.exec(cleanedHtml)) !== null &&
    btnCount < RULE_CONSTANTS.MAX_DOM_SCAN_ELEMENTS
  ) {
    btnCount++;
    const rawAttrs = btnMatch[1];
    const innerHtml = btnMatch[2];
    const attrs = parseAttributes(rawAttrs);
    const id = attrs['id'];
    const classList = attrs['class'] ? attrs['class'].split(/\s+/).filter(Boolean) : [];
    const selector = buildSelector('button', id, classList, btnCount);
    const textContent = stripHtmlTags(innerHtml);
    const matchingStyle = findMatchingStyle('button', id, classList, textContent, computedStyles);

    result.buttons.push({
      selector,
      type: attrs['type'],
      textContent,
      ariaLabel: attrs['aria-label'],
      ariaLabelledBy: attrs['aria-labelledby'],
      title: attrs['title'],
      ariaHidden: attrs['aria-hidden'] === 'true',
      disabled: Object.prototype.hasOwnProperty.call(attrs, 'disabled'),
      id,
      classList,
      rawSnippet: btnMatch[0].slice(0, 150),
      matchingComputedStyle: matchingStyle,
    });
  }

  // 6. Extract Headings <h1..h6>...</h1..h6>
  const headingRegex = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let hMatch: RegExpExecArray | null;
  let hCount = 0;

  while (
    (hMatch = headingRegex.exec(cleanedHtml)) !== null &&
    hCount < RULE_CONSTANTS.MAX_DOM_SCAN_ELEMENTS
  ) {
    hCount++;
    const level = parseInt(hMatch[1], 10);
    const rawAttrs = hMatch[2];
    const innerHtml = hMatch[3];
    const attrs = parseAttributes(rawAttrs);
    const id = attrs['id'];
    const classList = attrs['class'] ? attrs['class'].split(/\s+/).filter(Boolean) : [];
    const selector = buildSelector(`h${level}`, id, classList, hCount);
    const textContent = stripHtmlTags(innerHtml);
    const matchingStyle = findMatchingStyle(`h${level}`, id, classList, textContent, computedStyles);

    result.headings.push({
      selector,
      level,
      textContent,
      id,
      classList,
      rawSnippet: hMatch[0].slice(0, 150),
      matchingComputedStyle: matchingStyle,
    });
  }

  return result;
}
