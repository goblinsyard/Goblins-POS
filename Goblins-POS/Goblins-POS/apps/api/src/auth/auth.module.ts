import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * Resolve the JWT signing secret. In production a strong JWT_SECRET is
 * mandatory — refuse to boot without one rather than silently signing tokens
 * with a well-known dev value (which would let anyone forge access tokens).
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';
  if (secret && secret.length >= 16) return secret;
  if (isProd) {
    throw new Error(
      'JWT_SECRET is required in production and must be at least 16 characters. Refusing to start.',
    );
  }
  // Non-production only: warn loudly and fall back so local dev still works.
  console.warn(
    '[auth] JWT_SECRET is unset or too short — using an insecure dev fallback. Set JWT_SECRET before deploying.',
  );
  return secret ?? 'dev-secret-change-me';
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
