INSERT INTO app_setting(key, value) VALUES ('alert_cooldown_minutes', '30') ON CONFLICT DO NOTHING;
