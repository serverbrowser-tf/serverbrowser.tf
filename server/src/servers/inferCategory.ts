import { ServerInfo } from "../types";

export function inferServerCategory(
  server: Pick<ServerInfo, "map" | "name" | "keywords">,
): string | undefined {
  const map = server.map?.toLowerCase() ?? "";
  const [prefix] = map.split("_");
  const name = server.name.toLowerCase();
  const keywords = (server.keywords ?? "").toLowerCase();
  const hasText = (value: string) =>
    name.includes(value) || keywords.includes(value);
  const hasPattern = (pattern: RegExp) =>
    pattern.test(name) || pattern.test(keywords);

  if (name.includes("serveme.tf")) {
    return "comp";
  }

  if (
    ["achievement", "trade", "idle", "gm", "oot3d", "walmart"].some(
      (key) => prefix.includes(key) || keywords.includes(key),
    ) ||
    hasPattern(/facti13/i)
  ) {
    return "social";
  }

  if (
    prefix === "mge" ||
    name.includes("soapdm") ||
    prefix === "dm" ||
    name.includes("duel") ||
    keywords.includes("soapdm")
  ) {
    return "dm";
  }

  if (["conc", "climb", "jump", "rj", "kz", "bhop", "surf"].includes(prefix)) {
    return "jump/surf";
  }

  if (prefix === "mvm") {
    return "mvm";
  }

  if (
    map.startsWith("z") ||
    [
      "ba",
      "boss",
      "dr",
      "gg",
      "jail",
      "jb",
      "par",
      "pass",
      "pf",
      "rf2",
      "rpg",
      "sb",
      "sn",
      "sniper",
      "slender",
      "td",
      "tfdb",
      "vsh",
      "ze",
      "zm",
      "zr",
      "zs",
      "tf2ware",
      "warioware",
    ].includes(prefix) ||
    hasText("saxton") ||
    hasText("class wars") ||
    hasText("zombie") ||
    hasText("randomizer") ||
    hasText("engineer") ||
    name.includes("prop") ||
    name.includes("one thousand uncle") ||
    name.includes("x10") ||
    name.includes("x5") ||
    name.includes("x-1")
  ) {
    return "gamemode";
  }

  if (
    hasText("badwater") ||
    hasText("harvest") ||
    hasText("doublecross") ||
    hasText("turbine") ||
    hasText("dustbowl") ||
    hasPattern(/2f[oa]rt/) ||
    hasPattern(/high(?:er)?.?tower/) ||
    hasPattern(/mario ?kart/) ||
    hasPattern(/no.?cart/) ||
    hasPattern(/no.?cap/) ||
    hasPattern(/no.?intel/) ||
    map.startsWith("cp_orange")
  ) {
    return "24/7";
  }

  if (prefix === "tr") {
    return "other";
  }

  if (prefix === "conc" || prefix === "climb") {
    return "jump/surf";
  }

  if (map === "nothing") {
    return "fake players";
  }

  return undefined;
}
