/* eslint-disable no-loop-func */
import React, { useMemo, useRef, useState } from "react";
import cx from "classnames";
import { api, mapUpsert, useElementSize } from "./utils.ts";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  PieChart,
  Pie,
  Cell,
  TooltipProps,
} from "recharts";
import {
  ValueType,
  NameType,
} from "recharts/types/component/DefaultTooltipContent";
// @ts-expect-error
import { DefaultTooltipContent } from "recharts/lib/component/DefaultTooltipContent";
import dayjs from "dayjs";
import Color from "color";
import "./charts.css";
import { officialMaps } from "./globals.ts";

export interface ServerDetailMinimal {
  name: string;
  playerCounts: Array<{ player_count: number; timestamp: number }>;
  maps: Record<string, number>;
}

export interface ServerDetailRest {
  serverMapHours: Array<{ map: string; date: string; hours: string }>;
}

export const requestServerDetailMinimal = (ip: string) => {
  return api<ServerDetailMinimal>(`/api/server-details/${ip}`);
};

export const requestServerDetailRest = (ip: string) => {
  return api<ServerDetailRest>(`/api/server-details-p2/${ip}`);
};

const startOfRandomWeek = dayjs().startOf("week");
const dayInMinutes = 60 * 24;
const weekInSeconds = 7 * 24 * 60 * 60;

const baseColor = Color("#c8ff00");
const historicalColor = baseColor.toString();
const historicalColor15 = baseColor.darken(0.45).toString();
const historicalColor2 = baseColor.darken(0.65).toString();
const historicalColor3 = baseColor.darken(0.8).toString();

const piChartColors = [
  baseColor.toString(),
  baseColor.hue(baseColor.hue() + 30).toString(),
  baseColor.hue(baseColor.hue() + 120).toString(),
  baseColor.hue(baseColor.hue() + 150).toString(),
  baseColor.hue(baseColor.hue() + 210).toString(),
  baseColor
    .saturate(-0.2)
    .hue(baseColor.hue() + 260)
    .toString(),
  baseColor.hue(baseColor.hue() + 300).toString(),
  baseColor.hue(baseColor.hue() + 330).toString(),
];

interface StatsAtAGlanceProps {
  playerCounts: ServerDetailMinimal["playerCounts"] | undefined;
  maps: ServerDetailMinimal["maps"] | undefined;
  serverMapHours: ServerDetailRest["serverMapHours"] | undefined;
}

export function StatsAtAGlance({
  playerCounts,
  maps,
  serverMapHours,
}: StatsAtAGlanceProps) {
  const stats = useMemo(() => {
    if (playerCounts == null || maps == null || serverMapHours == null) {
      return null;
    }
    let vanillaMaps = 0;
    let vanillaHours = 0;
    let customMaps = 0;
    let customHours = 0;
    for (const [map, hours] of Object.entries(maps ?? {})) {
      if (officialMaps.has(map)) {
        vanillaMaps += 1;
        vanillaHours += hours;
      } else {
        customMaps += 1;
        customHours += hours;
      }
    }

    const datesWithActiveSessions: Set<string> = new Set();
    let hoursPlayed = 0;
    let sessions: number = 0;
    let sessionStart = -1;
    let lastTimestamp = -1;
    for (const playerCount of playerCounts ?? []) {
      if (
        sessionStart > 0 &&
        (playerCount.player_count <= 3 ||
          playerCount.timestamp - sessionStart > 60 * 60 * 24 ||
          playerCount.timestamp - lastTimestamp > 60 * 30 * 2)
      ) {
        hoursPlayed += (lastTimestamp - sessionStart + 60 * 30) / 3600;
        sessionStart = -1;
      }
      if (playerCount.player_count >= 10) {
        if (sessionStart < 0) {
          sessions += 1;
          sessionStart = playerCount.timestamp;
        }
      }
      if (playerCount.player_count >= 5) {
        datesWithActiveSessions.add(
          dayjs.unix(playerCount.timestamp).utc().format("YYYY-MM-DD"),
        );
      }

      lastTimestamp = playerCount.timestamp;
    }

    const gamemodesForActiveSessions = new Map<
      string,
      { gamemodes: Set<string> }
    >();
    let mapsForActiveSessions = 0;
    for (const record of serverMapHours ?? []) {
      if (!datesWithActiveSessions.has(record.date)) {
        continue;
      }
      const mapPerDay = mapUpsert(gamemodesForActiveSessions, record.date, {
        insert() {
          return { gamemodes: new Set() };
        },
      });
      mapPerDay.gamemodes.add(mapToGamemode(record.map));
      mapsForActiveSessions += 1;
    }

    const numberGamemodesForActiveSessions = [
      ...gamemodesForActiveSessions.values(),
    ].reduce((a, b) => a + b.gamemodes.size, 0);

    const returnValue = {
      vanillaHours,
      vanillaMaps,
      customMaps,
      customHours,
      averageActiveSessions: {
        hours: hoursPlayed / sessions,
        maps: mapsForActiveSessions / sessions,
        gamemodes: numberGamemodesForActiveSessions / sessions,
      },
    };
    if (sessions === 0) {
      returnValue.averageActiveSessions = {
        hours: 0,
        maps: 0,
        gamemodes: 0,
      };
    }

    return returnValue;
  }, [playerCounts, maps, serverMapHours]);

  if (stats == null) {
    return (
      <div className="stats-at-a-glance">
        <h3 className="chart-title">Generic stats</h3>
      </div>
    );
  }

  return (
    <div className="stats-at-a-glance">
      <h3 className="chart-title">Generic stats</h3>
      <div className="chart-column">
        <span>Vanilla maps:</span>
        <span>{stats.vanillaMaps}</span>
        <span>Vanilla hours:</span>
        <span>{stats.vanillaHours.toFixed(1)}</span>
      </div>
      <div className="chart-column">
        <span>Custom maps:</span>
        <span>{stats.customMaps}</span>
        <span>Custom hours:</span>
        <span>{stats.customHours.toFixed(1)}</span>
      </div>
      <div className="spacer" />
      {stats.averageActiveSessions.maps > 0 && (
        <div className="chart-column">
          <span>Avg Maps played per session</span>
          <span>{stats.averageActiveSessions.maps.toFixed(1)}</span>
          <span>Avg Gamemodes played per session</span>
          <span>{stats.averageActiveSessions.gamemodes.toFixed(1)}</span>
          <span>Avg Hours played per session</span>
          <span>{stats.averageActiveSessions.hours.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

const GamemodeTooltip = (props: TooltipProps<ValueType, NameType>) => {
  for (const el of props.payload ?? []) {
    el.color = "#c8bca2";
  }
  return <DefaultTooltipContent {...props} />;
};

function mapToGamemode(map: string) {
  const prefix = map.includes("_") ? map.substring(0, map.indexOf("_")) : map;

  return prefix.toLowerCase();
}

interface ByGamemodeChartProps {
  maps: ServerDetailMinimal["maps"] | undefined;
  className?: string;
}

export function ByGamemodeChart({ maps, className }: ByGamemodeChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const chartDimensions = useElementSize(ref);
  const byGamemode = useMemo(() => {
    if (maps == null) {
      return {};
    }
    const gamemodeTotals: Record<string, number> = {};

    for (const [mapName, hours] of Object.entries(maps)) {
      const gamemode = mapToGamemode(mapName);
      gamemodeTotals[gamemode] = (gamemodeTotals[gamemode] || 0) + hours;
    }

    return gamemodeTotals;
  }, [maps]);

  const byGamemodeHours = useMemo(() => {
    if (byGamemode == null) {
      return [];
    }
    const sum = Object.values(byGamemode).reduce((a, b) => a + b, 0);

    const chartData = Object.entries(byGamemode)
      .map(([name, hours]) => ({
        name,
        hours,
      }))
      .sort((a, b) => b.hours - a.hours);

    for (let i = 1; i < chartData.length - 1; i++) {
      const item = chartData[i];
      if (item.hours / sum <= 0.02) {
        const removed = chartData.splice(i);
        const removedSum = removed.reduce((a, b) => a + b.hours, 0);
        chartData.push({
          name: `Other(${removed.length})`,
          hours: removedSum,
          // @ts-expect-error
          rest: removed,
        });
      }
    }

    return chartData;
  }, [byGamemode]);

  return (
    <div
      className={cx("by-gamemode-chart", className)}
      style={{ width: "100%", height: "100%" }}
    >
      <h3 className="chart-title">Player Hours by Gamemode</h3>
      <ResponsiveContainer ref={ref}>
        <PieChart>
          <Pie
            data={byGamemodeHours}
            cx="50%"
            cy="50%"
            label={({ name }) => name}
            outerRadius={
              Math.min(chartDimensions.width, chartDimensions.height) / 2 - 50
            }
            stroke="#221f1c"
            dataKey="hours"
            isAnimationActive={false}
          >
            {byGamemodeHours.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={piChartColors[index % piChartColors.length]}
              />
            ))}
          </Pie>
          <Tooltip
            content={<GamemodeTooltip />}
            contentStyle={{
              borderColor: "#403c33",
              backgroundColor: "hsl(0deg 0% 9%)",
            }}
            formatter={(hours: number, name: string, payload) => {
              const rest = payload.payload.payload.rest;
              if (rest) {
                return (
                  <div className="gamemode-tooltip-other">
                    {payload.payload.payload.rest?.map(
                      ({ name, hours }: any) => (
                        <>
                          <span>{name}:</span>
                          <span>{hours.toFixed(1)} hours</span>
                        </>
                      ),
                    )}
                  </div>
                );
              }
              return [`${hours.toFixed(1)} hours`, name];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

const HistoricalPlayerTooltip = (props: TooltipProps<ValueType, NameType>) => {
  for (const el of props.payload ?? []) {
    if (el.dataKey !== "This week") el.color = historicalColor15;
  }
  return <DefaultTooltipContent {...props} />;
};

interface HistoricalPlayerChartProps {
  playerCounts: ServerDetailMinimal["playerCounts"] | undefined;
  className?: string;
}

export function HistoricalPlayerChart({
  playerCounts,
  className,
}: HistoricalPlayerChartProps) {
  const { historicalData, maxWeek } = useMemo(() => {
    const inputSource = playerCounts;
    if (inputSource == null || inputSource.length === 0) {
      return { historicalData: [], maxWeek: 0 };
    }

    type NormalizedRecord = {
      "This week"?: number;
      "Last week"?: number;
      "2 weeks ago"?: number;
      "3 weeks ago"?: number;
      minutesSinceStartOfWeek: number;
    };
    const output: NormalizedRecord[] = [];

    const map = new Map<number, NormalizedRecord>();

    for (let i = 0; i < 60 * 24 * 7; i += 30) {
      const record: NormalizedRecord = {
        minutesSinceStartOfWeek: i,
        "This week": undefined,
        "Last week": undefined,
        "2 weeks ago": undefined,
        "3 weeks ago": undefined,
      };
      output.push(record);
      map.set(i, record);
    }

    inputSource.sort((a, b) => a.timestamp - b.timestamp);

    let maxWeek = 0;

    const now = dayjs().unix();
    const startOfThisWeek = dayjs().startOf("week");
    const start = startOfThisWeek.subtract(3, "week").unix();
    const end = startOfThisWeek.unix() + weekInSeconds;
    let weekCount = 3;
    let current = start;
    let inputIndex = 0;
    const sectionDuration = 60 * 30;
    outerloop: while (current < end) {
      for (
        let sectionForWeek = 0;
        sectionForWeek < weekInSeconds;
        sectionForWeek += sectionDuration, current += sectionDuration
      ) {
        if (current > now) {
          break outerloop;
        }
        if (
          inputSource[inputIndex] == null &&
          current + sectionDuration > end
        ) {
          break outerloop;
        }
        while (
          inputSource[inputIndex] != null &&
          inputSource[inputIndex].timestamp < current
        ) {
          inputIndex += 1;
        }
        const record = inputSource[inputIndex] ?? {
          player_count: 0,
          timestamp: current,
        };

        let playerCount = record.player_count;
        if (record.timestamp >= current + sectionDuration) {
          if (inputIndex === 0) {
            continue;
          }
          playerCount = 0;
        }
        let shouldDelete = false;
        const key = sectionForWeek / 60;
        mapUpsert(map, key, {
          insert: () => {
            console.error("Timestamp is not exactly divisible by 30 minutes");
            shouldDelete = true;
            return {
              minutesSinceStartOfWeek: key,
              "3 weeks ago": 0,
              "2 weeks ago": 0,
              "Last week": 0,
              "This week": 0,
            };
          },
          update: (norm) => {
            if (playerCount !== 0) {
              maxWeek = Math.max(weekCount, maxWeek);
            }
            switch (weekCount) {
              case 0:
                norm["This week"] = playerCount;
                break;
              case 1:
                norm["Last week"] = playerCount;
                break;
              case 2:
                norm["2 weeks ago"] = playerCount;
                break;
              case 3:
                norm["3 weeks ago"] = playerCount;
                break;
            }
            return norm;
          },
        });
        if (shouldDelete) {
          map.delete(sectionForWeek);
        }
      }
      weekCount -= 1;
    }

    return { historicalData: output, maxWeek };
  }, [playerCounts]);

  return (
    <div className={cx("historical-player-count", className)}>
      <h3 className="chart-title">Player Count</h3>
      <ResponsiveContainer>
        <LineChart data={historicalData} className="player-count-chart">
          <XAxis
            dataKey="minutesSinceStartOfWeek"
            stroke="#c9bda4"
            ticks={[
              0,
              dayInMinutes,
              dayInMinutes * 2,
              dayInMinutes * 3,
              dayInMinutes * 4,
              dayInMinutes * 5,
              dayInMinutes * 6,
            ]}
            tickFormatter={(value) => {
              const thisTick = startOfRandomWeek.add(value, "minutes");
              return thisTick.format("ddd");
            }}
          />
          <YAxis stroke="#c9bda4" />
          <Tooltip
            content={<HistoricalPlayerTooltip />}
            contentStyle={{
              borderColor: "#403c33",
              backgroundColor: "hsl(0deg 0% 9%)",
            }}
            labelFormatter={(value) => {
              const thisTick = startOfRandomWeek.add(value, "minutes");
              return thisTick.format("dddd LT");
            }}
          />
          {maxWeek >= 3 && (
            <Line
              type="monotone"
              dataKey="3 weeks ago"
              color={historicalColor15}
              stroke={historicalColor3}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {maxWeek >= 2 && (
            <Line
              type="monotone"
              dataKey="2 weeks ago"
              color={historicalColor15}
              stroke={historicalColor3}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {maxWeek >= 1 && (
            <Line
              type="monotone"
              dataKey="Last week"
              color={historicalColor15}
              stroke={historicalColor2}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {maxWeek >= 0 && (
            <Line
              type="monotone"
              dataKey="This week"
              color={historicalColor}
              stroke={historicalColor}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TotalMapTableProps {
  maps: ServerDetailMinimal["maps"] | undefined;
  className?: string;
  minimal?: boolean;
}

export function TotalMapTable({
  maps,
  className,
  minimal,
}: TotalMapTableProps) {
  const [page, setPage] = useState(0);
  const PAGE_COUNT = minimal ? 10 : 25;
  const entries = Object.entries(maps ?? {});
  const totalPages = Math.ceil(entries.length / PAGE_COUNT);

  const startPage = page * PAGE_COUNT;
  const endPage = (page + 1) * PAGE_COUNT;

  const needsPadding = endPage > entries.length;

  return (
    <div className={cx("total-map-hours", minimal && "minimal", className)}>
      <table>
        <thead>
          <tr>
            <th>Map</th>
            <th>Hours</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(startPage, endPage).map(([map, hours]) => (
            <tr key={map}>
              <td title={map}>{map}</td>
              <td>{hours}</td>
            </tr>
          ))}
          {needsPadding &&
            [...new Array(endPage - entries.length)].map((_, i) => (
              <tr key={i} />
            ))}
        </tbody>
      </table>
      <div className="pagination">
        {page === 0 ? (
          <div />
        ) : (
          <button type="button" onClick={() => setPage((old) => old - 1)}>
            «
          </button>
        )}
        <div>{page + 1}</div>
        {page + 1 === totalPages ? (
          <div />
        ) : (
          <button type="button" onClick={() => setPage((old) => old + 1)}>
            »
          </button>
        )}
      </div>
    </div>
  );
}
