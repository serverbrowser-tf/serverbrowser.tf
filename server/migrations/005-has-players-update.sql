CREATE INDEX idx_blacklist_reason ON blacklist(reason);

UPDATE servers
SET map_id = (
    SELECT map_id
    FROM server_map_hours
    WHERE server_map_hours.server_id = servers.id
    ORDER BY id DESC
    LIMIT 1
)
WHERE map_id IS NULL;
