import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from './auth/auth.module';
import { BiometricModule } from './biometric/biometric.module';
import configuration from './config/configuration';

/**
 * Root application module.
 *
 * Orchestrates all feature modules and configures global services:
 * - ConfigModule: Environment variable management
 * - MongooseModule: MongoDB database connection
 * - AuthModule: User registration and credential authentication
 * - BiometricModule: Biometric credential registration and verification
 */
@Module({
  imports: [
    // Global configuration from environment variables
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // MongoDB database connection
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('mongodb.uri'),
      }),
    }),
    // Feature modules
    AuthModule,
    BiometricModule,
  ],
})
export class AppModule {}
