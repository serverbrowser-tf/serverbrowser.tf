import cx from "classnames";
import { Link, useParams } from "react-router";
import { Column } from "react-data-grid";
import { assert } from "./globals";
import { useQuery } from "@tanstack/react-query";
import { api } from "./utils";
import { DataGrid } from "./DataGrid";
import "./MapInfo.css";

interface RowData {
  ip: string;
  name: string;
  hours: number;
  lastPlayed: string;
  visibility: boolean;
}

const columns: Column<RowData>[] = [
  {
    key: "ip",
    name: "Server",
    width: 220,
    renderCell(thing) {
      return (
        <>
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
    width: 800 - 220 - 80 - 120 - 20,
  },
  {
    key: "hours",
    name: "Hours",
    width: 80,
  },
  {
    key: "lastPlayed",
    name: "Last Played",
    width: 120,
  },
];

// IP address comparator
const ipComparator = (a: RowData, b: RowData): number => {
  const [ipStrA, portA] = a.ip.split(":");
  const [ipStrB, portB] = b.ip.split(":");

  const ipA = ipStrA.split(".").map(Number);
  const ipB = ipStrB.split(".").map(Number);

  // Compare IP segments first
  for (let i = 0; i < 4; i++) {
    if (ipA[i] !== ipB[i]) {
      return ipA[i] - ipB[i];
    }
  }

  // If IPs are equal, compare ports
  return Number(portA) - Number(portB);
};

// Name comparator (case insensitive)
const nameComparator = (a: RowData, b: RowData): number => {
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
};

// Hours comparator
const hoursComparator = (a: RowData, b: RowData): number => {
  return a.hours - b.hours;
};

// Last played comparator
const lastPlayedComparator = (a: RowData, b: RowData): number => {
  return a.lastPlayed.localeCompare(b.lastPlayed);
};

interface MapViewProps {
  isModal?: boolean;
}

export const MapView = ({ isModal }: MapViewProps) => {
  const params = useParams();
  const map = params.map || params["*"];
  assert(!!map);

  const Title = isModal ? "h2" : "h1";

  const { data } = useQuery({
    queryKey: ["map", map],
    queryFn: () => {
      interface Data {
        mapServers: Array<RowData>;
      }
      return api<Data>(`/api/maps/details/${map}`);
    },
  });

  return (
    <div className={cx("map-view", isModal && "modal")}>
      <Title className="title">
        {isModal ? <Link to={`/map/${map}`}>{map}</Link> : map}
      </Title>
      <DataGrid
        className="grid"
        rowKeyGetter={(data) => data.ip}
        grid="server-maps"
        rows={data?.mapServers}
        columns={columns}
        sort={(data, sortColumns) => {
          const sortColumn = sortColumns[0];
          if (sortColumn) {
            const direction = sortColumn.direction === "ASC" ? 1 : -1;
            switch (sortColumn.columnKey) {
              case "ip":
                return data.sort((a, b) => ipComparator(a, b) * direction);
              case "name":
                return data.sort((a, b) => nameComparator(a, b) * direction);
              case "hours":
                return data.sort((a, b) => hoursComparator(a, b) * direction);
              case "lastPlayed":
                return data.sort(
                  (a, b) => lastPlayedComparator(a, b) * direction,
                );
            }
          }
        }}
        defaultSortColumn={{
          columnKey: "lastPlayed",
          direction: "DESC",
        }}
        gridProps={{
          rowHeight: 24,
        }}
      />
    </div>
  );
};
