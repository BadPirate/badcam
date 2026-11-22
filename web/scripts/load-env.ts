// Loads ./.env when present (Node 24 built-in); real environment variables win.
try {
  process.loadEnvFile(".env")
} catch {
  // no .env file
}
