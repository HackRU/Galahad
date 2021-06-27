import config
from mongodb_migrations.cli import MigrationManager

mgr = MigrationManager()
mgr.config.mongo_url = config.DB_URI
mgr.config.metastore = 'migrations'
mgr.run()
