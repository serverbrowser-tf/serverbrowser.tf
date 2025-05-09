import React, {
  Dispatch,
  SetStateAction,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DataGrid,
  Column,
  SortColumn,
  renderHeaderCell,
} from "react-data-grid";
import "./App.css";
import { useQuery } from "@tanstack/react-query";
import { useLocalStorage } from "./useLocalStorage.ts";
import Fuse from "fuse.js";
import {
  api,
  apiRoute,
  calculateLongLatDistance,
  clamp,
  getPingScore,
  getPlayerScore,
  lerp,
  useGeoIp,
} from "./utils.ts";
import { REGIONS, ServerInfo } from "./types.ts";
import {
  Atom,
  useAtom,
  assert,
  banAtom,
  loggedInAtom,
  officialMaps,
  blacklistAtom,
  favoritesAtom,
  removeFromFavorites,
  favoriteServer,
  removeFromBlacklist,
  blacklistServer,
} from "./globals.ts";
import { BanModal } from "./BanModal.tsx";
import { ServerDetail } from "./ServerDetail.tsx";
import { ContextMenu, ContextMenuOption } from "./ContextMenu.tsx";
import { currentSearch, currentTabAtom, TabsHeader } from "./TabsHeader.tsx";
import { useNavigate, useParams } from "react-router";
import { Modal } from "./Modal.tsx";
import { ServerPage } from "./ServerPage.tsx";

const expandedRowsAtom = new Atom(new Set<string>());

type MasterRowData = ServerInfo & {
  type: "MASTER";
  ping: number | null;
};

interface DetailRowData {
  type: "DETAIL";
  row: MasterRowData;
}

type RowData = MasterRowData | DetailRowData;

const cols: Column<RowData>[] = [
  {
    key: "ip",
    name: "Server",
    width: 220,
    cellClass(thing) {
      if (thing.type === "DETAIL") {
        return "detail-row";
      }

      return "server-cell";
    },
    colSpan(args) {
      if (args.type === "ROW" && args.row.type === "DETAIL") {
        let length = cols.length;
        if (loggedInAtom.value) {
          length += adminColumns.length;
        }
        return length;
      }
      return undefined;
    },
    renderCell(thing) {
      if (thing.row.type === "DETAIL") {
        return <ServerDetail ip={thing.row.row.ip} minimal />;
      }
      return (
        <>
          <button
            className="expander"
            onClick={(e) => {
              const caret = e.currentTarget.children[0];
              if (thing.row.type === "MASTER") {
                const clone = new Set(expandedRowsAtom.value);
                if (clone.has(thing.row.ip)) {
                  clone.delete(thing.row.ip);
                  caret.classList.remove("active");
                } else {
                  clone.add(thing.row.ip);
                  caret.classList.add("active");
                }
                expandedRowsAtom.value = clone;
              }
            }}
          >
            <div className="caret" />
          </button>
          <span style={{ display: "inline-block", width: 32 }}>
            {thing.row.visibility ? "🔒" : ""}
          </span>
          <a href={`steam://connect/${thing.row.ip}`}>{thing.row.ip}</a>
        </>
      );
    },
  },
  {
    key: "name",
    name: "Name",
    minWidth: 400,
  },
  {
    key: "map",
    name: "Map",
    minWidth: 200,
  },
  {
    key: "active_hours",
    name: "Active Hours",
    sortDescendingFirst: true,
    width: 120,
    renderHeaderCell(props) {
      return (
        <span title="How many hours in the past month did the server have more than 10 players">
          {renderHeaderCell(props)}
        </span>
      );
    },
  },
  {
    key: "players",
    name: "Players",
    width: 80,
    sortDescendingFirst: true,
    renderCell(thing) {
      if (thing.row.type === "MASTER") {
        let players = (thing.row.players ?? 0) - (thing.row.bots ?? 0);
        let maxPlayers = thing.row.maxPlayers ?? 0;
        return `${players}/${maxPlayers}`;
      }
      return "";
    },
  },
  {
    key: "bots",
    name: "Bots",
    sortDescendingFirst: true,
    width: 80,
  },
  {
    key: "region",
    name: "Region",
    width: 120,
    renderCell(thing) {
      if (thing.row.type === "MASTER") {
        return REGIONS[thing.row.region] ?? "";
      }
    },
  },
  {
    key: "keywords",
    name: "",
    width: 300,
    renderCell(thing) {
      if (thing.row.type === "MASTER") {
        return <span title={thing.row.keywords}>{thing.row.keywords}</span>;
      }
    },
  },
];

const adminColumns: Column<RowData>[] = [
  {
    key: "_",
    name: "",
    width: 60,
    renderCell(thing) {
      return (
        <button
          type="button"
          onClick={() => {
            if (thing.row.type === "MASTER") {
              banAtom.value = thing.row;
            }
          }}
        >
          Ban
        </button>
      );
    },
  },
];

function defaultComparator(a: MasterRowData, b: MasterRowData) {
  const getScore = (val: MasterRowData) => {
    const playerCount = val.players - (val.bots ?? 0);
    let score = getPlayerScore(playerCount) * 3;

    const activeHours = val.active_hours ?? 0;

    if (val.ping != null) {
      const pingScore = getPingScore(val.ping);
      score += pingScore * 2;
    }

    const isKogasatopia =
      val.keywords != null &&
      (val.keywords.includes("bant") || val.keywords.includes("touhou"));

    const isLargeNetwork = val.name.startsWith("Uncletopia") && !isKogasatopia;
    if (!isLargeNetwork) {
      score += lerp(0.5, 0, clamp(activeHours / 400, 0, 1));
    }

    if (val.visibility) {
      score -= 1.5;
    }

    return score;
  };

  return getScore(b) - getScore(a);
}

function comparator(
  a: MasterRowData,
  b: MasterRowData,
  key: keyof MasterRowData,
  direction: "ASC" | "DESC",
) {
  if (a[key] == null || b[key] == null) {
    return Number(b[key] != null) - Number(a[key] != null);
  }
  const multiplier = direction === "ASC" ? 1 : -1;
  if (key === "ip") {
    const [ipStrA, portA] = a.ip.split(":");
    const [ipStrB, portB] = b.ip.split(":");

    const ipA = ipStrA.split(".").map(Number);
    const ipB = ipStrB.split(".").map(Number);

    // Compare IP segments first
    for (let i = 0; i < 4; i++) {
      if (ipA[i] !== ipB[i]) {
        return (ipA[i] - ipB[i]) * multiplier;
      }
    }

    // If IPs are equal, compare ports
    return (Number(portA) - Number(portB)) * multiplier;
  } else if (key === "players") {
    assert(a.players != null);
    assert(b.players != null);
    const left = a.players - (a.bots ?? 0);
    const right = b.players - (b.bots ?? 0);

    return (left - right) * multiplier;
  }
  const left = a[key];
  const right = b[key];
  if (left < right) {
    return -1 * multiplier;
  }
  if (left > right) {
    return 1 * multiplier;
  }
  return 0;
}

function rowKeyGetter(data: RowData) {
  if (data.type === "MASTER") {
    return data.ip;
  }
  return `detail_${data.row.ip}`;
}

const GAMEMODES = [
  "Arena",
  "Capture the Flag",
  "Control Points",
  "King of the Hill",
  "Payload",
  "Player/Robot Destruction",
  "Special Delivery",
  "Other",
] as const;

function App() {
  const [category, setCategory] = useLocalStorage("category", "vanilla");
  const [latency, setLatency] = useLocalStorage("latency", "");
  const [region, setRegion] = useLocalStorage("region", "All");
  const [hasUsersPlaying, setHasUsersPlaying] = useLocalStorage(
    "has-users-playing",
    true,
  );
  const [filterPasswordProtected, setFilterPasswordProtected] = useLocalStorage(
    "password-protected",
    false,
  );
  const [vanillaMaps, setVanillaMaps] = useLocalStorage("vanilla-maps", false);
  const [customMaps, setCustomMaps] = useLocalStorage("custom-maps", false);
  const [maxPlayerCount, setMaxPlayerCount] = useLocalStorage<null | number>(
    "max-player-count",
    null,
  );
  const [notFull, setNotFull] = useLocalStorage("not-full", false);
  const [map, setMap] = useState("");
  const [mustIncludeTagsRaw, setMustIncludeTags] = useLocalStorage(
    "must-include-tags",
    "",
  );
  const [mustNotIncludeTagsRaw, setMustNotIncludeTags] = useLocalStorage(
    "must-not-include-tags",
    "",
  );
  const [gamemodeFilters, setGamemodeFilters] = useLocalStorage<
    Partial<Record<(typeof GAMEMODES)[number], boolean>>
  >("gamemode-prefixes", {});
  const mustIncludeTags = useDeferredValue(mustIncludeTagsRaw);
  const mustNotIncludeTags = useDeferredValue(mustNotIncludeTagsRaw);
  const [sortColumns, setSortColumns] = useLocalStorage<readonly SortColumn[]>(
    "sort",
    [],
  );
  const [selectedRow, setSelectedRow] = useState<Set<string>>();
  const [contextMenuProps, setContextMenuProps] = useState<{
    x: number;
    y: number;
    row: MasterRowData;
  }>();
  const tabOpen = useAtom(currentTabAtom);
  const search = useAtom(currentSearch);
  const isLoggedIn = useAtom(loggedInAtom);
  const serverToBan = useAtom(banAtom);
  const expandedRows = useAtom(expandedRowsAtom);
  const favorites = useAtom(favoritesAtom);
  const blacklist = useAtom(blacklistAtom);
  const geoIp = useGeoIp();
  const navigate = useNavigate();
  const params = useParams();
  const modalIp = params.ip;

  let queryKey = ["filtered", category, region, hasUsersPlaying, tabOpen];
  if (tabOpen === "favorites") {
    queryKey = ["filtered", "favorites"];
  } else if (tabOpen === "blacklist") {
    queryKey = ["filtered", "blacklist"];
  }

  const { error, data, refetch } = useQuery<ServerInfo[]>({
    queryKey,
    queryFn: async ({ signal }) => {
      let url: URL;
      if (tabOpen === "admin") {
        url = new URL(
          `${apiRoute}/api/servers.json/admin-view`,
          window.location.toString(),
        );
      } else if (tabOpen === "favorites") {
        if (favoritesAtom.value.length === 0) {
          return [];
        }
        url = new URL(`${apiRoute}/api/servers`, window.location.toString());
        url.searchParams.set("ip", favoritesAtom.value.join(","));
      } else if (tabOpen === "blacklist") {
        if (blacklistAtom.value.length === 0) {
          return [];
        }
        url = new URL(`${apiRoute}/api/servers`, window.location.toString());
        url.searchParams.set("ip", blacklistAtom.value.join(","));
      } else {
        url = new URL(
          `${apiRoute}/api/servers/all`,
          window.location.toString(),
        );
        url.searchParams.set(
          "hasUsersPlaying",
          String(Number(hasUsersPlaying)),
        );
        if (region !== "All") {
          switch (region) {
            case "Africa":
              url.searchParams.append("region", String(REGIONS.Africa));
              break;
            case "Asia":
              url.searchParams.append("region", String(REGIONS.Asia));
              break;
            case "Australia":
              url.searchParams.append("region", String(REGIONS.Australia));
              break;
            case "Europe":
              url.searchParams.append("region", String(REGIONS.Europe));
              break;
            case "Middle East":
              url.searchParams.append("region", String(REGIONS["Middle East"]));
              break;
            case "North America":
              url.searchParams.append("region", String(REGIONS["US East"]));
              url.searchParams.append("region", String(REGIONS["US West"]));
              break;
            case "South America":
              url.searchParams.append(
                "region",
                String(REGIONS["South America"]),
              );
              break;
            default:
              console.error("Unknown region", region);
          }
        }
        url.searchParams.set("category", category);
      }
      return await api<ServerInfo[]>(url.toString(), {
        signal,
      });
    },
    retry: true,
    retryDelay: 1000,
    refetchInterval: 1000 * 10,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (serverToBan == null && isLoggedIn) {
      refetch();
    }
  }, [serverToBan, isLoggedIn, refetch]);

  const sortedRows = useMemo((): RowData[] => {
    if (data == null) {
      return [];
    }

    const masterRows = data.map((record): MasterRowData => {
      let ping: number | null = null;
      if (record.geoip && geoIp) {
        const distance = calculateLongLatDistance(record.geoip, geoIp);
        ping = Math.max(5, Math.round((distance / 100) * 4));
      }
      return {
        type: "MASTER",
        ...record,
        ping,
      };
    });
    let copy = masterRows;
    if (latency) {
      const latencyInt = Number(latency);
      copy = copy.filter((server) => server.ping && server.ping < latencyInt);
    }
    if (map) {
      copy = copy.filter((server) => server.map?.includes(map));
    }
    if (vanillaMaps) {
      copy = copy.filter((server) => {
        return officialMaps.has(server.map!);
      });
    }
    if (customMaps) {
      copy = copy.filter((server) => {
        const value = officialMaps.has(server.map!);
        return !value;
      });
    }
    if (filterPasswordProtected) {
      copy = copy.filter((server) => server.visibility === 0);
    }
    if (mustIncludeTags || mustNotIncludeTags) {
      copy = copy.filter((server) => {
        const keywords = server.keywords ?? "";
        if (mustIncludeTags) {
          for (let tag of mustIncludeTags.split(",")) {
            tag = tag.trim();
            if (tag === "") {
              continue;
            }
            if (!keywords.includes(tag)) {
              return false;
            }
          }
        }
        if (mustNotIncludeTags) {
          for (let tag of mustNotIncludeTags.split(",")) {
            tag = tag.trim();
            if (tag === "") {
              continue;
            }
            if (keywords.includes(tag)) {
              return false;
            }
          }
        }
        return true;
      });
    }
    if (notFull) {
      copy = copy.filter((server) => {
        if (server.players == null) {
          return true;
        }
        const actualPlayers = server.players - (server.bots ?? 0);
        return actualPlayers < server.maxPlayers;
      });
    }
    if (maxPlayerCount != null) {
      copy = copy.filter((server) => {
        return server.maxPlayers <= maxPlayerCount;
      });
    }
    if (search) {
      const fuse = new Fuse(copy, {
        shouldSort: false,
        // includeScore: true,
        threshold: 0.3,
        keys: ["ip", "name", "map", "keywords"],
      });
      const searched = fuse.search(search);
      copy = searched.map((searchResult) => searchResult.item);
    }

    if (tabOpen === "favorites" || tabOpen === "blacklist") {
      if (hasUsersPlaying) {
        copy = copy.filter((server) => {
          const players = (server.players ?? 0) - (server.bots ?? 0);
          return players !== 0;
        });
      }
    } else if (blacklist.length) {
      const blacklistIps = new Set(blacklist);
      copy = copy.filter((server) => !blacklistIps.has(server.ip));
    }

    if (sortColumns.length) {
      copy.sort((a, b) => {
        for (const sort of sortColumns) {
          const compared = comparator(
            a,
            b,
            sort.columnKey as keyof MasterRowData,
            sort.direction,
          );
          if (compared !== 0) {
            return compared;
          }
        }
        return 0;
      });
    } else {
      copy.sort((a, b) => {
        return defaultComparator(a, b);
      });
    }
    return copy;
  }, [
    maxPlayerCount,
    tabOpen,
    data,
    map,
    latency,
    blacklist,
    geoIp,
    search,
    notFull,
    sortColumns,
    vanillaMaps,
    customMaps,
    hasUsersPlaying,
    mustIncludeTags,
    mustNotIncludeTags,
    filterPasswordProtected,
  ]);

  const rowData = useMemo(() => {
    const copy: RowData[] = [...sortedRows];

    for (let i = 0; i < copy.length; i++) {
      const row = copy[i];
      if (row.type === "MASTER" && expandedRows.has(row.ip)) {
        i += 1;
        copy.splice(i, 0, {
          type: "DETAIL",
          row,
        });
      }
    }

    return copy;
  }, [sortedRows, expandedRows]);

  const actualCols = useMemo(() => {
    const copy = [...cols];
    copy[0] = {
      ...copy[0],
      name: `Servers (${sortedRows.length})`,
    };
    if (geoIp) {
      for (let i = 0; i < copy.length; i++) {
        if (copy[i].key === "region") {
          copy[i] = {
            key: "ping",
            name: "Ping",
            width: 60,
            renderCell(thing) {
              if (thing.row.type === "MASTER" && thing.row.ping) {
                return (
                  <span title="Ping is only an estimate!">
                    {String(thing.row.ping)}
                  </span>
                );
              }
              return "";
            },
          };
        }
      }
    }
    if (isLoggedIn) {
      copy.push(...adminColumns);

      if (tabOpen === "admin") {
        copy.push({
          key: "hours",
          name: "",
        });
      }
    }
    return copy;
  }, [sortedRows.length, isLoggedIn, tabOpen, geoIp]);

  const setSpecificTag = (
    dispatch: Dispatch<SetStateAction<string>>,
    tagToAdd: string,
  ) => {
    // remove it and then re-add it
    setMustIncludeTags((old) => {
      return (
        old
          ?.split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag && tag !== tagToAdd)
          .join(",") ?? ""
      );
    });
    setMustNotIncludeTags((old) => {
      return (
        old
          ?.split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag && tag !== tagToAdd)
          .join(",") ?? ""
      );
    });
    dispatch((old) => {
      if (old) {
        return tagToAdd + "," + old;
      }
      return tagToAdd;
    });
  };

  const contextOptions = useMemo(() => {
    if (contextMenuProps == null) {
      return [];
    }
    const { row } = contextMenuProps;
    const options: ContextMenuOption[] = [
      {
        label: "View server info",
        onClick: () => {
          switch (tabOpen) {
            case "server":
              navigate(`/servers/${row.ip}`, { replace: true });
              break;
            case "favorites":
              navigate(`/favorites/servers/${row.ip}`, { replace: true });
              break;
            case "blacklist":
              navigate(`/blacklist/servers/${row.ip}`, { replace: true });
              break;
          }
        },
      },
      {
        label: "Connect to server",
        onClick: () => {
          const a = document.createElement("a");
          a.href = `steam://connect/${row.ip}`;
          document.body.append(a);
          a.click();
          a.remove();
        },
      },
    ];

    if (tabOpen !== "blacklist") {
      if (favorites.includes(row.ip)) {
        options.push({
          label: "Remove server from favorites",
          onClick: () => {
            removeFromFavorites(row.ip);
          },
        });
      } else {
        options.push({
          label: "Add server to favorites",
          onClick: () => {
            favoriteServer(row.ip);
          },
        });
      }
    }
    if (tabOpen !== "favorites") {
      if (blacklist.includes(row.ip)) {
        options.push({
          label: "Remove server from blacklist",
          onClick: () => {
            removeFromBlacklist(row.ip);
          },
        });
      } else {
        options.push({
          label: "Add server to blacklist",
          onClick: () => {
            blacklistServer(row.ip);
          },
        });
      }
    }

    return options;
  }, [navigate, tabOpen, favorites, blacklist, contextMenuProps]);

  function getPreference(tagToCheck: string) {
    tagToCheck = tagToCheck.trim();
    const mustInclude =
      mustIncludeTagsRaw?.split(",").some((tag) => tag.trim() === tagToCheck) ??
      "";
    const mustNotInclude =
      mustNotIncludeTagsRaw
        ?.split(",")
        .some((tag) => tag.trim() === tagToCheck) ?? "";
    return {
      na: !mustInclude && !mustNotInclude,
      mustInclude: mustInclude && !mustNotInclude,
      mustNotInclude: mustNotInclude,
    };
  }

  const randomCritPreference = getPreference("nocrits");
  const allTalkPreference = getPreference("alltalk");

  if (error) {
    console.error(error);
  }

  return (
    <div className="app">
      <TabsHeader />
      <div className="grid">
        <DataGrid
          className="fill-grid"
          columns={actualCols}
          rowHeight={(row) => (row.type === "MASTER" ? 32 : 300)}
          rows={rowData}
          sortColumns={sortColumns}
          onSortColumnsChange={setSortColumns}
          rowKeyGetter={rowKeyGetter}
          selectedRows={selectedRow}
          onSelectedRowsChange={setSelectedRow}
          defaultColumnOptions={{
            sortable: true,
            resizable: true,
          }}
          onCellClick={(e) => {
            if (e.row.type === "MASTER") {
              setSelectedRow(new Set([e.row.ip]));
            }
          }}
          onCellContextMenu={(e, event) => {
            if (e.row.type === "MASTER") {
              event.preventGridDefault();
              event.preventDefault();

              setSelectedRow(new Set([e.row.ip]));
              setContextMenuProps({
                x: event.clientX,
                y: event.clientY,
                row: e.row,
              });
            }
          }}
          onCellDoubleClick={(e) => {
            if (e.column.key === "ip" || e.row.type !== "MASTER") {
              return;
            }
            let ip = e.row.ip;

            const a = document.createElement("a");
            a.href = `steam://connect/${ip}`;
            a.click();
          }}
        />
      </div>
      <div className="settings-container">
        <div className="top-level">
          <div className="tags">
            <label>
              Tags include
              <input
                type="text"
                name="mustIncludeTags"
                value={mustIncludeTagsRaw}
                onChange={(e) => setMustIncludeTags(e.currentTarget.value)}
              />
            </label>
            <label>
              Tags don't include
              <input
                type="text"
                name="mustNotIncludeTags"
                value={mustNotIncludeTagsRaw}
                onChange={(e) => setMustNotIncludeTags(e.currentTarget.value)}
              />
            </label>
          </div>
        </div>
        <hr />
        <div className="settings">
          <div className="settings-column right-align">
            <label>
              Category
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="vanilla">Vanilla</option>
                <option value="24/7">24/7 Server</option>
                <option value="comp">Comp</option>
                <option value="dm">DM</option>
                <option value="gamemode">Gamemode</option>
                <option value="jump/surf">Jump/Surf</option>
                <option value="mvm">MVM</option>
                <option value="social">Social</option>
              </select>
            </label>

            <label>
              Map
              <input
                type="text"
                name="map"
                value={map}
                onChange={(e) => setMap(e.currentTarget.value)}
              />
            </label>
            <label>
              Latency
              <select
                value={latency}
                onChange={(e) => setLatency(e.target.value)}
              >
                <option value=""></option>
                <option value="50">&lt; 50</option>
                <option value="100">&lt; 100</option>
                <option value="150">&lt; 150</option>
                <option value="250">&lt; 250</option>
                <option value="350">&lt; 350</option>
                <option value="600">&lt; 600</option>
              </select>
            </label>
            <label>
              Location
              <select
                value={region}
                onChange={(e) => setRegion(e.currentTarget.value)}
              >
                <option value="All">All</option>
                <option value="Africa">Africa</option>
                <option value="Asia">Asia</option>
                <option value="Australia">Australia</option>
                <option value="Europe">Europe</option>
                <option value="Middle East">Middle East</option>
                <option value="North America">North America</option>
                <option value="South America">South America</option>
              </select>
            </label>
            <label>
              Max player count
              <input
                type="number"
                className="minimal"
                value={maxPlayerCount ?? ""}
                onChange={(e) => {
                  if (e.target.value === "") {
                    setMaxPlayerCount(null);
                  } else {
                    setMaxPlayerCount(e.target.valueAsNumber);
                  }
                }}
              />
            </label>
          </div>
          <div className="settings-column">
            <label>
              <input
                type="checkbox"
                name="notFull"
                checked={notFull}
                onChange={(e) => setNotFull(e.currentTarget.checked)}
              />
              Server not full
            </label>
            <label>
              <input
                type="checkbox"
                name="hasUsersPlaying"
                checked={hasUsersPlaying}
                onChange={(e) => setHasUsersPlaying(e.currentTarget.checked)}
              />
              Has users playing
            </label>
            <label>
              <input
                type="checkbox"
                name="passwordProtected"
                checked={filterPasswordProtected}
                onChange={(e) =>
                  setFilterPasswordProtected(e.currentTarget.checked)
                }
              />
              Is not password protected
            </label>
            <label>
              <input
                type="checkbox"
                name="vanillaMaps"
                checked={vanillaMaps}
                onChange={(e) => setVanillaMaps(e.currentTarget.checked)}
              />
              Vanilla Maps
            </label>
            <label>
              <input
                type="checkbox"
                name="customMaps"
                checked={customMaps}
                onChange={(e) => setCustomMaps(e.currentTarget.checked)}
              />
              Custom Maps
            </label>
          </div>
          {/*
          <div className="settings-column">
            <fieldset>
              <legend>Maps</legend>
              {GAMEMODES.map((gamemode) => (
                <label key={gamemode}>
                  <input
                    type="checkbox"
                    name={`map-prefix-${gamemode}`}
                    checked={gamemodeFilters[gamemode] ?? true}
                    onChange={(e) => {
                      setGamemodeFilters((old) => ({
                        ...old,
                        [gamemode]: e.target.checked,
                      }));
                    }}
                  />
                  {gamemode}
                </label>
              ))}
            </fieldset>
          </div>
             */}
          <div className="settings-column">
            <fieldset>
              <legend>Alltalk</legend>
              <label>
                <input
                  type="radio"
                  name="alltalk"
                  value="na"
                  checked={allTalkPreference.na}
                  onChange={() => {
                    setSpecificTag(() => {}, "alltalk");
                  }}
                />
                No preference
              </label>
              <label>
                <input
                  type="radio"
                  name="alltalk"
                  value="yes"
                  checked={allTalkPreference.mustNotInclude}
                  onChange={() => {
                    setSpecificTag(setMustNotIncludeTags, "alltalk");
                  }}
                />
                No alltalk
              </label>
              <label>
                <input
                  type="radio"
                  name="alltalk"
                  value="no"
                  checked={allTalkPreference.mustInclude}
                  onChange={() => {
                    setSpecificTag(setMustIncludeTags, "alltalk");
                  }}
                />
                Alltalk
              </label>
            </fieldset>
            <fieldset>
              <legend>Random Crits</legend>
              <label>
                <input
                  type="radio"
                  name="crits"
                  value="na"
                  checked={randomCritPreference.na}
                  onChange={() => {
                    setSpecificTag(() => {}, "nocrits");
                  }}
                />
                No preference
              </label>
              <label>
                <input
                  type="radio"
                  name="crits"
                  value="yes"
                  checked={randomCritPreference.mustInclude}
                  onChange={() => {
                    setSpecificTag(setMustIncludeTags, "nocrits");
                  }}
                />
                No random crits
              </label>
              <label>
                <input
                  type="radio"
                  name="crits"
                  value="no"
                  checked={randomCritPreference.mustNotInclude}
                  onChange={() => {
                    setSpecificTag(setMustNotIncludeTags, "nocrits");
                  }}
                />
                Random crits
              </label>
            </fieldset>
          </div>
        </div>
      </div>
      {isLoggedIn && serverToBan && <BanModal serverToBan={serverToBan} />}
      {contextMenuProps && (
        <ContextMenu
          x={contextMenuProps.x}
          y={contextMenuProps.y}
          onClose={() => setContextMenuProps(undefined)}
          options={contextOptions}
        />
      )}
      {modalIp && (
        <Modal
          onClose={() => {
            switch (tabOpen) {
              case "server":
                navigate("/", { replace: true });
                break;
              case "favorites":
                navigate("/favorites", { replace: true });
                break;
              case "blacklist":
                navigate("/blacklist", { replace: true });
                break;
            }
          }}
        >
          <ServerPage isModal />
        </Modal>
      )}
    </div>
  );
}

export default App;
