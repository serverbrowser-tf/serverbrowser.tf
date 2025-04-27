-- tbh this is probably what I should have done to begin with. i don't know why
-- I have 2 tables listing 2 separate types of player data on servers might
-- just drop/deprecate server_map_hours

DROP INDEX idx_server_players_unique;
ALTER TABLE server_players ADD COLUMN map_id INTEGER DEFAULT NULL REFERENCES maps(id);
ALTER TABLE server_players ADD COLUMN player_hours REAL DEFAULT NULL;
ALTER TABLE server_players ADD COLUMN raw_hours REAL DEFAULT NULL;

CREATE UNIQUE INDEX idx_server_players_unique ON server_players(server_id, timestamp, map_id);


-- alternatively can just remake the table and have actual time start time end
-- but this is a lot of work...
-- CREATE TABLE server_history {
--     id INTEGER PRIMARY KEY AUTOINCREMENT,
--     server_id INTEGER NOT NULL,
--     map_id INTEGER NOT NULL,
--     max_player_count TINYINT UNSIGNED NOT NULL,
--     player_hours REAL NOT NULL,
--     raw_hours REAL NOT NULL,
--     time_start DATETIME NOT NULL,
--     time_end DATETIME NOT NULL,
--     FOREIGN KEY (server_id) REFERENCES servers(id),
--     FOREIGN KEY (map_id) REFERENCES maps(id)
-- };


-- another solution is to keep a list of every time we query servers but i
-- don't want to handle all that data on my teeny tiny 1gb 1core $6/month vps







