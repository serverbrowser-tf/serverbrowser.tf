import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ByGamemodeChart,
  getServerStats,
  HistoricalPlayerChart,
  requestValveDetail,
  StatsAtAGlance,
  TotalMapTable,
} from "./charts";
import "./ValveOverview.css";

export function ValveOverview() {
  const { data } = useQuery({
    queryKey: ["valve-details"],
    queryFn: requestValveDetail,
    retry: true,
    retryDelay: 1000,
    refetchInterval: 1000 * 60,
    refetchOnWindowFocus: true,
  });

  const serverStats = useMemo(() => getServerStats(data), [data]);

  return (
    <div className="valve-overview">
      <StatsAtAGlance serverStats={serverStats} />
      <HistoricalPlayerChart serverStats={serverStats} />
      <ByGamemodeChart serverStats={serverStats} />
      <TotalMapTable serverStats={serverStats} minimal />
    </div>
  );
}
