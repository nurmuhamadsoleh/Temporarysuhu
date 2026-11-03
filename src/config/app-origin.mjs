// Public deployment identity. Credentials remain exclusively in server environment variables.
export const PRODUCTION_ORIGIN = "https://temperatursuhu.bogarasatama.com";
export const GOOGLE_CALLBACK_PATH = "/api/auth/callback/google";
export const PRODUCTION_GOOGLE_CALLBACK_URL = `${PRODUCTION_ORIGIN}${GOOGLE_CALLBACK_PATH}`;
