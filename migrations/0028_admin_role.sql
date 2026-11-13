-- admin access granted by the owner at /admin/access: 'view' (see everything, change nothing) or 'full' (everything except granting access)
ALTER TABLE users ADD COLUMN admin_role TEXT;
