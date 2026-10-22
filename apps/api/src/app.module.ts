import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AuditsModule } from './audits/audits.module';
import { CaptureModule } from './capture/capture.module';
import { QueueModule } from './queue/queue.module';
import { RulesModule } from './rules/rules.module';

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    DatabaseModule,
    AuthModule,
    AuditsModule,
    CaptureModule,
    QueueModule,
    RulesModule,
  ],
})
export class AppModule {}
