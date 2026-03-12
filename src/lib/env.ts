export type AppEnvironment = "development" | "staging" | "production";

function normalizeAppEnvironment(value: string | undefined | null): AppEnvironment {
  const normalized = (value ?? "").trim().toLowerCase();

  switch (normalized) {
    case "prod":
    case "production":
      return "production";
    case "stage":
    case "staging":
      return "staging";
    default:
      return "development";
  }
}

export function getServerAppEnvironment(): AppEnvironment {
  return normalizeAppEnvironment(
    process.env.APP_ENV ?? process.env.NEXT_PUBLIC_APP_ENV ?? process.env.NODE_ENV,
  );
}
