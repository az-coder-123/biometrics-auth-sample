import { ConflictException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';
import { Model } from 'mongoose';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { User, UserDocument } from './schemas/user.schema';

/**
 * Authentication service.
 *
 * Handles user registration, login, and JWT token generation.
 * Follows Single Responsibility Principle by focusing solely on
 * credential-based authentication logic.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Registers a new user with hashed password.
   *
   * @param registerDto - User registration data
   * @returns Created user document (password excluded)
   * @throws ConflictException if email is already registered
   */
  async register(registerDto: RegisterDto): Promise<Omit<UserDocument, 'password'>> {
    const { email, password, fullName } = registerDto;

    const existingUser = await this.userModel.findOne({ email }).exec();
    if (existingUser) {
      this.logger.warn(`Registration attempt with existing email: ${email}`);
      throw new ConflictException('Email is already registered');
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const createdUser = new this.userModel({
      email,
      password: hashedPassword,
      fullName,
    });

    const savedUser = await createdUser.save();
    this.logger.log(`User registered successfully: ${email}`);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _password, ...userWithoutPassword } = savedUser.toObject();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return userWithoutPassword as any;
  }

  /**
   * Authenticates a user with email and password.
   *
   * @param loginDto - User login credentials
   * @returns JWT access token and user info
   * @throws UnauthorizedException if credentials are invalid
   */
  async login(loginDto: LoginDto): Promise<{ accessToken: string; userId: string; email: string }> {
    const { email, password } = loginDto;

    const user = await this.userModel.findOne({ email }).exec();
    if (!user) {
      this.logger.warn(`Login attempt with unregistered email: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      this.logger.warn(`Invalid password attempt for email: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      this.logger.warn(`Inactive user attempted login: ${email}`);
      throw new UnauthorizedException('Account is deactivated');
    }

    const payload: JwtPayload = { sub: user._id.toString(), email: user.email };
    const accessToken = this.generateToken(payload);

    this.logger.log(`User logged in successfully: ${email}`);

    return {
      accessToken,
      userId: user._id.toString(),
      email: user.email,
    };
  }

  /**
   * Generates a JWT token for the given user ID.
   *
   * @param userId - MongoDB user document ID
   * @returns Signed JWT access token
   */
  generateTokenForUser(userId: string): string {
    const payload: JwtPayload = { sub: userId, email: '' };
    return this.generateToken(payload);
  }

  /**
   * Generates a JWT token with full payload including email.
   *
   * @param userId - MongoDB user document ID
   * @param email - User email address
   * @returns Signed JWT access token
   */
  generateFullToken(userId: string, email: string): string {
    const payload: JwtPayload = { sub: userId, email };
    return this.generateToken(payload);
  }

  /**
   * Finds a user by their MongoDB document ID.
   *
   * @param userId - User document ID
   * @returns User document or null if not found
   */
  async findUserById(userId: string): Promise<UserDocument | null> {
    return this.userModel.findById(userId).exec();
  }

  /**
   * Finds a user by their email address.
   *
   * @param email - User email address
   * @returns User document or null if not found
   */
  async findUserByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email }).exec();
  }

  /**
   * Generates a signed JWT token from the given payload.
   *
   * @param payload - JWT payload data
   * @returns Signed JWT token string
   */
  private generateToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload);
  }
}
