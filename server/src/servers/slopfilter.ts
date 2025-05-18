import { HydratedServerInfo, ServerInfo } from "../types";
import { partition } from "lodash";

// slop filtering is split up into two restriction types. Previously
// whitelisted servers can mostly do whatever they want. But this led to some
// complaints that whitelisted servers who mostly play stock gamemodes
// sometimes times play shit like vsh.
// Now the new method has two layers of filters. one layer "super" applies to
// all servers regardless of whitelist status or not, and the other more
// restrictive set that applies to only non-whitelisted servers.

const superFilterList = [
  "saxton",
  "vsh",
  "class wars",
  "x10",
  "x-1",
  "zombie",
  "slender",
  "one thousand uncles",
  /prop.?hunt/,
  "randomizer",
  /facti13/i,
];
const filterList = [
  ...superFilterList,
  "engineer",
  // lazypurple's tdm server has nocap and nointel
  /no.?cart/,
  /no.?cap/,
  /no.?intel/,
  // there's a bunch of servers that have these in their tags but they're legit
  // vanilla servers
  "achievement",
  "trade",
  "idle",
  // there's a bunch of servers that say what map they're on
  "badwater",
  /2f[oa]rt/,
  "harvest",
  "turbine",
  "dustbowl",
  "doublecross",
  /high(?:er)?.?tower/,
  /mario ?kart/,
];
type IFilterList = typeof filterList;
const superFilterMapList = [
  "achievement_",
  "ba_",
  "bhop_",
  "boss_",
  "climb_",
  "conc",
  "cp_orange",
  "dr_",
  "duel_",
  "gg_",
  "jail_",
  "jb_",
  "jump_",
  "kz_",
  "mge_",
  "mvm_",
  "par_",
  "pf_",
  "rf2_",
  "rj_",
  "rpg_",
  "sb_",
  "slender_",
  "surf_",
  "td_",
  "tfdb_",
  "tr_",
  "trade",
  "vsh_",
  "ze_",
  "zm_",
  "zr_",
  "zs_",

  // I kinda don't like having tf2ware in the "super" filter list. I feel like
  // if a random server wants to have a wacky gamemode night they should still
  // be in vanilla. In the grand scheme of things tf2ware isn't that different
  // than koth_trainsawlaser or koth_wubwubwub. But if I have to be consistent
  // with the way I curate servers I have to keep this here
  "tf2ware",
  "warioware",
];
const filterMapList = [
  ...superFilterMapList,
  // this is kinda pushing it but the more I think about it. passtime is just
  // ctf_haarp
  "pass_",

  // also kinda pushing it. might remove.. I don't have a reason outside of
  // "dm_mariokart" obviously belongs in vanilla. such a tf2 staple... but also
  // no objective which makes it not vanilla
  "dm_",
];
type IFilterMapList = typeof filterMapList;

function cleanupString(str: string | undefined) {
  if (!str) {
    return "";
  }
  str = str.replaceAll("\u0001", "");
  str = str.replaceAll("█", "");
  return str;
}

export function cleanupServerInfo(servers: HydratedServerInfo[]) {
  for (const server of servers) {
    server.name = cleanupString(server.name);
    server.keywords = cleanupString(server.keywords);
  }
}

function serverPassesFilters(
  server: ServerInfo,
  mapList: IFilterMapList,
  filterList: IFilterList,
) {
  for (const mapPrefix of mapList) {
    if (server.map?.toLowerCase().startsWith(mapPrefix)) {
      if (server.name?.includes("TDM")) console.trace(server, mapPrefix);
      return false;
    }
  }

  for (const filterStr of filterList) {
    if (typeof filterStr === "string") {
      if (server.name.toLowerCase().includes(filterStr)) {
        if (server.name?.includes("TDM")) console.trace(server, filterStr);
        return false;
      } else if (server.keywords?.toLowerCase().includes(filterStr)) {
        if (server.name?.includes("TDM")) console.trace(server, filterStr);
        return false;
      }
    } else {
      if (filterStr.test(server.name.toLowerCase())) {
        if (server.name?.includes("TDM")) console.trace(server, filterStr);
        return false;
      } else if (filterStr.test(server.keywords?.toLowerCase() ?? "")) {
        if (server.name?.includes("TDM")) console.trace(server, filterStr);
        return false;
      }
    }
  }

  return true;
}

export function isServerNormal(server: ServerInfo) {
  return serverPassesFilters(server, filterMapList, filterList);
}
export function isServerSuperNormal(server: ServerInfo) {
  return serverPassesFilters(server, superFilterMapList, superFilterList);
}
