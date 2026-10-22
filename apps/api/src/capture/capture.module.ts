import { Module } from '@nestjs/common';
import { DestinationGuardService } from './destination-guard.service';
import { DNS_RESOLVER_TOKEN, SystemDnsResolver } from './dns-resolver';

@Module({
  providers: [
    DestinationGuardService,
    {
      provide: DNS_RESOLVER_TOKEN,
      useClass: SystemDnsResolver,
    },
  ],
  exports: [DestinationGuardService, DNS_RESOLVER_TOKEN],
})
export class CaptureModule {}
