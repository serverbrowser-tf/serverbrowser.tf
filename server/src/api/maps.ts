import { Router } from "express";
import { buildDataloaders, db } from "../db";
import { asyncify } from "../utils";

const router = Router();

router.get(
  "/api/maps",
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);

    res.setHeader("Cache-Control", "public, max-age=7200");
    res.setHeader("Content-Type", "application/jsonl");

    const body =
      [...dataloaders.listMaps()].map((map) => JSON.stringify(map)).join("\n") +
      "\n";
    res.end(body);
  }),
);

router.get(
  "/api/maps/details/:map",
  asyncify(async (req, res) => {
    const dataloaders = buildDataloaders(db);
    const map = req.params.map;

    res.setHeader("Cache-Control", "public, max-age=3600");

    res.startTime("db", "");
    const mapServers = await dataloaders.mapServers.load(map);
    res.endTime("db");

    res.json({
      map,
      mapServers,
    });
  }),
);

export default router;
