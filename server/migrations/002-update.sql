CREATE TABLE server_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip VARCHAR(15) NOT NULL UNIQUE,
    long DECIMAL(9,6) NOT NULL,
    lat DECIMAL(9,6) NOT NULL
);
CREATE INDEX idx_server_locations_ip_unique ON server_locations(ip);

