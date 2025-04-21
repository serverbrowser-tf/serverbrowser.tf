import React, { useCallback, useMemo, useState } from "react";
import { Column } from "react-data-grid";
import { currentSearch, TabsHeader } from "./TabsHeader";
import "./Maps.css";
import { useQuery } from "@tanstack/react-query";
import { apiLines } from "./utils";
import { useAtom } from "./globals";
import { ContextMenu, ContextMenuOption } from "./ContextMenu";
import { useNavigate, useParams } from "react-router";
import { Modal } from "./Modal";
import { DataGrid } from "./DataGrid";
import { MapView } from "./MapInfo";

interface RowData {
  map: string;
  hours: number;
  servers: number;
}

const rawColumns: Column<RowData>[] = [
  {
    name: "Map",
    key: "map",
  },
  {
    name: "Hours",
    key: "hours",
    width: 200,
  },
  {
    name: "Servers",
    key: "servers",
    width: 200,
  },
];

const getKeyRowData = (data: RowData) => data.map;

function mapComparator(a: RowData, b: RowData) {
  const left = a.map.toLowerCase();
  const right = b.map.toLowerCase();
  return left.localeCompare(right);
}

function hoursComparator(a: RowData, b: RowData) {
  return a.hours - b.hours;
}

function serversComparator(a: RowData, b: RowData) {
  return a.servers - b.servers;
}

export const Maps = () => {
  const [contextMenuProps, setContextMenuProps] = useState<{
    x: number;
    y: number;
    row: RowData;
  }>();
  const { data, error } = useQuery({
    queryKey: ["maps"],
    async queryFn() {
      const result: RowData[] = [];
      for await (const map of apiLines<RowData>("/api/maps")) {
        result.push(map);
      }
      return result;
    },
  });
  const search = useAtom(currentSearch);
  const { "*": modalMap } = useParams();
  const navigate = useNavigate();

  const rowData = useMemo(() => {
    if (data == null) {
      return [];
    }

    let copy = [...data];

    if (search.trim()) {
      const trimmedSort = search.trim().toLowerCase();
      copy = copy.filter((el) => el.map.toLowerCase().includes(trimmedSort));
    }

    return copy;
  }, [data, search]);

  const columns = useMemo(() => {
    const copy = [...rawColumns];
    copy[0] = {
      ...copy[0],
      name: `Maps (${rowData.length})`,
    };

    return copy;
  }, [rowData.length]);

  const navigateToModalView = useCallback((map: string) => {
    navigate(`/maps/${map.toWellFormed()}`, {
      replace: true
    });
  }, [navigate]);

  const contextOptions = useMemo(() => {
    if (contextMenuProps == null) {
      return [];
    }
    const map = contextMenuProps.row.map;
    const options: ContextMenuOption[] = [
      {
        label: "View map info",
        onClick: () => {
          navigateToModalView(map);
        },
      },
    ];

    return options;
  }, [contextMenuProps, navigateToModalView]);

  if (error) {
    console.error(error);
  }

  return (
    <div className="maps">
      <TabsHeader />
      <div className="grid">
        <DataGrid
          grid="maps"
          rowKeyGetter={getKeyRowData}
          gridProps={{
            rowHeight: 24,
            onCellDoubleClick: (e) => {
              navigateToModalView(e.row.map);
            },
          }}
          defaultSortColumn={{
            columnKey: "map",
            direction: "ASC",
          }}
          sort={function sort(copy, sortColumns) {
            const sortColumn = sortColumns[0];
            if (sortColumn) {
              const direction = sortColumn.direction === "ASC" ? 1 : -1;
              switch (sortColumn.columnKey) {
                case "map":
                  copy.sort((a, b) => mapComparator(a, b) * direction);
                  break;
                case "hours":
                  copy.sort((a, b) => hoursComparator(a, b) * direction);
                  break;
                case "servers":
                  copy.sort((a, b) => serversComparator(a, b) * direction);
                  break;
              }
            }
          }}
          rows={rowData}
          columns={columns}
          onContextMenu={setContextMenuProps}
        />
      </div>
      {contextMenuProps && (
        <ContextMenu
          x={contextMenuProps.x}
          y={contextMenuProps.y}
          onClose={() => setContextMenuProps(undefined)}
          options={contextOptions}
        />
      )}
      {modalMap && (
        <Modal onClose={() => {
          navigate("/maps", {
            replace: true
          })
        }}>
          <MapView isModal />
        </Modal>
      )}
    </div>
  );
};
