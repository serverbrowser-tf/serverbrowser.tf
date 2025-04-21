import { HydratedServerInfo, ServerInfo } from "../types";
import { partition } from "lodash";

const filterList = [
  "achievement",
  "trade",
  "idle",
  "saxton",
  "vsh",
  "class wars",
  "x10",
  "x-1",
  "zombie",
  "slender",
  "engineer",
  "one thousand uncles",
  "badwater",
  /2f[oa]rt/,
  "harvest",
  "turbine",
  "dustbowl",
  "doublecross",
  /high(?:er)?.?tower/,
  /no.?cart/,
  /prop.?hunt/,
  "randomizer",
  /mario ?kart/,
];
const mapList = [
  "achievement_",
  "trade",
  "vsh_",
  "jump_",
  "rj_",
  "kz_",
  "conc",
  "climb_",
  "bhop_",
  "mvm_",
  "tr_",
  "surf_",
  "mge_",
  "par_",
  "pf_",
  "zm_",
  "ze_",
  "zr_",
  "zs_",
  "dr_",
  "jb_",
  "ba_",
  "sb_",
  "gg_",
  "jail_",
  "tfdb_",
  "boss_",
  "slender_",
  "td_",
  "rpg_",
  "rf2_",
  "dm_",
  "duel_",
  "climb_",
  "cp_orange",
  "tf2ware",
  "warioware",
];

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

export function isServerNormal(server: ServerInfo) {
  for (const mapPrefix of mapList) {
    if (server.map?.toLowerCase().startsWith(mapPrefix)) {
      return false;
    }
  }

  for (const filterStr of filterList) {
    if (typeof filterStr === "string") {
      if (server.name.toLowerCase().includes(filterStr)) {
        return false;
      } else if (server.keywords?.toLowerCase().includes(filterStr)) {
        return false;
      }
    } else {
      if (filterStr.test(server.name.toLowerCase())) {
        return false;
      } else if (filterStr.test(server.keywords?.toLowerCase() ?? "")) {
        return false;
      }
    }
  }

  return true;
}
export function slopFilter(servers: HydratedServerInfo[]) {
  return partition(servers, (server) => {
    return isServerNormal(server);
  });
}

// async function main() {
//   const json = await fs.readFile("./servers.json");
//   const parsed = JSON.parse(json.toString('utf8'));
//   parsed.map(server => {
//     server.regions = new Set(server.regions);
//   })
//   slopFilter(parsed);
// }
// main();
