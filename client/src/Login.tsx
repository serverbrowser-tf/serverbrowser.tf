import React, { useEffect, useState } from "react";
import "./login.css";
import { api, apiRoute } from "./utils.ts";
import { useNavigate } from "react-router";
import { useAtom } from "./globals.ts";
import { checkLogin, loggedInAtom } from "./globals.ts";

const submitLogin = async (username: string, password: string) => {
  const json = await api(`${apiRoute}/api/login`, {
    method: "POST",
    body: { username, password },
  });

  if (!json.success) {
    throw new Error(json.message ?? "Unknown error");
  }
  return true;
};

export const Login = () => {
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const isLoggedIn = useAtom(loggedInAtom);

  useEffect(() => {
    if (isLoggedIn) {
      navigate("/");
    }
  }, [isLoggedIn, navigate]);

  return (
    <div className="login-container">
      <form
        className="right-align"
        onSubmit={async (event) => {
          event.preventDefault();
          const formData = new FormData(event.currentTarget);
          const username = formData.get("username");
          const password = formData.get("password");
          try {
            await submitLogin(username as string, password as string);
            if (checkLogin()) {
              setError("");
              navigate("/");
            }
          } catch (e) {
            if (e instanceof Error) {
              setError(e.message);
            } else {
              console.error(e);
            }
          }
        }}
      >
        <label>
          Username
          <input type="text" name="username" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>
        <div className="error">{error}</div>
        <button type="submit" className="submit">
          Login
        </button>
      </form>
    </div>
  );
};
