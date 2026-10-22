import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';

describe('Auth Endpoints HTTP-Level Integration', () => {
  let app: INestApplication;
  let baseUrl: string;
  let authService: jest.Mocked<AuthService>;

  beforeAll(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compile();

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
    baseUrl = `http://localhost:${port}/api/v1/auth`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('returns 201 Created with { id, email } for valid registration', async () => {
      authService.register.mockResolvedValueOnce({
        id: 'user-uuid-1234',
        email: 'tester@example.com',
      });

      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tester@example.com',
          password: 'securePassword123',
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data).toEqual({
        id: 'user-uuid-1234',
        email: 'tester@example.com',
      });
      expect(data.password).toBeUndefined();
      expect(data.passwordHash).toBeUndefined();
    });

    it('returns 400 Bad Request when password is under 12 characters', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tester@example.com',
          password: 'short',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toBeDefined();
    });

    it('returns 400 Bad Request when extra unknown properties are submitted', async () => {
      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tester@example.com',
          password: 'securePassword123',
          isAdmin: true,
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(Array.isArray(data.message) ? data.message.join(' ') : data.message).toMatch(
        /should not exist/,
      );
    });

    it('returns 400 Bad Request when service throws duplicate email exception', async () => {
      authService.register.mockRejectedValueOnce(
        new BadRequestException('Email is already registered'),
      );

      const res = await fetch(`${baseUrl}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'existing@example.com',
          password: 'securePassword123',
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toBe('Email is already registered');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 200 OK with { access_token } for valid login', async () => {
      authService.login.mockResolvedValueOnce({
        access_token: 'header.payload.signature',
      });

      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tester@example.com',
          password: 'securePassword123',
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        access_token: 'header.payload.signature',
      });
    });

    it('returns 401 Unauthorized for invalid credentials', async () => {
      authService.login.mockRejectedValueOnce(
        new UnauthorizedException('Invalid credentials'),
      );

      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'tester@example.com',
          password: 'wrongPassword123',
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.message).toBe('Invalid credentials');
    });

    it('returns 400 Bad Request for malformed login body', async () => {
      const res = await fetch(`${baseUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'not-an-email',
          password: '',
        }),
      });

      expect(res.status).toBe(400);
    });
  });
});
