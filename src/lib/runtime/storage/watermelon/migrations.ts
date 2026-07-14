import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

export const myMigrations = schemaMigrations({
  migrations: [
    // Define future migrations here
    // {
    //   toVersion: 2,
    //   steps: [
    //     // createTable, addColumns, etc.
    //   ],
    // },
  ],
});
