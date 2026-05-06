/**
 * Application configuration factory.
 *
 * Centralizes all environment variable access with sensible defaults.
 * Used by ConfigModule for type-safe configuration throughout the application.
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  mongodb: {
    uri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/biometrics-auth',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'default-dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1h',
  },
  biometric: {
    challengeExpiresInSeconds: parseInt(
      process.env.CHALLENGE_EXPIRES_IN_SECONDS ?? '300',
      10,
    ),
  },
});
