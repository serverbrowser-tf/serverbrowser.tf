import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import serverTiming from "server-timing";
import login, { isLoggedIn } from "./api/login";
import maps from "./api/maps";
import servers from "./api/servers";
import misc from "./api/misc";
import { scheduleDbOptimize } from "./db";

const app = express();
const PORT = 3030;

scheduleDbOptimize();

app.use(cookieParser());
app.use(cors());
app.use(express.json());
app.use(
  serverTiming({
    enabled: (req) => isLoggedIn(req),
  }),
);

app.use(maps);
app.use(login);
app.use(servers);
app.use(misc);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Server is listening on port ${PORT}`);
});
