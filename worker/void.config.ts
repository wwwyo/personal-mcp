import { defineConfig } from "void/config";

export default defineConfig({
  worker: {
    compatibility_date: "2026-11-01",
    compatibility_flags: ["nodejs_compat"],
  },
  cloudflare: {
    name: "personal-mcp",
    // portal から呼ぶだけなので workers.dev の URL で足りる。独自ドメインにするなら routes を足す。
    // routes と preview_urls も明示する。省くと Void は今の設定を引き継ごうとし、直前の version が
    // secret の更新などで Void の記録を持たないとデプロイを止める（traffic-preservation-unavailable）。
    // preview_urls は workers_dev を有効にしたときの既定値（true）と同じで、Void は切り替え前に preview で readiness を確かめる。
    workers_dev: true,
    routes: [],
    preview_urls: true,
    observability: {
      enabled: true,
      head_sampling_rate: 1,
      logs: { enabled: true, head_sampling_rate: 1, persist: true, invocation_logs: true },
    },
  },
});
