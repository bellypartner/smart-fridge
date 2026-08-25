import { describe, expect, it } from "vitest";
import { ApiError } from "../src/utils/apiError";

describe("ApiError", () => {
  it("badRequest defaults to 400 and BAD_REQUEST code", () => {
    const err = ApiError.badRequest("Invalid input");
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).toBe("Invalid input");
  });

  it("supports a custom error code", () => {
    const err = ApiError.badRequest("Out of stock", "OUT_OF_STOCK");
    expect(err.code).toBe("OUT_OF_STOCK");
  });

  it("conflict defaults to 409", () => {
    expect(ApiError.conflict("Session already active").statusCode).toBe(409);
  });

  it("notFound defaults to 404", () => {
    expect(ApiError.notFound().statusCode).toBe(404);
  });

  it("is an instance of Error and ApiError", () => {
    const err = ApiError.internal();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
  });
});
