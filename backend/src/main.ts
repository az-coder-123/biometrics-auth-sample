import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

/**
 * Bootstrap the NestJS application.
 *
 * Configures global pipes, filters, and interceptors before starting the server.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for mobile WebView integration
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Set global prefix for all API routes
  app.setGlobalPrefix('api');

  // Global validation pipe for request DTO validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new HttpExceptionFilter());

  // Global interceptor for consistent success responses
  app.useGlobalInterceptors(new TransformInterceptor());

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}/api`);
  console.log(`Environment: ${process.env.NODE_ENV ?? 'development'}`);
}

bootstrap();
