import { Request, Response, NextFunction } from "express";

export interface ErrorResponse {
  timestamp: string;
  status: number;
  errorCode: string;
  message: string;
}

/**
 * Custom application error class that automatically carries
 * HTTP status codes and application-specific errorCodes.
 */
export class AppError extends Error {
  public status: number;
  public errorCode: string;

  constructor(message: string, status: number = 400, errorCode: string = "BAD_REQUEST") {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Express Global Exception Handler.
 * Formats all uncaught errors into a standardized JSON ErrorResponse object.
 */
export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const status = err.status || 500;
  const errorCode = err.errorCode || "INTERNAL_SERVER_ERROR";
  const message = err.message || "An unexpected error occurred";

  const errorResponse: ErrorResponse = {
    timestamp: new Date().toISOString(),
    status,
    errorCode,
    message,
  };

  // Print stack traces for 500 errors to assist debugging
  if (status === 500) {
    console.error("[GlobalException] 500 Internal Server Error:", err);
  }

  res.status(status).json(errorResponse);
}
