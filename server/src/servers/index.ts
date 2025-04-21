import {
  queryGameServerInfo,
  queryMasterServer,
  REGIONS,
} from "steam-server-query";
import { HydratedServerInfo } from "../types";
import fastpath from "./fastpath.json";
import { sleep } from "../utils";

const ipBan = new Set([...fastpath.map((server) => server.addr)]);

const regions = [
  // frontload the most popular regions so we can async better.
  REGIONS.EUROPE,
  REGIONS.US_EAST_COAST,
  REGIONS.US_WEST_COAST,
  REGIONS.AFRICA,
  REGIONS.ASIA,
  REGIONS.AUSTRALIA,
  REGIONS.MIDDLE_EAST,
  REGIONS.SOUTH_AMERICA,
  REGIONS.ALL,
];

export async function getAllServers() {
  try {
    const servers = await queryMasterServer(
      "hl2master.steampowered.com:27011",
      REGIONS.ALL,
      {
        appid: 440,
        secure: 1,
        gamedir: "tf",
      },
      180_000,
    );
    return servers;
  } catch (e) {
    console.error(e);
  }
  return [];
}

interface QueriedServerInfo {
  ip: string;
  regions: REGIONS;
}

export function getListOfServers(): AsyncIterable<QueriedServerInfo> &
  AsyncIterator<QueriedServerInfo> {
  let done = false;
  let resolves: Array<() => void> = [];
  const results: Array<{ ip: string; regions: REGIONS }> = [];
  async function inner() {
    const allServers = new Set<string>();
    for (let i = 0; i < regions.length; i++) {
      const region = regions[i];
      try {
        const servers = await queryMasterServer(
          "hl2master.steampowered.com:27011",
          region,
          {
            appid: 440,
            secure: 1,
            gamedir: "tf",
            // servers that are NOT empty
            empty: 1,
          },
          30_000,
        );

        for (const connect of servers) {
          const [ip] = connect.split(":");
          if (ipBan.has(ip)) {
            continue;
          }
          if (allServers.has(connect)) {
            continue;
          }
          allServers.add(connect);
          results.push({
            ip: connect,
            regions: region,
          });
        }
        for (const res of resolves) {
          res();
        }
        resolves.splice(0, resolves.length);
      } catch {}

      await sleep(500);
    }

    for (const res of resolves) {
      res();
    }
    resolves.splice(0, resolves.length);
    done = true;
  }
  inner();

  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (results.length === 0) {
        if (done) {
          return {
            done,
            value: undefined,
          };
        }
        const promise = new Promise<void>((myResolve) => {
          resolves.push(myResolve);
        });
        await promise;

        if (done && results.length === 0) {
          return {
            done,
            value: undefined,
          };
        }
      }

      return {
        done: false,
        value: results.shift()!,
      };
    },
  };
}

export async function pingServers() {
  const serverAddresses = getListOfServers();
  let servers: HydratedServerInfo[] = [];
  async function spawnWorker() {
    while (true) {
      try {
        const result = await serverAddresses.next();
        if (result.done) {
          return;
        }
        const server = result.value;

        const pingedInfo = await queryGameServerInfo(server.ip);
        servers.push({
          ip: server.ip,
          server: server.ip,
          name: pingedInfo.name,
          map: pingedInfo.map,
          keywords: pingedInfo.keywords,
          players: pingedInfo.players,
          maxPlayers: pingedInfo.maxPlayers,
          bots: pingedInfo.bots,
          visibility: pingedInfo.visibility,
          regions: server.regions,
          region: server.regions,
          geoip: null,
        });
      } catch {}
    }
  }
  await Promise.all([
    spawnWorker(),
    spawnWorker(),
    spawnWorker(),
    spawnWorker(),
    spawnWorker(),
  ]);

  return servers;
}
