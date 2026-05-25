CREATE INDEX IF NOT EXISTS idx_server_map_hours_server_date_map
ON server_map_hours(server_id, date, map_id);

CREATE INDEX IF NOT EXISTS idx_server_map_hours_server_id_map_hours
ON server_map_hours(server_id, id, map_id, hours);

CREATE INDEX IF NOT EXISTS idx_servers_is_valve_last_online_id
ON servers(is_valve, last_online, id);
