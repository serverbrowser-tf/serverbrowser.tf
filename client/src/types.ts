import type { publicCategories } from "./utils";

export enum REGIONS {
  "US East" = 0,
  "US West" = 1,
  "South America" = 2,
  "Europe" = 3,
  "Asia" = 4,
  "Australia" = 5,
  "Middle East" = 6,
  "Africa" = 7,
}

interface HydratedServerInfo {
  ip: string;
  steamid?: string;
  server: string;
  name: string;
  map: string;
  keywords?: string;
  players: number;
  maxPlayers: number;
  bots: number;
  visibility: number;
  regions: number;
  region: number;
  geoip: [number, number] | null;
  active_hours?: number;
  category?: keyof typeof publicCategories;
  is_valve?: 0 | 1;
}

interface UnhydratedServerInfo {
  ip: string;
  steamid?: string;
  server: string;
  name: string;
  map?: undefined;
  keywords?: string;
  players: number;
  maxPlayers: number;
  bots?: undefined;
  visibility: number;
  regions: number;
  region: number;
  geoip: [number, number] | null;
  active_hours?: number;
  category?: keyof typeof publicCategories;
  is_valve?: 0 | 1;
}

export type ServerInfo = HydratedServerInfo | UnhydratedServerInfo;
