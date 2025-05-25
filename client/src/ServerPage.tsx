import cx from "classnames";
import { useParams } from "react-router";
import { assert } from "./globals";
import { useQuery } from "@tanstack/react-query";
import {
  ByGamemodeChart,
  getServerStats,
  HistoricalPlayerChart,
  requestServerDetail,
  StatsAtAGlance,
  TotalMapTable,
} from "./charts";
import "./ServerPage.css";
import { useMemo } from "react";

interface ServerPageProps {
  isModal?: boolean;
}

const generateUrlSafeName = (url?: string) => {
  if (url == null) {
    return "";
  }
  const separators = ["-", "|", "~", "[", "("];
  for (const separator of separators) {
    if (url.startsWith(separator)) {
    } else if (url.includes(separator)) {
      url = url.slice(0, url.indexOf(separator));
    }
  }
  return url
    .toLowerCase()
    .replaceAll(/[^a-z\s\d.]/g, "")
    .trim()
    .replaceAll(/\s+|\./g, "-");
};

export const ServerPage = ({ isModal }: ServerPageProps) => {
  const params = useParams();
  const ip = params.ip;
  assert(!!ip);

  const Title = isModal ? "h2" : "h1";

  const { data: originalServerStats } = useQuery({
    queryKey: ["detail", ip],
    async queryFn() {
      return requestServerDetail(ip);
    },
  });

  const serverDetail = useMemo(() => {
    return getServerStats(originalServerStats);
  }, [originalServerStats]);

  const urlSafeName = generateUrlSafeName(serverDetail?.name);

  const url = isModal
    ? `/server/${ip}/${urlSafeName}`
    : `steam://connect/${ip}`;

  return (
    <div className={cx("server-page", isModal && "modal")}>
      <div className="title">
        <Title>
          <a href={url}>{serverDetail?.name}</a>
        </Title>
      </div>
      <TotalMapTable className="grid-area-maps" serverStats={serverDetail} />
      <ByGamemodeChart serverStats={serverDetail} />
      <StatsAtAGlance serverStats={serverDetail} />
      <HistoricalPlayerChart
        className="grid-area-historical"
        serverStats={serverDetail}
      />
    </div>
  );
};
