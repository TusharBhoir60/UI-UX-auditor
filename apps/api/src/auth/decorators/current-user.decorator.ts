import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

export const getCurrentUserByContext = (
  data: keyof AuthenticatedUser | undefined,
  ctx: ExecutionContext,
) => {
  const request = ctx.switchToHttp().getRequest();
  const user: AuthenticatedUser | undefined = request.user;
  return data ? user?.[data] : user;
};

export const CurrentUser = createParamDecorator(getCurrentUserByContext);
