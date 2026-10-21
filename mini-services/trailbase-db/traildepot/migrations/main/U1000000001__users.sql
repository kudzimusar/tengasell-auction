-- Tengasell users: admin + 16 marketplace personas.
-- Password for every demo account: Tengasell#2025
-- NOTE: TrailBase usernames are alphanumeric-only.
INSERT INTO _user (id, email, username, password_hash, verified, admin)
VALUES
  (uuid_v4(), 'admin@tengasell.com',      'admin',      (hash_password('Tengasell#2025')), TRUE, TRUE),
  (uuid_v4(), 'takudzwa@tengasell.com',   'takudzwa',   (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'nyasha@tengasell.com',     'nyasha',     (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'rufaro@tengasell.com',     'rufaro',     (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'blessing@tengasell.com',   'blessing',   (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'kudzai@tengasell.com',     'kudzai',     (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'tatenda@tengasell.com',    'tatenda',    (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'tendai@tengasell.com',     'tendai',     (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'chipo@tengasell.com',      'chipo',      (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'farai@tengasell.com',      'farai',      (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'simba@tengasell.com',      'simba',      (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'anesu@tengasell.com',      'anesu',      (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'mukudzei@tengasell.com',   'mukudzei',   (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'shamiso@tengasell.com',    'shamiso',    (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'panashe@tengasell.com',    'panashe',    (hash_password('Tengasell#2025')), TRUE, FALSE),
  (uuid_v4(), 'ruvarashe@tengasell.com',  'ruvarashe',  (hash_password('Tengasell#2025')), TRUE, FALSE);
