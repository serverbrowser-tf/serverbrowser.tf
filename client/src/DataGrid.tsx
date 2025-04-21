import React, { useMemo, useState } from "react";
import cx from "classnames";
import {
  DataGrid as BaseDataGrid,
  Column,
  DataGridProps,
  SortColumn,
} from "react-data-grid";
import { useLocalStorage } from "react-use";
import "./DataGrid.css";

interface ContextMenuProps<T> {
  x: number;
  y: number;
  row: T;
}

interface Props<T> {
  grid: string;
  className?: string;
  columns: Column<T>[];
  rows: T[] | undefined;
  allowEmptySort?: boolean;
  defaultSortColumn: SortColumn;
  sort: (copy: T[], sortColumns: SortColumn[]) => void;
  rowKeyGetter: (t: T) => string;
  onContextMenu?: (props: ContextMenuProps<T>) => void;
  gridProps?: Omit<DataGridProps<T>, "rows" | "columns" | "className">;
}

export function DataGrid<T extends any>({
  grid,
  className,
  columns,
  rows,
  allowEmptySort,
  defaultSortColumn,
  sort,
  rowKeyGetter,
  onContextMenu,
  gridProps = {},
}: Props<T>) {
  const [sortColumns, setSortColumns] = useLocalStorage<SortColumn[]>(
    `${grid}-sort-column`,
    [defaultSortColumn],
  );
  const [selectedRow, setSelectedRow] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    if (rows == null) {
      return [];
    }

    const copy = [...rows];
    sort(copy, sortColumns ?? []);
    return copy;
  }, [rows, sort, sortColumns]);

  return (
    <BaseDataGrid
      {...gridProps}
      className={cx("fill-grid", className)}
      sortColumns={sortColumns}
      onSortColumnsChange={(columns) => {
        if (columns.length === 0 && !allowEmptySort) {
          setSortColumns([defaultSortColumn]);
        } else {
          setSortColumns(columns);
        }
      }}
      defaultColumnOptions={{
        sortable: true,
        resizable: true,
      }}
      selectedRows={selectedRow}
      onSelectedRowsChange={setSelectedRow}
      onCellClick={(e, event) => {
        setSelectedRow(new Set([rowKeyGetter(e.row)]));
        gridProps.onCellClick?.(e, event);
      }}
      onCellContextMenu={(e, event) => {
        setSelectedRow(new Set([rowKeyGetter(e.row)]));
        if (onContextMenu) {
          event.preventGridDefault();
          event.preventDefault();

          onContextMenu({
            x: event.clientX,
            y: event.clientY,
            row: e.row,
          });
        }
        gridProps.onCellContextMenu?.(e, event);
      }}
      rows={sorted}
      columns={columns}
      rowKeyGetter={rowKeyGetter}
    />
  );
}
