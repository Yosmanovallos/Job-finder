import type { SourceAdapter } from "../types.js";
import { HttpClient } from "../http/http-client.js";
import { GreenhouseAdapter } from "../greenhouse/greenhouse-adapter.js";
import type { SourceConfig } from "./sources-config.js";

/** Instantiates the adapter for one configured source. */
export function buildAdapter(config: SourceConfig): SourceAdapter {
  switch (config.adapter) {
    case "greenhouse":
      return new GreenhouseAdapter(
        {
          sourceId: config.id,
          boardToken: config.board_token,
          ...(config.company_name === undefined ? {} : { companyName: config.company_name }),
          rateLimitPerMinute: config.rate_limit_per_minute,
          concurrency: config.concurrency
        },
        new HttpClient({ ratePerMinute: config.rate_limit_per_minute })
      );
  }
}
