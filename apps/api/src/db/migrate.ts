import { migrateDatabase } from "./postgres";

await migrateDatabase();
console.log("Postgres migration completed");
