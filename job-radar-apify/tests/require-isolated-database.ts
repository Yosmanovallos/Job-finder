import "./require-test-environment.js";

if (process.env.JOB_RADAR_TEST_MODE !== "integration") {
  throw new Error("[P0] Esta prueba requiere PostgreSQL desechable. Usa npm run test:integration.");
}
