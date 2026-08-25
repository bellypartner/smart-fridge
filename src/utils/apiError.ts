export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static badRequest(message: string, code = "BAD_REQUEST", details?: unknown) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(message = "Unauthorized", code = "UNAUTHORIZED") {
    return new ApiError(401, code, message);
  }
  static forbidden(message = "Forbidden", code = "FORBIDDEN") {
    return new ApiError(403, code, message);
  }
  static notFound(message = "Not found", code = "NOT_FOUND") {
    return new ApiError(404, code, message);
  }
  static conflict(message: string, code = "CONFLICT") {
    return new ApiError(409, code, message);
  }
  static gone(message: string, code = "GONE") {
    return new ApiError(410, code, message);
  }
  static internal(message = "Internal server error", code = "INTERNAL") {
    return new ApiError(500, code, message);
  }
}
