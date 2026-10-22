import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('returns the user object when authentication succeeds', () => {
    const mockUser = { id: 'uuid-1', email: 'test@example.com' };
    const result = guard.handleRequest(null, mockUser, null);
    expect(result).toBe(mockUser);
  });

  it('throws UnauthorizedException when user is null or undefined', () => {
    expect(() => guard.handleRequest(null, null, null)).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.handleRequest(null, false, null)).toThrow(
      UnauthorizedException,
    );
  });

  it('re-throws existing error if error occurred', () => {
    const customError = new Error('Custom authentication error');
    expect(() => guard.handleRequest(customError, null, null)).toThrow(
      customError,
    );
  });
});
