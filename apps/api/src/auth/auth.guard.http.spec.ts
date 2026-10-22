import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  INestApplication,
  ValidationPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy, AuthenticatedUser } from './strategies/jwt.strategy';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { HealthController } from '../health/health.controller';
import { PrismaService } from '../database/prisma.service';

const TEST_JWT_SECRET = 'deterministic-test-jwt-secret-min-32-chars-long';
const TAMPERED_JWT_SECRET = 'tampered-secret-used-for-signature-tampering-test';

@Controller('test-protected')
@UseGuards(JwtAuthGuard)
class TestProtectedController {
  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return {
      userId: user.id,
      email: user.email,
    };
  }

  @Post('action')
  @HttpCode(HttpStatus.OK)
  doAction(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: Record<string, unknown>,
    @Query() query: Record<string, unknown>,
  ) {
    return {
      authenticatedUserId: user.id,
      submittedBodyUserId: body.userId,
      submittedQueryUserId: query.userId,
    };
  }
}

describe('JWT Guard and Protected Routes HTTP Integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwtService: JwtService;
  let mockPrismaService: {
    user: {
      findUnique: jest.Mock;
    };
  };

  const activeUser = {
    id: 'b2c3d4e5-f6a7-4890-abcd-ef1234567890',
    email: 'protected-user@example.com',
    deletedAt: null,
  };

  beforeAll(async () => {
    mockPrismaService = {
      user: {
        findUnique: jest.fn(),
      },
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        if (key === 'JWT_SECRET') return TEST_JWT_SECRET;
        if (key === 'JWT_EXPIRES_IN') return '1h';
        return defaultValue;
      }),
    };

    const mockAuthService = {
      register: jest.fn().mockResolvedValue({
        id: 'new-user-id',
        email: 'public-register@example.com',
      }),
      login: jest.fn().mockResolvedValue({
        access_token: 'public.login.token',
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: TEST_JWT_SECRET,
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [
        TestProtectedController,
        HealthController,
        AuthController,
      ],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    jwtService = moduleFixture.get<JwtService>(JwtService);

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.listen(0);
    const server = app.getHttpServer();
    const address = server.address();
    const port = typeof address === 'string' ? address : address.port;
    baseUrl = `http://localhost:${port}/api/v1`;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Public Endpoints Accessibility (Regression)', () => {
    it('GET /api/v1/health is accessible without authorization header', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('POST /api/v1/auth/register is accessible without authorization header', async () => {
      const res = await fetch(`${baseUrl}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'public-register@example.com',
          password: 'securePassword123',
        }),
      });
      expect(res.status).toBe(201);
    });

    it('POST /api/v1/auth/login is accessible without authorization header', async () => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'public-register@example.com',
          password: 'securePassword123',
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('Protected Route Token Verification', () => {
    it('rejects request with 401 when Authorization header is missing', async () => {
      const res = await fetch(`${baseUrl}/test-protected/profile`);
      expect(res.status).toBe(401);
    });

    it('rejects request with 401 when Authorization header is not Bearer scheme', async () => {
      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(res.status).toBe(401);
    });

    it('rejects request with 401 when JWT string is malformed', async () => {
      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: 'Bearer not.a.valid.jwt.string' },
      });
      expect(res.status).toBe(401);
    });

    it('rejects request with 401 when token has an invalid signature (tampered/different secret)', async () => {
      const tamperedToken = jwtService.sign(
        { sub: activeUser.id, email: activeUser.email },
        { secret: TAMPERED_JWT_SECRET },
      );

      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: `Bearer ${tamperedToken}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects request with 401 when token has expired', async () => {
      const expiredToken = jwtService.sign(
        { sub: activeUser.id, email: activeUser.email },
        { expiresIn: '-10s' },
      );

      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects request with 401 when payload does not have valid sub claim', async () => {
      const invalidPayloadToken = jwtService.sign({
        email: activeUser.email,
        // missing sub
      });

      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: `Bearer ${invalidPayloadToken}` },
      });
      expect(res.status).toBe(401);
    });

    it('accepts request with 200 when valid token and active user are provided', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(activeUser);

      const validToken = jwtService.sign({
        sub: activeUser.id,
        email: activeUser.email,
      });

      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        userId: activeUser.id,
        email: activeUser.email,
      });
    });

    it('rejects request with 401 when token is signed with a disallowed algorithm (e.g. HS384)', async () => {
      const hs384Token = jwtService.sign(
        { sub: activeUser.id, email: activeUser.email },
        { algorithm: 'HS384' },
      );

      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: `Bearer ${hs384Token}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects request with 401 when token contains a malformed non-UUID sub', async () => {
      const nonUuidToken = jwtService.sign({
        sub: 'not-a-valid-uuid',
        email: activeUser.email,
      });

      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: `Bearer ${nonUuidToken}` },
      });
      expect(res.status).toBe(401);
      expect(mockPrismaService.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects request with 401 when user does not exist in database', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);

      const validToken = jwtService.sign({
        sub: '00000000-0000-0000-0000-000000000000',
        email: 'ghost@example.com',
      });

      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });
      expect(res.status).toBe(401);
    });

    it('rejects request with 401 when user is soft-deleted (deletedAt != null)', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        ...activeUser,
        deletedAt: new Date(),
      });

      const validToken = jwtService.sign({
        sub: activeUser.id,
        email: activeUser.email,
      });

      const res = await fetch(`${baseUrl}/test-protected/profile`, {
        headers: { Authorization: `Bearer ${validToken}` },
      });
      expect(res.status).toBe(401);
    });
  });

  describe('Authenticated Identity Integrity', () => {
    it('prevents callers from spoofing identity via request body or query params', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(activeUser);

      const validToken = jwtService.sign({
        sub: activeUser.id,
        email: activeUser.email,
      });

      const res = await fetch(
        `${baseUrl}/test-protected/action?userId=spoofed-query-id`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validToken}`,
          },
          body: JSON.stringify({ userId: 'spoofed-body-id' }),
        },
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.authenticatedUserId).toBe(activeUser.id);
      expect(data.authenticatedUserId).not.toBe('spoofed-body-id');
      expect(data.authenticatedUserId).not.toBe('spoofed-query-id');
    });
  });
});
