import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

/**
 * Authentication controller.
 *
 * Exposes REST API endpoints for user registration, login, and profile access.
 * All routes are prefixed with `/api/auth`.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Registers a new user account.
   *
   * POST /api/auth/register
   */
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    const user = await this.authService.register(registerDto);
    return {
      message: 'User registered successfully',
      user,
    };
  }

  /**
   * Authenticates a user and returns a JWT token.
   *
   * POST /api/auth/login
   */
  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const result = await this.authService.login(loginDto);
    return result;
  }

  /**
   * Returns the authenticated user's profile.
   *
   * GET /api/auth/profile
   * Requires valid JWT token in Authorization header.
   */
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser() user: { userId: string; email: string }) {
    return {
      userId: user.userId,
      email: user.email,
    };
  }
}
