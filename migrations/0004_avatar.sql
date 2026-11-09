ALTER TABLE listings ADD COLUMN avatar_key TEXT;      -- R2 key of the generated map avatar (PNG w/ transparency)
ALTER TABLE listings ADD COLUMN avatar_style TEXT;    -- 'cutout' | 'ai'
