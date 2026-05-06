import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Custom parameter decorator to extract the authenticated user from the request.
 *
 * Optionally accepts a specific property name to extract from the user object.
 *
 * @example
 * // Get full user object
 * @CurrentUser() user: JwtPayload
 *
 * @example
 * // Get specific property
 * @CurrentUser('userId') userId: string
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    return data ? user?.[data] : user;
  },
);
