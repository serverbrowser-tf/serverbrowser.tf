import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import "./ServerDetail.css";
import {
  HistoricalPlayerChart,
  TotalMapTable,
  getServerStats,
  requestServerDetail,
} from "./charts.tsx";

interface Props {
  ip?: string;
}

export const ServerDetail = ({ ip }: Props) => {
  const { data } = useQuery({
    queryKey: ["detail", ip],
    async queryFn() {
      if (ip == null) {
        return undefined;
      }
      return requestServerDetail(ip);
    },
  });

  const serverDetail = useMemo(() => {
    return getServerStats(data);
  }, [data]);

  return (
    <div className="server-detail">
      <TotalMapTable serverStats={serverDetail} minimal />
      <HistoricalPlayerChart serverStats={serverDetail} />
    </div>
  );
};
