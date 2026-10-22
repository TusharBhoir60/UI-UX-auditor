import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

/**
 * Login request data transfer object.
 *
 * Validates request structure (valid email, non-empty string password)
 * without applying registration-only password-strength rules to existing passwords.
 * Raw password input is preserved intact without trimming or normalization.
 */
export class LoginDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty({ message: 'email should not be empty' })
  email!: string;

  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password should not be empty' })
  password!: string;
}
