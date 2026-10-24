/**
 * Stable Rule Identifiers
 */
export const RULE_IDS = {
  DOC_TITLE_PRESENT: 'doc-title-present',
  IMG_ALT_PRESENT: 'img-alt-present',
  BUTTON_NAME_PRESENT: 'button-name-present',
  HEADING_ORDER_VALID: 'heading-order-valid',
  TEXT_CONTRAST_MINIMUM: 'text-contrast-minimum',
} as const;

/**
 * Standard thresholds and constants for deterministic rule evaluation.
 */
export const RULE_CONSTANTS = {
  MAX_DOM_SCAN_ELEMENTS: 10000,
  WCAG_CONTRAST_NORMAL_TEXT: 4.5,
  WCAG_CONTRAST_LARGE_TEXT: 3.0,
  LARGE_TEXT_MIN_PX: 24, // 18pt in standard CSS 96dpi
  LARGE_TEXT_BOLD_MIN_PX: 18.66, // 14pt in standard CSS 96dpi
  BOLD_FONT_WEIGHT_MIN: 700,
} as const;
