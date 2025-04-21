-- Create maps table
CREATE TABLE maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map VARCHAR(32) NOT NULL UNIQUE,
    CONSTRAINT idx_map UNIQUE (map)
);
CREATE INDEX idx_maps_map ON maps(map);

-- Create servers table
CREATE TABLE servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip VARCHAR(21) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    keyword TEXT NOT NULL,
    region TINYINT UNSIGNED NOT NULL,
    CONSTRAINT idx_ip UNIQUE (ip)
);
CREATE INDEX idx_servers_server ON servers(ip);

-- Create server_players table
CREATE TABLE server_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    player_count TINYINT UNSIGNED NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(id)
);
CREATE UNIQUE INDEX idx_server_players_unique ON server_players(server_id, timestamp);

-- Create server_map_hours
CREATE TABLE server_map_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    map_id INTEGER NOT NULL,
    hours REAL NOT NULL,
    date DATE NOT NULL,
    FOREIGN KEY (server_id) REFERENCES servers(id),
    FOREIGN KEY (map_id) REFERENCES maps(id)
);
CREATE UNIQUE INDEX idx_server_map_hours_unique ON server_map_hours(map_id, server_id, date);

-- blacklist
CREATE TABLE blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    FOREIGN KEY (server_id) REFERENCES servers(id)
);
CREATE INDEX idx_blacklist_server ON blacklist(server_id);
