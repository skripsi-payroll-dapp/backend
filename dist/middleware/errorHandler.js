"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppError = void 0;
exports.globalErrorHandler = globalErrorHandler;
/**
 * Custom application error class that automatically carries
 * HTTP status codes and application-specific errorCodes.
 */
class AppError extends Error {
    status;
    errorCode;
    constructor(message, status = 400, errorCode = "BAD_REQUEST") {
        super(message);
        this.status = status;
        this.errorCode = errorCode;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
exports.AppError = AppError;
/**
 * Express Global Exception Handler.
 * Formats all uncaught errors into a standardized JSON ErrorResponse object.
 */
function globalErrorHandler(err, req, res, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
next) {
    const status = err.status || 500;
    const errorCode = err.errorCode || "INTERNAL_SERVER_ERROR";
    const message = err.message || "An unexpected error occurred";
    const errorResponse = {
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
