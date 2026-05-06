import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

/**
 * Standard API response wrapper interface.
 *
 * All successful API responses are wrapped in this format for consistency.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

/**
 * Global response transform interceptor.
 *
 * Wraps all successful responses in a consistent { success, data, timestamp } structure.
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
