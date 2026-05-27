import { Request, Response, NextFunction } from "express";
import { AppError } from "./errorHandler";
import { AuthRequest } from "./auth";

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  const ownerAddress = process.env.OWNER_ADDRESS?.toLowerCase();
  if (!ownerAddress) {
    return next(new AppError("Server misconfiguration: OWNER_ADDRESS not set", 500, "INTERNAL_ERROR"));
  }

  const authReq = req as AuthRequest;
  if (!authReq.auth) {
    return next(new AppError("Authentication required", 401, "UNAUTHORIZED"));
  }

  if (authReq.auth.address.toLowerCase() !== ownerAddress) {
    return next(new AppError("Owner access required", 403, "FORBIDDEN"));
  }

  next();
}
