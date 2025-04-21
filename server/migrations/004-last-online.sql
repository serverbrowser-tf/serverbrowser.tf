ALTER TABLE servers
ADD COLUMN last_online DATETIME;
CREATE INDEX idx_server_last_online ON servers(last_online);

ALTER TABLE servers
ADD COLUMN banned BOOLEAN NOT NULL DEFAULT 0;

UPDATE servers
SET last_online = (
    SELECT MAX(timestamp)
    FROM server_players
    WHERE server_players.server_id = servers.id
);

UPDATE servers 
SET banned = 1 
WHERE id IN (
    SELECT server_id 
    FROM blacklist 
    WHERE reason = 'fake players'
);
