import { NextFunction, Request, Response, Router } from "express";
import * as v from "valibot";
import "dotenv/config";
import { sleep } from "../utils";
import "cookie-parser";

const loginBodySchema = v.object({
  username: v.string(),
  password: v.string(),
});
const ADMIN_USERNAME = "hemorrhoids";

export function parseLoginBody(input: unknown) {
  return v.safeParse(loginBodySchema, input);
}

export function isLoggedIn(req: Request) {
  return req.cookies.authorizedkey === process.env.ADMIN_PASSWORD;
}

export function isValidLogin(username: string, password: string) {
  return username === ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD;
}

export const isLoggedInMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!isLoggedIn(req)) {
    console.error("Failed request", req.url);
    res.status(401).end();
    return;
  }
  next();
};

const router = Router();

router.post("/api/login", (req, res) => {
  const body = parseLoginBody(req.body);
  if (!body.success) {
    res.status(400).end();
    return;
  }

  const delay = sleep(100);
  const { username, password } = body.output;
  if (!isValidLogin(username, password)) {
    console.error("Failed login", username, ": ", password);
    delay.then(() => {
      res.json({
        success: false,
        message: "wrong",
      });
    });
  } else {
    delay.then(() => {
      res.cookie("authorizedkey", process.env.ADMIN_PASSWORD, {
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
      res.json({
        success: true,
      });
    });
  }
});

export default router;
