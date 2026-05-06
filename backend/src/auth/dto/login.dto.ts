import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * DTO for user login request.
 *
 * Validates email format and ensures password is provided.
 */
export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  password: string;
}
