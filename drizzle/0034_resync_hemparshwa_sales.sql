-- Sales lines used to belong to whichever import synced last, so an older export could take back lines
-- a newer one also has, and "the newest export wins" then missed the older export's leftovers. The sync
-- now keeps each line with the newest import that has it; this makes every sales import sync again so
-- the lines already copied get the right owner.
UPDATE hemparshwa_imports SET version = 'resync-0034' WHERE data_type = 'sales';
