import { defineConfig } from "void/config";

export default defineConfig({
  worker: {
    compatibility_date: "2026-11-01",
    compatibility_flags: ["nodejs_compat"],
  },
  cloudflare: {
    name: "personal-mcp",
    // portal から呼ぶだけなので workers.dev の URL で足りる。独自ドメインにするなら routes を足す
    workers_dev: true,
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: { enabled: true, head_sampling_rate: 1, persist: true, invocation_logs: true },
    },
  },
});
