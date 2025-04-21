import { ServerInfo } from "./types.ts";
import { useEffect, useState } from "react";
import { getLocalStorageItem, setLocalStorageItem } from "./useLocalStorage.ts";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();

export class Atom<T> extends EventTarget {
  constructor(protected _value: T) {
    super();
  }

  onchange?: (event: Event) => void;

  get value() {
    return this._value;
  }

  set value(newValue: T) {
    if (Object.is(this._value, newValue)) {
      return;
    }

    this._value = newValue;

    const changeEvent = new Event("change");
    this.dispatchEvent(changeEvent);
    this.onchange?.(changeEvent);
  }
}

export const useAtom = <T>(atom: Atom<T>) => {
  const [state, setState] = useState(atom.value);
  useEffect(() => {
    setState(atom.value);
    const onchange = () => {
      setState(atom.value);
    };
    atom.addEventListener("change", onchange);
    return () => atom.removeEventListener("change", onchange);
  }, [atom]);

  return state;
};

export function assert(x: any): asserts x {
  if (x === false) {
    throw new Error("Assertion Error");
  }
}

export const banAtom = new Atom<ServerInfo | undefined>(undefined);

function isAuthorizied() {
  return document.cookie
    .split(";")
    .some((cookie) => cookie.trim().startsWith("authorizedkey="));
}

export const loggedInAtom = new Atom<boolean>(isAuthorizied());

loggedInAtom.addEventListener("change", () => {
  if (!loggedInAtom) {
    banAtom.value = undefined;
    window.location.assign("/#/login");
  }
});

export const checkLogin = () => {
  return (loggedInAtom.value = isAuthorizied());
};

export const logout = () => {
  document.cookie = "authorizedkey=;expires=Thu, 01 Jan 1970 00:00:01 GMT";
  loggedInAtom.value = false;
};

export const officialMaps = new Set([
  "ctf_2fort",
  "ctf_2fort_invasion",
  "ctf_applejack",
  "ctf_doublecross",
  "ctf_frosty",
  "ctf_landfall",
  "ctf_pelican_peak",
  "ctf_sawmill",
  "ctf_turbine",
  "ctf_well",
  "cp_5gorge",
  "cp_badlands",
  "cp_canaveral_5cp",
  "cp_coldfront",
  "cp_fastlane",
  "cp_foundry",
  "cp_freight_final1",
  "cp_granary",
  "cp_gullywash_final1",
  "cp_metalworks",
  "cp_powerhouse",
  "cp_process_final",
  "cp_reckoner",
  "cp_snakewater_final1",
  "cp_sunshine",
  "cp_vanguard",
  "cp_well",
  "cp_yukon_final",
  "cp_altitude",
  "cp_brew",
  "cp_dustbowl",
  "cp_egypt_final",
  "cp_gorge",
  "cp_gravelpit",
  "ctf_haarp",
  "cp_hadal",
  "cp_hardwood_final",
  "cp_junction_final",
  "cp_mercenarypark",
  "cp_mossrock",
  "cp_mountainlab",
  "cp_snowplow",
  "cp_steel",
  "cp_sulfur",
  "cp_overgrown",
  "cp_burghausen",
  "cp_degrootkeep",
  "cp_standin_final",
  "tc_hydro",
  "pl_badwater",
  "pl_barnblitz",
  "pl_borneo",
  "pl_breadspace",
  "pl_cactuscanyon",
  "pl_camber",
  "pl_cashworks",
  "pl_embargo",
  "pl_emerge",
  "pl_enclosure_final",
  "pl_frontier_final",
  "pl_goldrush",
  "pl_hoodoo_final",
  "pl_odyssey",
  "pl_patagonia",
  "pl_phoenix",
  "pl_pier",
  "pl_rumford_event",
  "pl_snowycoast",
  "pl_swiftwater_final1",
  "pl_thundermountain",
  "pl_upward",
  "pl_venice",
  "plr_bananabay",
  "plr_hacksaw",
  "plr_hightower",
  "plr_nightfall_final",
  "plr_pipeline",
  "arena_badlands",
  "arena_byre",
  "arena_granary",
  "arena_lumberyard",
  "arena_nucleus",
  "arena_offblast_final",
  "arena_ravine",
  "arena_sawmill",
  "arena_watchtower",
  "arena_well",
  "koth_badlands",
  "koth_brazil",
  "koth_cachoeira",
  "koth_cascade",
  "koth_harvest_final",
  "koth_highpass",
  "koth_king",
  "koth_lakeside_final",
  "koth_lazarus",
  "koth_megaton",
  "koth_nucleus",
  "koth_probed",
  "koth_rotunda",
  "koth_sawmill",
  "koth_sharkbay",
  "koth_snowtower",
  "koth_suijin",
  "koth_viaduct",
  "sd_doomsday",
  "tr_dustbowl",
  "tr_target",
  "itemtest",
  "cp_cloak",
  "mvm_bigrock",
  "mvm_coaltown",
  "mvm_decoy",
  "mvm_example",
  "mvm_mannhattan",
  "mvm_mannworks",
  "mvm_rottenburg",
  "rd_asteroid",
  "ctf_foundry",
  "ctf_gorge",
  "ctf_hellfire",
  "ctf_thundermountain",
  "pass_brickyard",
  "pass_district",
  "pass_timbertown",
  "pd_atom_smash",
  "pd_selbyen",
  "pd_watergate",
  "vsh_distillery",
  "vsh_nucleus",
  "vsh_skirmish",
  "vsh_tinyrock",

  // halloween maps
  "koth_harvest_event",
  "cp_manor_event",
  "koth_viaduct_event",
  "koth_lakeside_event",
  "mvm_ghost_town",
  "plr_hightower_event",
  "sd_doomsday_event",
  "cp_gorge_event",
  "pl_millstone_event",
  "koth_moonshine_event",
  "cp_sunshine_event",
  "pl_fifthcurve_event",
  "koth_maple_ridge_event",
  "pd_pit_of_death_event",
  "koth_bagel_event",
  "pd_cursed_cove_event",
  "pl_rumble_event",
  "pd_monster_bash",
  "koth_slasher",
  "koth_slaughter_event",
  "pl_precipice_event_final",
  "pl_bloodwater",
  "pl_hasslecastle",
  "koth_megalo",
  "koth_undergrove_event",
  "cp_ambush_event",
  "pd_farmageddon",
  "arena_lumberyard_event",
  "koth_los_muertos",
  "koth_synthetic_event",
  "pl_terror_event",
  "plr_hacksaw_event",
  "ctf_crasher",
  "pl_sludgepit_event",
  "ctf_helltrain_event",
  "koth_sawmill_event",
  "cp_spookeyridge",
  "zi_atoll",
  "pl_corruption",
  "zi_devastation_final1",
  "cp_lavapit_final",
  "pd_mannsylvania",
  "zi_murky",
  "arena_perks",
  "cp_degrootkeep_rats",
  "zi_sanitarium",
  "koth_slime",
  "pl_spineyard",
  "zi_woods",
  "zi_blazehattan",
  "pd_circus",
  "cp_darkmarsh",
  "tow_dynamite",
  "cp_freaky_fair",
  "vsh_outburst",
  "koth_toxic",

  // smissmas
  "ctf_snowfall_final",
  "pd_snowville_event",
  "pl_wutville_event",
  "pl_chilly",
  "ctf_doublecross_snowy",
  "pl_coal_event",
  "cp_gravelpit_snowy",
  "pl_frostcliff",
  "cp_frostwatch",
  "cp_carrier",
  "pd_galleria",
  "koth_krampus",
  "ctf_turbine_winter",
  "plr_cutter",
  "cp_fortezza",
  "vsh_maul",
  "koth_overcast_final",
  "ctf_penguin_peak",
]);

export const geoIpAtom = new Atom<[number, number] | null | undefined>(
  undefined,
);

export const favoritesAtom = new Atom<string[]>(
  getLocalStorageItem("favorites", []),
);
export const blacklistAtom = new Atom<string[]>(
  getLocalStorageItem("blacklist", []),
);

window.addEventListener("storage", (e) => {
  if (e.key === "favorites" && e.newValue != null) {
    favoritesAtom.value = JSON.parse(e.newValue);
  }
  if (e.key === "blacklist" && e.newValue != null) {
    blacklistAtom.value = JSON.parse(e.newValue);
  }
});

favoritesAtom.addEventListener("change", () => {
  queryClient.invalidateQueries({
    queryKey: ["filtered", "favorites"],
  });
});

blacklistAtom.addEventListener("change", () => {
  queryClient.invalidateQueries({
    queryKey: ["filtered", "blacklist"],
  });
});

export const favoriteServer = (ip: string) => {
  const favorites = getLocalStorageItem("favorites", () => [
    ...favoritesAtom.value,
  ]);
  if (favorites.includes(ip)) {
    return;
  }
  favoritesAtom.value = [...favorites, ip];
  setLocalStorageItem("favorites", favoritesAtom.value);
};

export const removeFromFavorites = (ip: string) => {
  const favorites = getLocalStorageItem("favorites", () => [
    ...favoritesAtom.value,
  ]);
  favoritesAtom.value = favorites.filter((el) => el !== ip);
  setLocalStorageItem("favorites", favoritesAtom.value);
};

export const blacklistServer = (ip: string) => {
  const blacklist = getLocalStorageItem("blacklist", () => [
    ...blacklistAtom.value,
  ]);
  if (blacklist.includes(ip)) {
    return;
  }
  blacklistAtom.value = [...blacklist, ip];
  setLocalStorageItem("blacklist", blacklistAtom.value);
};

export const removeFromBlacklist = (ip: string) => {
  const blacklist = getLocalStorageItem("blacklist", () => [
    ...blacklistAtom.value,
  ]);
  blacklistAtom.value = blacklist.filter((el) => el !== ip);
  setLocalStorageItem("blacklist", blacklistAtom.value);
};
