import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * DTO for user registration request.
 *
 * Validates that all required fields are present and properly formatted.
 */
export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: 'Full name is required' })
  fullName!: string;
}