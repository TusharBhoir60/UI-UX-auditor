import { Injectable } from '@nestjs/common';
import { Browser, chromium } from 'playwright';

/**
 * Interface abstraction for browser instance creation.
 * Enables deterministic mocking in unit tests without launching actual browser binaries.
 */
export interface BrowserProvider {
  launch(): Promise<Browser>;
}

/**
 * Default Playwright implementation launching headless Chromium.
 *
 * CRITICAL SECURITY REQUIREMENT:
 * The Chromium sandbox is kept strictly ENABLED (no --no-sandbox flag).
 */
@Injectable()
export class PlaywrightBrowserProvider implements BrowserProvider {
  async launch(): Promise<Browser> {
    return await chromium.launch({
      headless: true,
      // Chromium sandbox is enabled by default. Do not disable it!
    });
  }
}
