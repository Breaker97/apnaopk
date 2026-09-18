import { NextResponse } from "next/server";
import { API_CACHE_CONTROL } from "@/lib/http-cache-policy";
import type { ApiResponse, PaginatedResponse } from "@/types";

/**
 * API Response Utilities
 * Standardized response format for all API endpoints
 */

/**
 * These payloads are per-request reads of live data (carts, stock, orders,
 * catalog listings) and several are session-scoped. Next does not set any
 * Cache-Control on route handlers, which leaves them open to heuristic reuse by
 * browsers and intermediaries — the same class of stale-read that made freshly
 * published products invisible on the storefront. Streaming and file-serving
 * routes set their own headers and do not go through these helpers.
 */
const NO_STORE_HEADERS = { "Cache-Control": API_CACHE_CONTROL } as const;

/**
 * Create a success response
 */
export function successResponse<T>(
  data: T,
  message?: string,
  status: number = 200
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(
    {
      success: true,
      data,
      message,
    },
    { status, headers: NO_STORE_HEADERS }
  );
}

/**
 * Create an error response
 */
export function errorResponse(
  error: string,
  status: number = 400
): NextResponse<ApiResponse> {
  return NextResponse.json(
    {
      success: false,
      error,
    },
    { status, headers: NO_STORE_HEADERS }
  );
}

/**
 * Create a paginated response
 */
export function paginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  total: number,
  /** Fields that ride beside `data` and `pagination`, e.g. a search correction. */
  extra?: Record<string, unknown>
): NextResponse<ApiResponse<PaginatedResponse<T>>> {
  const totalPages = Math.ceil(total / limit);

  return NextResponse.json(
    {
      success: true,
      data: {
        data,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        ...extra,
      },
    },
    { headers: NO_STORE_HEADERS }
  );
}

/**
 * Create a created response (201)
 */
export function createdResponse<T>(
  data: T,
  message?: string
): NextResponse<ApiResponse<T>> {
  return successResponse(data, message || "Created successfully", 201);
}

/**
 * Handle not found
 */
export function notFoundResponse(
  resource: string = "Resource"
): NextResponse<ApiResponse> {
  return errorResponse(`${resource} not found`, 404);
}

