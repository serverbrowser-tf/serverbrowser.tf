import "normalize.css";
import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Route, Routes } from "react-router";
import { Login } from "./Login.tsx";
import day from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat.js";
import utc from "dayjs/plugin/utc.js";
import { Logout } from "./Logout.tsx";
import { queryClient } from "./globals.ts";
import { Maps } from "./Maps.tsx";
import { MapView } from "./MapInfo.tsx";
import { Title } from "./Title.tsx";
import { ServerPage } from "./ServerPage.tsx";

day.extend(localizedFormat);
day.extend(utc);

console.info(
  "Fork me on github!",
  "https://github.com/serverbrowser-tf/serverbrowser.tf",
);

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <nav>
          <Title />
          <Logout />
        </nav>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/server/:ip/*" element={<ServerPage />} />
          <Route path="/servers/:ip" element={<App />} />
          <Route path="/favorites" element={<App />} />
          <Route path="/blacklist" element={<App />} />
          <Route path="/favorites/servers/:ip" element={<App />} />
          <Route path="/blacklist/servers/:ip" element={<App />} />
          <Route path="/map/:map" element={<MapView />} />
          <Route path="/maps/*" element={<Maps />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin-view" element={<App />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
