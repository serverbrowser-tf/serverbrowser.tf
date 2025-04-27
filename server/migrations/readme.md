# Table structure

```sql
CREATE TABLE maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    map VARCHAR(32) NOT NULL UNIQUE,
    CONSTRAINT idx_map UNIQUE (map)
);
CREATE TABLE sqlite_sequence(name,seq);
CREATE INDEX idx_maps_map ON maps(map);
CREATE TABLE servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip VARCHAR(21) NOT NULL UNIQUE,
    name TEXT NOT NULL,
    keyword TEXT NOT NULL,
    region TINYINT UNSIGNED NOT NULL,
    map_id INTEGER REFERENCES maps(id),
    visibility TINYINT,
    maxPlayers TINYINT,
    last_online DATETIME,
    banned BOOLEAN NOT NULL DEFAULT 0,
    CONSTRAINT idx_ip UNIQUE (ip)
);
CREATE INDEX idx_servers_server ON servers(ip);
CREATE TABLE server_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    player_count TINYINT UNSIGNED NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(id)
);
CREATE UNIQUE INDEX idx_server_players_unique ON server_players(server_id, timestamp);
CREATE TABLE server_map_hours (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    map_id INTEGER NOT NULL,
    hours REAL NOT NULL,
    date DATE NOT NULL,
    raw_hours REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (server_id) REFERENCES servers(id),
    FOREIGN KEY (map_id) REFERENCES maps(id)
);
CREATE UNIQUE INDEX idx_server_map_hours_unique ON server_map_hours(map_id, server_id, date);
CREATE TABLE blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL UNIQUE,
    reason TEXT NOT NULL,
    FOREIGN KEY (server_id) REFERENCES servers(id)
);
CREATE INDEX idx_blacklist_server ON blacklist(server_id);
CREATE TABLE server_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip VARCHAR(15) NOT NULL UNIQUE,
    long DECIMAL(9,6) NOT NULL,
    lat DECIMAL(9,6) NOT NULL
);
CREATE INDEX idx_server_locations_ip_unique ON server_locations(ip);
CREATE INDEX idx_servers_map ON servers(map_id);
CREATE TABLE sqlite_stat1(tbl,idx,stat);
CREATE INDEX idx_server_last_online ON servers(last_online);
CREATE INDEX idx_blacklist_reason ON blacklist(reason);
CREATE INDEX idx_server_players_active_hours
ON server_players(server_id, timestamp, player_count);
```
