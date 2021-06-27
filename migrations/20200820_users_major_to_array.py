from mongodb_migrations.base import BaseMigration
from titlecase import titlecase

class Migration(BaseMigration):
    def upgrade(self):
        for u in self.db.users.find():
            u['major'] = list(map(lambda s: titlecase(s.strip()), u['major'].split(';')))
            self.db.users.save(u)

    def downgrade(self):
        for u in self.db.users.find():
            u['major'] = u['major'].join(';')
            self.db.users.save(u)
