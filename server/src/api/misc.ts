import { Router } from "express";
import geoIp2 from "geoip-lite2";

const router = Router();

router.get("/api/location", (req, res) => {
  const forwardedIp = req.headers["x-forwarded-ip"];
  const cfIp = req.headers["cf-connecting-ip"];
  const realIp = req.socket.remoteAddress;
  let ip = cfIp ?? forwardedIp ?? realIp;
  if (typeof ip !== "string") {
    res.status(400).json({ success: false });
    return;
  }
  if (ip === "127.0.0.1") {
    // cloudflare's ip for serverbrowser.tf
    ip = "172.67.151.50";
  }
  res.setHeader("Cache-Control", `max-age=${60 * 60 * 24}, private`);

  const results = geoIp2.lookup(ip);

  const long = results?.ll[0];
  const lat = results?.ll[1];
  res.status(200).json({ success: true, long, lat });
});

export default router;
