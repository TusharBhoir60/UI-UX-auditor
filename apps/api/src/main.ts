import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const webOrigin = configService.get<string>('WEB_ORIGIN', 'http://localhost:3000');
  app.enableCors({
    origin: webOrigin,
    credentials: true,
  });

  const port = configService.get<number>('API_PORT', 4000);
  await app.listen(port);
  console.log(`UI/UX Auditor API listening on http://localhost:${port}/api/v1`);
}

bootstrap();
