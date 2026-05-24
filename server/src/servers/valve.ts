export function isValveServer(server: {
  gametype?: string | null;
  keyword?: string | null;
  keywords?: string | null;
  name?: string | null;
  is_valve?: number | boolean | null;
}) {
  if (server.is_valve === 1 || server.is_valve === true) {
    return true;
  }

  const keywords = [server.gametype, server.keyword, server.keywords].flatMap(
    (keyword) =>
      (keyword ?? "")
        .toLowerCase()
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean),
  );
  const normalizedName = (server.name ?? "").toLowerCase();

  return (
    normalizedName.startsWith("valve matchmaking server") &&
    keywords.includes("valve") &&
    keywords.includes("hidden")
  );
}
