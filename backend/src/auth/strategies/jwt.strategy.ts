import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * JWT Passport strategy.
 *
 * Extracts and validates JWT tokens from the Authorization header.
 * The validated payload is attached to `request.user` for use in guards and decorators.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret')!,
    });
  }

  /**
   * Validates the decoded JWT payload.
   *
   * @param payload - The decoded JWT payload
   * @returns User identification data attached to the request
   */
  validate(payload: JwtPayload): { userId: string; email: string } {
    return { userId: payload.sub, email: payload.email };
  }
}
