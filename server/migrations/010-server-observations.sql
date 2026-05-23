CREATE TABLE server_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL REFERENCES servers (id),
  map_id INTEGER REFERENCES maps (id),
  observed_at INTEGER NOT NULL,
  players INTEGER NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX idx_server_observations_server_observed_at ON server_observations (server_id, observed_at);

CREATE INDEX idx_server_observations_map_observed_at ON server_observations (map_id, observed_at);

CREATE INDEX idx_server_observations_observed_at ON server_observations (observed_at);
