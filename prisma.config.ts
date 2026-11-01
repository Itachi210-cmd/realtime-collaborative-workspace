import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Load environment variables from .env.local and .env
dotenv.config({ path: ".env.local" });
dotenv.config();

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/collab_workspace?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
