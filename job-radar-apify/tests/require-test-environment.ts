import net from "node:net";
import { syncBuiltinESMExports } from "node:module";
import dotenv from "dotenv";
import { Pool } from "pg";
import { assertTestConnection, validateTestEnvironment } from "./test-safety.js";

const environment = Object.freeze({ ...process.env });
validateTestEnvironment(environment, process.cwd());
dotenv.config = () => ({ parsed: {} });
dotenv.configDotenv = () => ({ parsed: {} });

const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const target = normalized[0];
  const options = typeof target === "object" && target !== null
    ? target as { host?: unknown; port?: unknown }
    : { port: target, host: normalized[1] };
  assertTestConnection(options.host, options.port, environment);
  return Reflect.apply(originalConnect, this, args);
} as typeof originalConnect;

const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (this: net.Server, ...args: unknown[]) {
  const target = args[0];
  const options = typeof target === "object" && target !== null
    ? target as { port?: unknown }
    : { port: target };
  if (environment.JOB_RADAR_TEST_MODE !== "integration" || String(options.port) !== environment.TEST_HTTP_PORT) {
    throw new Error("[P0] El servidor de prueba solo puede escuchar en su puerto asignado.");
  }
  return Reflect.apply(originalListen, this, [
    { port: Number(options.port), host: "127.0.0.1" }, ...args.filter((arg) => typeof arg === "function")
  ]);
} as typeof originalListen;
syncBuiltinESMExports();

if (environment.JOB_RADAR_TEST_MODE === "integration") {
  const client = new Pool({ connectionString: environment.TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 3000 });
  try {
    const result = await client.query("SELECT run_id FROM test_sandbox WHERE run_id = $1", [environment.JOB_RADAR_TEST_RUN]);
    if (result.rowCount !== 1) throw new Error("marker mismatch");
  } catch {
    throw new Error("[P0] La base no pertenece a esta ejecución desechable. No se iniciaron las pruebas.");
  } finally {
    await client.end();
  }
}
