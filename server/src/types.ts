import { REGIONS } from "steam-server-query";

export interface UnhydratedServerInfo {
  ip: string;
  server: string;
  name: string;
  map?: string;
  keywords?: string;
  players?: number;
  maxPlayers?: number;
  hours?: number;
  bots?: undefined;
  visibility?: 0 | 1;
  regions: REGIONS;
  region: REGIONS;
  category?: string;
  geoip: [number, number] | null;
  active_hours?: number;
}

export interface HydratedServerInfo {
  ip: string;
  server: string;
  name: string;
  map: string;
  keywords?: string;
  players: number;
  maxPlayers: number;
  bots: number;
  visibility: number;
  regions: REGIONS;
  region: REGIONS;
  category?: string;
  geoip: [number, number] | null;
  active_hours?: number;
}

export type ServerInfo = UnhydratedServerInfo | HydratedServerInfo;
