import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/apiError";
import { isProd } from "../config/env";

export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.path}` },
  });
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: "VALIDATION_ERROR", message: "Invalid request", details: err.flatten() },
    });
  }

  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);

  return res.status(500).json({
    error: {
      code: "INTERNAL",
      message: "Something went wrong",
      ...(isProd ? {} : { debug: err instanceof Error ? err.stack : err }),
    },
  });
};
