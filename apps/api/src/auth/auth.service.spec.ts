import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../database/prisma.service';

type MockPrismaService = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

describe('AuthService', () => {
  let authService: AuthService;
  let prismaService: MockPrismaService;
  let jwtService: jest.Mocked<JwtService>;
  let configService: jest.Mocked<ConfigService>;

  const mockUser = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    email: 'user@example.com',
    passwordHash: '$2b$10$hashedpasswordforexistinguser123456789012345678901234',
    createdAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    prismaService = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };

    jwtService = {
      signAsync: jest.fn().mockResolvedValue('mocked-jwt-token-xyz'),
    } as unknown as jest.Mocked<JwtService>;

    configService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'BCRYPT_SALT_ROUNDS') return 10;
        if (key === 'JWT_SECRET') return 'test-jwt-secret-min-32-chars-long-here';
        if (key === 'JWT_EXPIRES_IN') return '24h';
        return defaultValue;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    authService = new AuthService(
      prismaService as unknown as PrismaService,
      jwtService,
      configService,
    );
  });

  describe('canonicalizeEmail', () => {
    it('trims whitespace and converts email to lowercase', () => {
      expect(authService.canonicalizeEmail('   User.Name@Example.COM   ')).toBe(
        'user.name@example.com',
      );
    });
  });

  describe('register', () => {
    const registerDto = {
      email: '  NewUser@Example.COM  ',
      password: 'valid-secure-password-12',
    };

    it('successfully registers a new user, hashes password, and returns only id and email', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);
      prismaService.user.create.mockResolvedValue({
        id: mockUser.id,
        email: 'newuser@example.com',
      } as any);

      const hashSpy = jest.spyOn(bcrypt, 'hash');

      const result = await authService.register(registerDto);

      expect(authService.canonicalizeEmail(registerDto.email)).toBe('newuser@example.com');
      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'newuser@example.com' },
      });
      expect(hashSpy).toHaveBeenCalledWith(registerDto.password, 10);
      expect(prismaService.user.create).toHaveBeenCalledWith({
        data: {
          email: 'newuser@example.com',
          passwordHash: expect.any(String),
        },
        select: {
          id: true,
          email: true,
        },
      });

      // Verify plaintext password is never passed to persistence
      const createData = prismaService.user.create.mock.calls[0][0].data;
      expect(createData.passwordHash).not.toBe(registerDto.password);
      expect((createData as any).password).toBeUndefined();

      // Verify response contains exactly public fields
      expect(result).toEqual({
        id: mockUser.id,
        email: 'newuser@example.com',
      });
      expect((result as any).passwordHash).toBeUndefined();
      expect((result as any).password).toBeUndefined();
    });

    it('rejects duplicate email with HTTP 400 BadRequestException when user already exists', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser as any);

      await expect(authService.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('rejects duplicate email with HTTP 400 when matching soft-deleted user exists', async () => {
      prismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        deletedAt: new Date(),
      } as any);

      await expect(authService.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaService.user.create).not.toHaveBeenCalled();
    });

    it('maps concurrent database unique constraint violation (P2002) to HTTP 400 BadRequestException', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`email`)',
        {
          code: 'P2002',
          clientVersion: '6.19.3',
        },
      );
      prismaService.user.create.mockRejectedValue(p2002Error);

      await expect(authService.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('re-throws unexpected database errors without leaking internal credentials', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);
      const dbError = new Error('Database connection failed on 5432');
      prismaService.user.create.mockRejectedValue(dbError);

      await expect(authService.register(registerDto)).rejects.toThrow(
        'Database connection failed on 5432',
      );
    });
  });

  describe('login', () => {
    const loginDto = {
      email: '  User@Example.COM  ',
      password: 'valid-secure-password-12',
    };

    it('returns an access token for valid credentials', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser as any);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      const result = await authService.login(loginDto);

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'user@example.com' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        mockUser.passwordHash,
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      });
      expect(result).toEqual({
        access_token: 'mocked-jwt-token-xyz',
      });
    });

    it('returns generic HTTP 401 UnauthorizedException when user does not exist', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);
      const compareSpy = jest.spyOn(bcrypt, 'compare');

      await expect(authService.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      // Verify dummy compare was executed for timing mitigation
      expect(compareSpy).toHaveBeenCalledWith(
        loginDto.password,
        expect.stringContaining('$2b$10$'),
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('returns generic HTTP 401 UnauthorizedException when password does not match', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser as any);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => false);

      await expect(authService.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('returns generic HTTP 401 UnauthorizedException for soft-deleted user', async () => {
      prismaService.user.findUnique.mockResolvedValue({
        ...mockUser,
        deletedAt: new Date(),
      } as any);
      const compareSpy = jest.spyOn(bcrypt, 'compare');

      await expect(authService.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(compareSpy).toHaveBeenCalledWith(
        loginDto.password,
        expect.stringContaining('$2b$10$'),
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('ensures password hash is absent from token payload and return value', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockUser as any);
      jest.spyOn(bcrypt, 'compare').mockImplementation(async () => true);

      const result = await authService.login(loginDto);

      const tokenPayload = jwtService.signAsync.mock.calls[0][0];
      expect(tokenPayload).toEqual({
        sub: mockUser.id,
        email: mockUser.email,
      });
      expect((tokenPayload as any).passwordHash).toBeUndefined();
      expect((tokenPayload as any).password_hash).toBeUndefined();
      expect((tokenPayload as any).password).toBeUndefined();
      expect((result as any).passwordHash).toBeUndefined();
    });
  });
});
