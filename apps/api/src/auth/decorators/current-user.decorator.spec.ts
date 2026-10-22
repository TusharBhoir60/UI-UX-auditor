import { ExecutionContext } from '@nestjs/common';
import { getCurrentUserByContext } from './current-user.decorator';

describe('CurrentUser decorator helper', () => {
  const mockUser = {
    id: 'user-uuid-1234',
    email: 'tester@example.com',
  };

  const createMockContext = (user?: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext);

  it('extracts full user object when data parameter is not passed', () => {
    const ctx = createMockContext(mockUser);
    const result = getCurrentUserByContext(undefined, ctx);
    expect(result).toEqual(mockUser);
  });

  it('extracts specific user property when key is passed', () => {
    const ctx = createMockContext(mockUser);
    expect(getCurrentUserByContext('id', ctx)).toBe('user-uuid-1234');
    expect(getCurrentUserByContext('email', ctx)).toBe('tester@example.com');
  });

  it('returns undefined when request.user is not set', () => {
    const ctx = createMockContext(undefined);
    expect(getCurrentUserByContext(undefined, ctx)).toBeUndefined();
    expect(getCurrentUserByContext('id', ctx)).toBeUndefined();
  });
});
