import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Registration request data transfer object.
 *
 * Password strength policy:
 * Enforces a documented minimum password length of 12 characters for registration
 * without imposing arbitrary character-class complexity rules.
 * Raw password input is preserved intact without trimming or normalization.
 * Email canonicalization is deliberately deferred to the authentication service.
 */
export class RegisterDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  @IsNotEmpty({ message: 'email should not be empty' })
  email!: string;

  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password should not be empty' })
  @MinLength(12, { message: 'password must be at least 12 characters long' })
  password!: string;
}
