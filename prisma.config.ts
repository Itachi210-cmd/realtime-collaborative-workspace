import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

// Load environment variables from .env.local and .env
dotenv.config({ path: ".env.local" });
dotenv.config();

const databaseUrl =
  process.env.DIRECT_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@localhost:5432/collab_workspace?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: databaseUrl,
  },
});
