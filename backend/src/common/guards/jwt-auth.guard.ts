import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * JWT authentication guard.
 *
 * Protects routes by requiring a valid JWT token in the Authorization header.
 * Uses Passport's JWT strategy for token validation.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }
}
