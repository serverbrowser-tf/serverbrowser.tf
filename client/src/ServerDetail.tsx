import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./utils.ts";
import "./ServerDetail.css";
import {
  ServerDetailMinimal,
  HistoricalPlayerChart,
  TotalMapTable,
} from "./charts.tsx";

interface Props {
  ip?: string;
}

export const ServerDetail = ({ ip }: Props) => {
  const { data } = useQuery({
    queryKey: ["detail", ip],
    async queryFn() {
      return await api<ServerDetailMinimal>(`/api/server-details/${ip}`);
    },
  });

  return (
    <div className="server-detail">
      <TotalMapTable maps={data?.maps} minimal />
      <HistoricalPlayerChart playerCounts={data?.playerCounts} />
    </div>
  );
};
