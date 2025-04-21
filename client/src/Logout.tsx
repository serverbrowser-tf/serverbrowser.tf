import React from 'react';
import { loggedInAtom, logout, useAtom } from "./globals.ts";
import "./Logout.css";

export const Logout = () => {
  const loggedIn = useAtom(loggedInAtom);

  if (!loggedIn) {
    return null;
  }

  return (
    <button type="button" className="logout" onClick={logout}>
      Logout
    </button>
  );
}
