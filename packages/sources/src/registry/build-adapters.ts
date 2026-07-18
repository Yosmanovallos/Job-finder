import type { SourceAdapter } from "../types.js";
import { HttpClient } from "../http/http-client.js";
import { GreenhouseAdapter } from "../greenhouse/greenhouse-adapter.js";
import { LeverAdapter } from "../lever/lever-adapter.js";
import type { SourceConfig } from "./sources-config.js";

/** Instantiates the adapter for one configured source. */
export function buildAdapter(config: SourceConfig): SourceAdapter {
  const http = new HttpClient({ ratePerMinute: config.rate_limit_per_minute });
  const common = {
    sourceId: config.id,
    ...(config.company_name === undefined ? {} : { companyName: config.company_name }),
    rateLimitPerMinute: config.rate_limit_per_minute,
    concurrency: config.concurrency
  };
  switch (config.adapter) {
    case "greenhouse":
      return new GreenhouseAdapter({ ...common, boardToken: config.board_token }, http);
    case "lever":
      return new LeverAdapter({ ...common, site: config.board_token }, http);
  }
}
