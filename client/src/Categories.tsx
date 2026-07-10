import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Column, SortColumn } from "react-data-grid";
import day from "dayjs";

import { DataGrid } from "./DataGrid.tsx";
import { TabsHeader } from "./TabsHeader.tsx";
import { REGIONS, ServerInfo } from "./types.ts";
import { api, apiRoute, publicCategories } from "./utils.ts";
import "./Categories.css";

type CategoryRow = Omit<ServerInfo, "category"> & {
  category: string;
};

const categoryOptions = [
  ...Object.entries(publicCategories),
  ["fake players", "Fake players"],
];

function compareValues(a: unknown, b: unknown) {
  if (a == null || b == null) {
    return Number(b != null) - Number(a != null);
  }
  if (typeof a === "number" && typeof b === "number") {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

function sortCategories(rows: CategoryRow[], sortColumns: SortColumn[]) {
  rows.sort((a, b) => {
    for (const sort of sortColumns) {
      const key = sort.columnKey as keyof CategoryRow;
      const multiplier = sort.direction === "ASC" ? 1 : -1;
      const compared = compareValues(a[key], b[key]);
      if (compared !== 0) {
        return compared * multiplier;
      }
    }
    return 0;
  });
}

function formatLastOnline(lastOnline: number | undefined) {
  if (lastOnline == null) {
    return "";
  }
  return day.unix(lastOnline).format("lll");
}

export function Categories() {
  const [pendingIps, setPendingIps] = useState(new Set<string>());
  const { data, refetch } = useQuery<CategoryRow[]>({
    queryKey: ["admin", "categories"],
    queryFn: async ({ signal }) => {
      return api<CategoryRow[]>(`${apiRoute}/api/admin/blacklist`, {
        signal,
        cache: "no-store",
      });
    },
    refetchInterval: 1000 * 30,
    refetchOnWindowFocus: true,
  });

  const updateCategory = async (ip: string, reason: string) => {
    setPendingIps((old) => new Set(old).add(ip));
    try {
      await api("/api/ban", {
        method: "POST",
        body: { ip, reason },
      });
      await refetch();
    } finally {
      setPendingIps((old) => {
        const next = new Set(old);
        next.delete(ip);
        return next;
      });
    }
  };

  const columns = useMemo((): Column<CategoryRow>[] => {
    return [
      {
        key: "ip",
        name: "Server",
        width: 220,
        renderCell(props) {
          return (
            <div className="categories-server-cell">
              <span>{props.row.visibility ? "🔒" : ""}</span>
              <a href={`steam://connect/${props.row.ip}`}>{props.row.ip}</a>
            </div>
          );
        },
      },
      {
        key: "name",
        name: "Name",
        minWidth: 360,
      },
      {
        key: "map",
        name: "Map",
        minWidth: 180,
      },
      {
        key: "region",
        name: "Region",
        width: 120,
        renderCell(props) {
          return REGIONS[props.row.region] ?? "";
        },
      },
      {
        key: "category",
        name: "Category",
        width: 160,
        renderCell(props) {
          const disabled = pendingIps.has(props.row.ip);
          return (
            <select
              className="categories-category-select"
              value={props.row.category}
              disabled={disabled}
              onChange={(event) => {
                void updateCategory(props.row.ip, event.currentTarget.value);
              }}
            >
              {categoryOptions.map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          );
        },
      },
      {
        key: "active_hours",
        name: "Active Hours",
        width: 120,
        sortDescendingFirst: true,
      },
      {
        key: "last_online",
        name: "Last Online",
        width: 180,
        sortDescendingFirst: true,
        renderCell(props) {
          return formatLastOnline(props.row.last_online);
        },
      },
      {
        key: "actions",
        name: "",
        width: 90,
        sortable: false,
        renderCell(props) {
          const disabled = pendingIps.has(props.row.ip);
          return (
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                void updateCategory(props.row.ip, "");
              }}
            >
              Remove
            </button>
          );
        },
      },
    ];
  }, [pendingIps]);

  return (
    <div className="categories-page">
      <TabsHeader />
      <div className="categories-grid">
        <DataGrid
          grid="admin-categories"
          columns={columns}
          rows={data}
          defaultSortColumn={{ columnKey: "category", direction: "ASC" }}
          sort={sortCategories}
          rowKeyGetter={(row) => row.ip}
        />
      </div>
    </div>
  );
}
