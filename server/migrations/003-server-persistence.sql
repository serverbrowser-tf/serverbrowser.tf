ALTER TABLE servers
ADD COLUMN map_id INTEGER REFERENCES maps(id);
CREATE INDEX idx_servers_map ON servers(map_id);

ALTER TABLE servers
ADD COLUMN visibility TINYINT;

ALTER TABLE servers
ADD COLUMN maxPlayers TINYINT;

