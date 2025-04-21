import { Router } from "express";
import { buildDataloaders, getDb } from "../db";
import { asyncify } from "../utils";

const router = Router();

router.get(
  "/api/maps",
  asyncify(async (req, res) => {
    const db = getDb();
    const dataloaders = buildDataloaders(db);

    res.setHeader("Cache-Control", "public, max-age=7200");
    res.setHeader("Content-Type", "application/jsonl");
    if (true) {
      for (const map of dataloaders.listMaps()) {
        res.write(JSON.stringify(map) + "\n");
      }

      res.end();
    } else {
      const maps = [...dataloaders.listMaps()];
      res.json(maps);
    }
  }),
);

router.get(
  "/api/maps/details/:map",
  asyncify(async (req, res) => {
    const db = getDb();
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
