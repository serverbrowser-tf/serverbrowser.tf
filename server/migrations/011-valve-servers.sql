ALTER TABLE servers
ADD COLUMN is_valve INTEGER NOT NULL DEFAULT 0;

UPDATE servers
SET is_valve = 1
WHERE INSTR(LOWER(keyword), 'valve') > 0
  AND INSTR(LOWER(keyword), 'hidden') > 0
  AND LOWER(name) LIKE 'valve matchmaking server%';

CREATE INDEX idx_servers_is_valve ON servers(is_valve);
