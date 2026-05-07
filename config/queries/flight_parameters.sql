-- @param entity_id STRING
-- @param parameter STRING
SELECT timestamp, value
FROM main.default.flight_sensor_data
WHERE flight_id = :entity_id AND parameter = :parameter
ORDER BY timestamp ASC
