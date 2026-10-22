import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RegisterDto } from './register.dto';
import { LoginDto } from './login.dto';

describe('Auth DTO Validation with ValidationPipe', () => {
  let pipe: ValidationPipe;

  beforeEach(() => {
    pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    });
  });

  describe('RegisterDto', () => {
    it('passes validation with valid email and password >= 12 chars', async () => {
      const input = {
        email: 'developer@example.com',
        password: 'correct-horse-battery-staple',
      };

      const result = await pipe.transform(input, {
        type: 'body',
        metatype: RegisterDto,
      });

      expect(result).toBeInstanceOf(RegisterDto);
      expect(result.email).toBe(input.email);
      expect(result.password).toBe(input.password);
    });

    it('rejects invalid email address', async () => {
      const input = {
        email: 'not-an-email',
        password: 'correct-horse-battery-staple',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: RegisterDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty or missing email', async () => {
      const input = {
        email: '',
        password: 'correct-horse-battery-staple',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: RegisterDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects missing or empty password', async () => {
      const input = {
        email: 'developer@example.com',
        password: '',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: RegisterDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects weak registration password shorter than 12 characters', async () => {
      const input = {
        email: 'developer@example.com',
        password: 'short-pass',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: RegisterDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects unknown request body properties', async () => {
      const input = {
        email: 'developer@example.com',
        password: 'correct-horse-battery-staple',
        isAdmin: true,
        extraProperty: 'should-fail',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: RegisterDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('preserves raw password intact without trimming whitespace', async () => {
      const rawPassword = '  padded-password-over-12-chars  ';
      const input = {
        email: 'developer@example.com',
        password: rawPassword,
      };

      const result = (await pipe.transform(input, {
        type: 'body',
        metatype: RegisterDto,
      })) as RegisterDto;

      expect(result.password).toBe(rawPassword);
      expect(result.password.startsWith('  ')).toBe(true);
    });
  });

  describe('LoginDto', () => {
    it('passes validation with valid email and standard non-empty password', async () => {
      const input = {
        email: 'developer@example.com',
        password: 'any-password',
      };

      const result = await pipe.transform(input, {
        type: 'body',
        metatype: LoginDto,
      });

      expect(result).toBeInstanceOf(LoginDto);
      expect(result.email).toBe(input.email);
      expect(result.password).toBe(input.password);
    });

    it('does NOT enforce registration 12-character minimum on login passwords', async () => {
      const input = {
        email: 'developer@example.com',
        password: 'short', // 5 characters
      };

      const result = await pipe.transform(input, {
        type: 'body',
        metatype: LoginDto,
      });

      expect(result).toBeInstanceOf(LoginDto);
      expect(result.password).toBe('short');
    });

    it('rejects invalid email address on login', async () => {
      const input = {
        email: 'not-an-email',
        password: 'existing-password',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: LoginDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects empty or missing password on login', async () => {
      const input = {
        email: 'developer@example.com',
        password: '',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: LoginDto }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects unknown request body properties on login', async () => {
      const input = {
        email: 'developer@example.com',
        password: 'existing-password',
        extraField: 'unknown',
      };

      await expect(
        pipe.transform(input, { type: 'body', metatype: LoginDto }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
