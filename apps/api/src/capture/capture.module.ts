import { Module } from '@nestjs/common';
import { BrowserProvider, PlaywrightBrowserProvider } from './browser-provider';
import { BROWSER_PROVIDER_TOKEN } from './capture.constants';
import { CaptureService } from './capture.service';
import { DestinationGuardService } from './destination-guard.service';
import { DNS_RESOLVER_TOKEN, SystemDnsResolver } from './dns-resolver';

@Module({
  providers: [
    DestinationGuardService,
    {
      provide: DNS_RESOLVER_TOKEN,
      useClass: SystemDnsResolver,
    },
    CaptureService,
    {
      provide: BROWSER_PROVIDER_TOKEN,
      useClass: PlaywrightBrowserProvider,
    },
  ],
  exports: [
    DestinationGuardService,
    DNS_RESOLVER_TOKEN,
    CaptureService,
    BROWSER_PROVIDER_TOKEN,
  ],
})
export class CaptureModule {}
