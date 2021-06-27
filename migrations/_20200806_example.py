from mongodb_migrations.base import BaseMigration

class Migration(BaseMigration):
    def upgrade(self):
        for i in self.db.some_collection.find():
            item['new_column'] = 'new_value'
            self.db.some_collection.save(item)

    def downgrade(self):
        self.db.some_collection.update_many({}, {"$unset": {"new_column": ""}})
