declare module "@agent-native/db-convex" {
  export function createConvexDb(options?: {
    convexUrl?: string;
    transport?: unknown;
    componentName?: string;
    adminAuth?: string;
  }): unknown;
  export function isConvexDatabaseUrl(url: string): boolean;
  export function setConvexDbTestTransport(transport: unknown): void;
}
