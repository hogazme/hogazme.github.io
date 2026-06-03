CREATE TABLE player_positions (
    id SERIAL PRIMARY KEY,
    player_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    position_x INT NOT NULL,
    position_y INT NOT NULL
);

