import { NextFunction, Request, Response, Router } from "express";
import "dotenv/config";
import { sleep } from "../utils";
import "cookie-parser";

export function isLoggedIn(req: Request) {
  return req.cookies.authorizedkey === process.env.ADMIN_PASSWORD;
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
  const delay = sleep(100);
  const { username, password } = req.body;
  if (username !== "hemorrhoids" || password !== process.env.ADMIN_PASSWORD) {
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
