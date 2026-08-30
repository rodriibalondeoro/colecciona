-- ============================================
-- SEED: PRODUCTOS DEMO PARA COLECCIONA
-- Pegar en Supabase → SQL Editor → Run
-- ============================================

-- Ejecuta esto directo, busca un usuario automáticamente:
DO $$
DECLARE
  uid UUID;
BEGIN
  SELECT id INTO uid FROM users LIMIT 1;

  IF uid IS NULL THEN
    RAISE NOTICE 'No hay usuarios en la tabla users. Crea uno primero desde la app.';
    RETURN;
  END IF;

  INSERT INTO products (title, price, image, category, condition, seller, code, rarity, description, "set", language, year, views, favorites, created_at)
  VALUES
    ('Charizard Holo 1ª Edición', 150.00, '/images/cards/fire-phoenix.png', 'liga-este-26-27', 'LP', uid, 'BS-004', 'Holo Secret', 'Carta mítica del Base Set original de 1999.', 'Base Set (1999)', 'Español', 1999, 342, 45, '2024-03-01T10:00:00Z'),
    ('Voltron Raikou Fox Secret', 25.00, '/images/cards/electric-fox.png', 'liga-este-26-27', 'NM', uid, 'PKM-042', 'Illustration Rare', 'Edición limitada promo de torneo.', 'Crown Zenith', 'Japonés', 2023, 85, 8, '2024-03-12T16:45:00Z'),
    ('Raichu Base Set Holo', 42.00, '/images/cards/electric-fox.png', 'liga-este-26-27', 'LP', uid, 'BS-058', 'Holo', 'Holo del Base Set en estado ligero.', 'Base Set (1999)', 'Español', 1999, 132, 18, '2024-04-09T10:15:00Z'),
    ('Pikachu VMAX Alt Art', 78.00, '/images/cards/electric-fox.png', 'megacracks-26-27', 'NM', uid, 'PKM-201', 'Secret Rare', 'Full art alternativa con textura holográfica.', 'Evolving Skies', 'Japonés', 2021, 290, 54, '2024-04-01T09:00:00Z'),
    ('Aethelred Celestial Dragon', 95.50, '/images/cards/dragon.png', 'champions-stickers-26-27', 'PSA10', uid, 'MTG-001', 'Mythic Rare', 'Gradada PSA 10 Gem Mint.', 'Cosmic Legends', 'Inglés', 2023, 512, 89, '2024-03-05T14:30:00Z'),
    ('Blue-Eyes White Dragon LOB', 220.00, '/images/cards/water-serpent.png', 'match-attax-ufa-26-27', 'LP', uid, 'LOB-001', 'Ultra Rare', 'Edición original Legend of Blue Eyes.', 'Legend of Blue Eyes', 'Inglés', 2002, 445, 78, '2024-04-03T14:20:00Z'),
    ('Leviathan Tides Alt Art', 45.00, '/images/cards/water-serpent.png', 'prizm-nba', 'NM', uid, 'LOB-002', 'Ultra Rare', 'Estado Near Mint imprevisto.', 'Legend of Blue Eyes', 'Japonés', 2022, 120, 15, '2024-03-10T09:15:00Z'),
    ('Nightshade Dark Legendary', 55.00, '/images/cards/shadow-wolf.png', 'prizm-nba', 'NM', uid, 'MFC-000', 'Secret Rare 1st Ed', '1ª Edición en impecable estado.', 'Magician''s Force', 'Inglés', 2003, 150, 22, '2024-03-18T15:30:00Z'),
    ('Shadow Wolf Luna Shade', 120.00, '/images/cards/shadow-wolf.png', 'marvel-verse', 'NM', uid, 'OP01-016', 'Manga Rare (SEC)', 'Manga Rare Ultra exclusiva.', 'Romance Dawn OP-01', 'Inglés', 2022, 256, 62, '2024-03-14T11:20:00Z'),
    ('Ignis Phoenix Secret Rare', 85.00, '/images/cards/fire-phoenix.png', 'chrome-marvel', 'LP', uid, 'DBS-108', 'Secret Rare', 'Secret Rare con estampado metálico.', 'Tournament of Power', 'Inglés', 2018, 190, 30, '2024-03-15T08:00:00Z'),
    ('Luffy Gear 5 Secret', 195.00, '/images/cards/shadow-wolf.png', 'super-mario', 'PSA10', uid, 'OP06-SEC', 'Secret Rare', 'Carta gradada PSA 10 del Gear 5.', 'Paramount War OP-06', 'Japonés', 2024, 612, 105, '2024-04-05T11:00:00Z'),
    ('Colección Premium Set', 140.00, '/images/cards/collection.png', 'prizm-nfl', 'MP', uid, 'SET-999', 'Collector Pack', 'Lote de 6 cartas raras.', 'Edición Especial', 'Español', 2021, 420, 75, '2024-03-16T12:00:00Z'),
    ('Black Star promo Mew', 35.00, '/images/cards/fire-phoenix.png', 'wc2026-adrenalyn', 'NM', uid, 'PKM-WOTC', 'Holo', 'Promo WOTC de Mew.', 'Wizards Promo', 'Español', 1999, 178, 29, '2024-04-07T16:30:00Z');

  RAISE NOTICE '13 productos insertados correctamente';
END $$;
