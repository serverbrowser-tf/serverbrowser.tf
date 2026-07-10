import { REGIONS } from "steam-server-query";

export interface UnhydratedServerInfo {
  ip: string;
  steamid?: string;
  server: string;
  name: string;
  map?: string;
  keywords?: string;
  players?: number;
  maxPlayers?: number;
  hours?: number;
  bots?: undefined;
  visibility?: 0 | 1;
  region: REGIONS;
  category?: string;
  geoip: [number, number] | null;
  active_hours?: number;
  last_online?: number;
  is_valve?: 0 | 1;
}

export interface HydratedServerInfo {
  ip: string;
  steamid: string;
  server: string;
  name: string;
  map: string;
  keywords?: string;
  players: number;
  maxPlayers: number;
  bots: number;
  visibility: number;
  region: REGIONS;
  category?: string;
  geoip: [number, number] | null;
  active_hours?: number;
  last_online?: number;
  is_valve?: 0 | 1;
}

export interface SteamWebApiServerInfo {
  addr: string;
  gameport: number;
  steamid: string;
  name: string;
  appid: number;
  gamedir: string;
  version: string;
  product: string;
  region: number;
  players: number;
  max_players: number;
  bots: number;
  map: string;
  secure: boolean;
  dedicated: boolean;
  os: string;
  gametype: string;

  // my custom stuff
  geoip: [number, number] | null;
  visibility?: 0 | 1;
}

export function steamWebApiServerInfoToLegacy(
  servers: SteamWebApiServerInfo[],
) {
  return servers.map(
    (server): HydratedServerInfo => ({
      ip: server.addr,
      steamid: server.steamid,
      server: server.addr,
      name: server.name,
      map: server.map,
      keywords: server.gametype,
      region: server.region,
      bots: server.bots,
      players: server.players + server.bots,
      maxPlayers: server.max_players,
      visibility: server.visibility ?? 0,
      geoip: server.geoip,
    }),
  );
}

export type ServerInfo = UnhydratedServerInfo | HydratedServerInfo;

export type Brand<T, B> = T & { __brand: B };
export type SteamId = Brand<string, "steamid">;
