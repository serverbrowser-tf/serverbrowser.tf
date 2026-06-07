import { NextFunction, Request, Response, Router } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import * as v from "valibot";
import "dotenv/config";
import { sleep } from "../utils";
import "cookie-parser";

const loginBodySchema = v.object({
  password: v.string(),
});
const AUTHORIZATION_COOKIE = "authorizedkey";
const AUTHENTICATED_COOKIE = "authenticated";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000;
const cookieOptions = {
  maxAge: COOKIE_MAX_AGE,
  path: "/",
  secure: true,
  sameSite: "strict" as const,
};

export function parseLoginBody(input: unknown) {
  return v.safeParse(loginBodySchema, input);
}

export function isValidToken(token: string) {
  const adminToken = process.env.ADMIN_PASSWORD;
  if (!adminToken) {
    return false;
  }

  const tokenDigest = Uint8Array.from(
    createHash("sha256").update(token).digest(),
  );
  const adminTokenDigest = Uint8Array.from(
    createHash("sha256").update(adminToken).digest(),
  );
  return timingSafeEqual(tokenDigest, adminTokenDigest);
}

export function isLoggedIn(req: Request) {
  const token = req.cookies[AUTHORIZATION_COOKIE];
  return typeof token === "string" && isValidToken(token);
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(AUTHORIZATION_COOKIE, {
    ...cookieOptions,
    httpOnly: true,
  });
  res.clearCookie(AUTHENTICATED_COOKIE, cookieOptions);
}

export function setAuthCookies(res: Response, token: string) {
  res.cookie(AUTHORIZATION_COOKIE, token, {
    ...cookieOptions,
    httpOnly: true,
  });
  res.cookie(AUTHENTICATED_COOKIE, "1", cookieOptions);
}

export const isLoggedInMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!isLoggedIn(req)) {
    console.error("Failed request", req.url);
    clearAuthCookies(res);
    res.status(401).end();
    return;
  }
  next();
};

const router = Router();

router.post("/api/login", (req, res) => {
  const body = parseLoginBody(req.body);
  if (!body.success) {
    clearAuthCookies(res);
    res.status(400).end();
    return;
  }

  const delay = sleep(100);
  const { password } = body.output;
  if (!isValidToken(password)) {
    console.error("Failed login");
    delay.then(() => {
      clearAuthCookies(res);
      res.json({
        success: false,
        message: "wrong",
      });
    });
  } else {
    delay.then(() => {
      setAuthCookies(res, password);
      res.json({
        success: true,
      });
    });
  }
});

router.post("/api/logout", (_req, res) => {
  clearAuthCookies(res);
  res.status(204).end();
});

export default router;
