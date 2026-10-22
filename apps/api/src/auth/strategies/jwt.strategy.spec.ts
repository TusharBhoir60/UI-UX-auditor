import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy, JwtPayload } from './jwt.strategy';
import { PrismaService } from '../../database/prisma.service';

type MockPrismaService = {
  user: {
    findUnique: jest.Mock;
  };
};

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prismaService: MockPrismaService;
  let configService: jest.Mocked<ConfigService>;

  const canonicalUserId = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';

  const mockActiveUser = {
    id: canonicalUserId,
    email: 'tester@example.com',
    deletedAt: null,
  };

  beforeEach(() => {
    prismaService = {
      user: {
        findUnique: jest.fn(),
      },
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_SECRET') {
          return 'test-secret-at-least-32-chars-long-here';
        }
        return undefined;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    strategy = new JwtStrategy(
      configService,
      prismaService as unknown as PrismaService,
    );
  });

  it('throws an error during instantiation if JWT_SECRET is not configured', () => {
    const emptyConfigService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    expect(
      () =>
        new JwtStrategy(
          emptyConfigService,
          prismaService as unknown as PrismaService,
        ),
    ).toThrow('JWT_SECRET is not configured');
  });

  describe('validate', () => {
    const validPayload: JwtPayload = {
      sub: canonicalUserId,
      email: 'tester@example.com',
    };

    it('returns authenticated user if payload is valid and user is active', async () => {
      prismaService.user.findUnique.mockResolvedValue(mockActiveUser);

      const result = await strategy.validate(validPayload);

      expect(prismaService.user.findUnique).toHaveBeenCalledWith({
        where: { id: canonicalUserId },
        select: {
          id: true,
          email: true,
          deletedAt: true,
        },
      });
      expect(result).toEqual({
        id: canonicalUserId,
        email: 'tester@example.com',
      });
    });

    it('rejects authentication with 401 if payload is not an object', async () => {
      await expect(strategy.validate('string-payload')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate(null)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(strategy.validate(undefined)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects authentication with 401 if payload sub is missing or empty', async () => {
      await expect(
        strategy.validate({ email: 'tester@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        strategy.validate({ sub: '', email: 'tester@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects authentication with 401 if payload sub is not a valid UUID format', async () => {
      await expect(
        strategy.validate({ sub: 'user-1234', email: 'tester@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        strategy.validate({ sub: 'not-a-valid-uuid-format', email: 'tester@example.com' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects authentication with 401 if payload email is missing', async () => {
      await expect(
        strategy.validate({ sub: canonicalUserId }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects authentication with 401 if user does not exist in database', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);

      await expect(strategy.validate(validPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects authentication with 401 if user account is soft-deleted (deletedAt != null)', async () => {
      prismaService.user.findUnique.mockResolvedValue({
        ...mockActiveUser,
        deletedAt: new Date(),
      });

      await expect(strategy.validate(validPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});
