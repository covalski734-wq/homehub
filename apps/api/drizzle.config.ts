import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'sqlite',
  schema: [
    './src/db/schema.ts',
    './src/db/planner-schema.ts',
    './src/db/settings-schema.ts',
    './src/db/chores-schema.ts',
    './src/db/savings-schema.ts',
    './src/db/members-schema.ts',
    './src/db/access-schema.ts',
  ],
  out: './migrations',
});
