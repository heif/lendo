-- Pricing suggestions: per-category rules (editable in /admin/pricing) + global settings.
CREATE TABLE price_rules (
  category TEXT PRIMARY KEY,        -- slug, e.g. 'power_tools'
  label TEXT NOT NULL,
  day_cents INTEGER NOT NULL,       -- typical day price when retail value is unknown
  rate_pct REAL NOT NULL DEFAULT 3, -- day price as % of retail value (when known)
  week_pct REAL NOT NULL DEFAULT 70 -- week price as % of 7 days
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings (key, value) VALUES ('price_min_cents', '800'), ('price_max_cents', '15000'), ('price_round_to', '100'), ('vision_model', '@cf/llava-hf/llava-1.5-7b-hf');
INSERT INTO price_rules (category, label, day_cents, rate_pct, week_pct) VALUES
 ('power_tools','Power tools',800,3,70), ('hand_tools','Hand tools & toolkits',800,3,70), ('ladders','Ladders & step stools',900,3,70), ('cleaning','Cleaning & pressure washers',1800,3,70),
 ('camping','Camping & outdoors',1500,2.5,70), ('sports','Sports & fitness',1200,2.5,70), ('bikes','Bikes & scooters',2000,2,70), ('water','Kayaks, paddleboards & water',3500,2,70), ('winter','Skis, snowboards & winter',2000,2,70),
 ('av','Projectors, speakers & AV',1500,2.5,70), ('cameras','Cameras & lenses',2500,2,70), ('gaming','Games, consoles & VR',1200,2,70), ('music','Instruments & music gear',1200,2,70),
 ('kitchen','Kitchen & appliances',1000,3,70), ('party','Party & events',1500,3,70), ('furniture','Furniture',1500,1.5,70), ('baby','Baby & kids gear',1000,3,70), ('luggage','Luggage & travel',800,3,70),
 ('fashion','Clothing & accessories',1500,2,70), ('pets','Pet gear',800,3,70), ('garden','Garden & yard',1000,3,70), ('electronics','Electronics & office',1200,2,70), ('mobility','Mobility & medical',1000,3,70), ('other','Everything else',1000,3,70);
