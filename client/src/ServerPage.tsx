import cx from "classnames";
import { useParams } from "react-router";
import { assert } from "./globals";
import { useQuery } from "@tanstack/react-query";
import {
  ByGamemodeChart,
  HistoricalPlayerChart,
  requestServerDetailMinimal,
  requestServerDetailRest,
  StatsAtAGlance,
  TotalMapTable,
} from "./charts";
import "./ServerPage.css";

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

  const { data: serverDetail1 } = useQuery({
    queryKey: ["detail", ip],
    async queryFn() {
      return requestServerDetailMinimal(ip);
    },
  });

  const { data: serverDetail2 } = useQuery({
    queryKey: ["detail2", ip],
    async queryFn() {
      return requestServerDetailRest(ip);
    },
  });

  const urlSafeName = generateUrlSafeName(serverDetail1?.name);

  const url = isModal
    ? `/server/${ip}/${urlSafeName}`
    : `steam://connect/${ip}`;

  return (
    <div className={cx("server-page", isModal && "modal")}>
      <div className="title">
        <Title>
          <a href={url}>{serverDetail1?.name}</a>
        </Title>
      </div>
      <TotalMapTable className="grid-area-maps" maps={serverDetail1?.maps} />
      <ByGamemodeChart maps={serverDetail1?.maps} />
      <StatsAtAGlance
        playerCounts={serverDetail1?.playerCounts}
        maps={serverDetail1?.maps}
        serverMapHours={serverDetail2?.serverMapHours}
      />
      <HistoricalPlayerChart
        className="grid-area-historical"
        playerCounts={serverDetail1?.playerCounts}
      />
    </div>
  );
};
