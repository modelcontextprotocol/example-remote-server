import "dotenv/config";

export const PORT = Number(process.env.PORT) || 3232;

export const BASE_URI =
  process.env.BASE_URI || "https://localhost:3232";
