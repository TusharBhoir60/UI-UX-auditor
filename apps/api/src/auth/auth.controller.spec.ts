import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
    } as unknown as jest.Mocked<AuthService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('delegates registration to AuthService.register', async () => {
    const dto = {
      email: 'developer@example.com',
      password: 'strongPassword123',
    };
    const expectedResult = {
      id: 'mock-id-123',
      email: 'developer@example.com',
    };
    authService.register.mockResolvedValue(expectedResult);

    const result = await controller.register(dto);
    expect(authService.register).toHaveBeenCalledWith(dto);
    expect(result).toEqual(expectedResult);
  });

  it('delegates login to AuthService.login', async () => {
    const dto = {
      email: 'developer@example.com',
      password: 'strongPassword123',
    };
    const expectedResult = {
      access_token: 'jwt.token.here',
    };
    authService.login.mockResolvedValue(expectedResult);

    const result = await controller.login(dto);
    expect(authService.login).toHaveBeenCalledWith(dto);
    expect(result).toEqual(expectedResult);
  });
});
