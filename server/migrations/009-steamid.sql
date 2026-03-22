-- sqlite doesn't support a drop unique constaint
-- drop ip unique
CREATE TABLE servers_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip VARCHAR(21) NOT NULL,
    steamid VARCHAR(32) UNIQUE,
    name TEXT NOT NULL,
    keyword TEXT NOT NULL,
    region TINYINT UNSIGNED NOT NULL,
    map_id INTEGER REFERENCES maps(id),
    visibility TINYINT,
    maxPlayers TINYINT,
    last_online DATETIME,
    CONSTRAINT idx_steamid UNIQUE (steamid)
);

INSERT INTO servers_new (id, ip, name, keyword, region, map_id, visibility, maxPlayers, last_online)
SELECT id, ip, name, keyword, region, map_id, visibility, maxPlayers, last_online
FROM servers;

DROP TABLE servers;

ALTER TABLE servers_new RENAME TO servers;

CREATE INDEX idx_servers_server ON servers(ip);
CREATE INDEX idx_servers_map ON servers(map_id);
CREATE INDEX idx_server_last_online ON servers(last_online);
