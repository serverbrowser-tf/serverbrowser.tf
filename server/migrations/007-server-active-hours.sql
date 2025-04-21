CREATE INDEX idx_server_players_active_hours
ON server_players(server_id, timestamp, player_count);
