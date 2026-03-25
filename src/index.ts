import { createWorker } from "@cloudflare/worker-bundler";

const COMPATIBILITY_DATE = "2026-03-24";
const CACHE_VERSION = "2026-03-24-v1";
const DEFAULT_PACKAGE_VERSION = "latest";
const DEFAULT_BLANK_CODE = `// Import from the package name entered above.
// Example:
// import { kebabCase } from "lodash-es";

return {
  message: "npm playground is ready",
};`;

type SampleDefinition = {
  id: string;
  title: string;
  description: string;
  packageName: string;
  packageVersion: string;
  code: string;
};

type PlaygroundRequest = {
  packageName?: unknown;
  packageVersion?: unknown;
  code?: unknown;
};

type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

type WorkerCode = {
  compatibilityDate: string;
  compatibilityFlags?: string[];
  mainModule: string;
  modules: Record<string, string | { js?: string; cjs?: string; json?: object }>;
  globalOutbound: null;
};

type WorkerEntrypoint = {
  fetch(request: Request): Promise<Response>;
};

type PlaygroundExecutionPayload = {
  ok: boolean;
  phase: "execute";
  logs: Array<{ level: string; message: string }>;
  result?: { kind: string; value: unknown };
  error?: { name: string; message: string; stack: string };
};

type PlaygroundRpcEntrypoint = {
  execute(): Promise<PlaygroundExecutionPayload>;
};

type WorkerStub = {
  getEntrypoint<T = WorkerEntrypoint>(name?: string): T;
};

type WorkerLoaderBinding = {
  get(id: string, callback: () => Promise<WorkerCode>): WorkerStub;
};

interface Env {
  ASSETS: AssetFetcher;
  LOADER: WorkerLoaderBinding;
}

const SAMPLE_DEFINITIONS: SampleDefinition[] = [
  {
    id: "lodash-es",
    title: "Clean up strings with lodash-es",
    description: "Use a few utility helpers to shape and normalize data quickly.",
    packageName: "lodash-es",
    packageVersion: DEFAULT_PACKAGE_VERSION,
    code: `import { kebabCase, startCase, words } from "lodash-es";

const title = "Cloudflare Dynamic Workers make package demos easy";

return {
  kebab: kebabCase(title),
  startCase: startCase(title),
  words: words(title),
};`,
  },
  {
    id: "date-fns",
    title: "Format dates with date-fns",
    description: "Turn raw dates into readable strings and quick relative summaries.",
    packageName: "date-fns",
    packageVersion: DEFAULT_PACKAGE_VERSION,
    code: `import { format, formatDistance, formatISO } from "date-fns";

const now = new Date();
const launchDate = new Date("2026-04-15T09:30:00Z");

return {
  iso: formatISO(now),
  friendly: format(now, "EEEE, MMMM do yyyy 'at' HH:mm 'UTC'"),
  untilLaunch: formatDistance(launchDate, now, { addSuffix: true }),
};`,
  },
  {
    id: "zod",
    title: "Validate data with zod",
    description: "Parse unknown input into a strongly shaped result.",
    packageName: "zod",
    packageVersion: DEFAULT_PACKAGE_VERSION,
    code: `import { z } from "zod";

const User = z.object({
  id: z.string().uuid(),
  name: z.string().min(2),
  email: z.string().email(),
});

const parsed = User.parse({
  id: "123e4567-e89b-12d3-a456-426614174000",
  name: "Ashley",
  email: "ashley@example.com",
});

return parsed;`,
  },
  {
    id: "nanoid",
    title: "Generate IDs with nanoid",
    description: "Create lightweight unique IDs and custom alphabets.",
    packageName: "nanoid",
    packageVersion: DEFAULT_PACKAGE_VERSION,
    code: `import { customAlphabet, nanoid } from "nanoid";

const inviteId = nanoid();
const shortId = customAlphabet("play123", 8)();

return {
  inviteId,
  shortId,
};`,
  },
  {
    id: "marked",
    title: "Render Markdown with marked",
    description: "Convert Markdown into HTML and inspect the output structure.",
    packageName: "marked",
    packageVersion: DEFAULT_PACKAGE_VERSION,
    code: `import { marked } from "marked";

const markdown = [
  "# npm playground",
  "",
  "- Run real npm packages in a Dynamic Worker",
  "- Keep outbound network access blocked",
  "- Return structured results to the UI",
].join("\\n");

return {
  html: marked.parse(markdown),
};`,
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env, url);
    }

    return new Response(null, { status: 404 });
  },
};

async function handleApiRequest(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method === "GET" && url.pathname === "/api/samples") {
    return jsonResponse({
      blankStarter: DEFAULT_BLANK_CODE,
      samples: SAMPLE_DEFINITIONS,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/run") {
    return runPlayground(request, env);
  }

  return jsonResponse(
    {
      ok: false,
      error: {
        message: `No API route matches ${request.method} ${url.pathname}.`,
      },
    },
    404,
  );
}

async function runPlayground(request: Request, env: Env): Promise<Response> {
  let body: PlaygroundRequest;

  try {
    body = (await request.json()) as PlaygroundRequest;
  } catch {
    return jsonResponse(
      {
        ok: false,
        error: {
          message: "Request body must be valid JSON.",
        },
      },
      400,
    );
  }

  const packageName = normalizeText(body.packageName);
  const packageVersion = normalizeText(body.packageVersion) || DEFAULT_PACKAGE_VERSION;
  const code = normalizeText(body.code);

  if (!packageName) {
    return jsonResponse(
      {
        ok: false,
        error: {
          message: "Choose an npm package before running code.",
        },
      },
      400,
    );
  }

  if (!isSafePackageName(packageName)) {
    return jsonResponse(
      {
        ok: false,
        error: {
          message: "The npm package name is not valid.",
        },
      },
      400,
    );
  }

  if (!code) {
    return jsonResponse(
      {
        ok: false,
        error: {
          message: "Add code to the editor before running it.",
        },
      },
      400,
    );
  }

  const workerId = await hashText(
    JSON.stringify({
      cacheVersion: CACHE_VERSION,
      code,
      packageName,
      packageVersion,
    }),
  );

  let bundleWarnings: string[] = [];

  try {
    const worker = env.LOADER.get(workerId, async () => {
      const bundle = await createWorker({
        files: buildDynamicWorkerFiles(packageName, packageVersion, code),
        entryPoint: "src/index.ts",
        sourcemap: true,
      });

      bundleWarnings = bundle.warnings ?? [];

      return {
        compatibilityDate: COMPATIBILITY_DATE,
        compatibilityFlags: ["nodejs_compat"],
        mainModule: bundle.mainModule,
        modules: bundle.modules,
        globalOutbound: null,
      };
    });

    const startedAt = Date.now();
    const payload = await worker.getEntrypoint<PlaygroundRpcEntrypoint>("Playground").execute();

    return jsonResponse({
      ...payload,
      bundleWarnings,
      durationMs: Date.now() - startedAt,
      packageName,
      packageVersion,
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      phase: "bundle",
      packageName,
      packageVersion,
      bundleWarnings,
      error: formatError(error),
    });
  }
}

function buildDynamicWorkerFiles(
  packageName: string,
  packageVersion: string,
  userCode: string,
): Record<string, string> {
  return {
    "src/index.ts": createDynamicWorkerEntry(),
    "src/playground.ts": createPlaygroundModule(userCode),
    "package.json": JSON.stringify(
      {
        name: "npm-playground-session",
        private: true,
        type: "module",
        dependencies: {
          [packageName]: packageVersion,
        },
      },
      null,
      2,
    ),
  };
}

function createDynamicWorkerEntry(): string {
  return `import { WorkerEntrypoint } from "cloudflare:workers";
import userRun from "./playground";

const originalConsole = globalThis.console;

function serializeError(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? "",
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: "",
  };
}

function serializeValue(value) {
  if (value === undefined) {
    return { kind: "undefined", value: null };
  }

  if (value === null) {
    return { kind: "null", value: null };
  }

  if (value instanceof Response) {
    return {
      kind: "response",
      value: {
        status: value.status,
        statusText: value.statusText,
        headers: Object.fromEntries(value.headers.entries()),
      },
    };
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { kind: typeof value, value };
  }

  try {
    return {
      kind: "json",
      value: JSON.parse(
        JSON.stringify(value, (_key, nestedValue) =>
          typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
        ),
      ),
    };
  } catch {
    return {
      kind: "inspect",
      value: String(value),
    };
  }
}

function stringifyArgs(args) {
  return args
    .map((value) => {
      if (typeof value === "string") {
        return value;
      }

      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

function createCapturedConsole(logs) {
  return {
    ...originalConsole,
    log: (...args) => logs.push({ level: "log", message: stringifyArgs(args) }),
    info: (...args) => logs.push({ level: "info", message: stringifyArgs(args) }),
    warn: (...args) => logs.push({ level: "warn", message: stringifyArgs(args) }),
    error: (...args) => logs.push({ level: "error", message: stringifyArgs(args) }),
    debug: (...args) => logs.push({ level: "debug", message: stringifyArgs(args) }),
  };
}

export class Playground extends WorkerEntrypoint {
  async execute() {
    const logs = [];

    try {
      globalThis.console = createCapturedConsole(logs);

      if (typeof userRun !== "function") {
        return {
          ok: false,
          phase: "execute",
          logs,
          error: {
            name: "InvalidEntryPoint",
            message:
              "Your code must be plain module code or export a default function.",
            stack: "",
          },
        };
      }

      const result = await userRun();

      return {
        ok: true,
        phase: "execute",
        logs,
        result: serializeValue(result),
      };
    } catch (error) {
      return {
        ok: false,
        phase: "execute",
        logs,
        error: serializeError(error),
      };
    } finally {
      globalThis.console = originalConsole;
    }
  }
}`;
}

function createPlaygroundModule(userCode: string): string {
  if (/\bexport\s+default\b/.test(userCode)) {
    return userCode;
  }

  const { importSection, bodySection } = splitTopLevelImports(userCode);
  const trimmedBody = bodySection.trim();
  const indentedBody = trimmedBody ? indentCode(trimmedBody, 2) : "  return undefined;";

  return `${importSection}${importSection ? "\n\n" : ""}export default async function run() {
${indentedBody}
}`;
}

function splitTopLevelImports(code: string): { importSection: string; bodySection: string } {
  const lines = code.split("\n");
  const importLines: string[] = [];
  let lineIndex = 0;
  let seenImport = false;

  while (lineIndex < lines.length) {
    const currentLine = lines[lineIndex];
    const trimmedLine = currentLine.trim();

    if (!trimmedLine) {
      if (!seenImport) {
        importLines.push(currentLine);
        lineIndex += 1;
        continue;
      }

      const nextLine = lines[lineIndex + 1]?.trim() ?? "";
      if (nextLine.startsWith("import ")) {
        importLines.push(currentLine);
        lineIndex += 1;
        continue;
      }

      break;
    }

    if (trimmedLine.startsWith("//") || trimmedLine.startsWith("/*") || trimmedLine.startsWith("*")) {
      if (!seenImport) {
        importLines.push(currentLine);
        lineIndex += 1;
        continue;
      }

      break;
    }

    if (!trimmedLine.startsWith("import ")) {
      break;
    }

    seenImport = true;

    do {
      importLines.push(lines[lineIndex] ?? "");
      lineIndex += 1;
    } while (lineIndex < lines.length && !isImportStatementComplete(lines[lineIndex - 1] ?? ""));
  }

  return {
    importSection: importLines.join("\n").trim(),
    bodySection: lines.slice(lineIndex).join("\n"),
  };
}

function isImportStatementComplete(line: string): boolean {
  const trimmedLine = line.trim();

  return (
    /^import\s+["'][^"']+["'];?$/.test(trimmedLine) ||
    /from\s+["'][^"']+["'];?$/.test(trimmedLine)
  );
}

function indentCode(code: string, spaces: number): string {
  const indent = " ".repeat(spaces);
  return code
    .split("\n")
    .map((line) => (line ? `${indent}${line}` : ""))
    .join("\n");
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isSafePackageName(packageName: string): boolean {
  return /^(?:@[\w.-]+\/)?[\w.-]+$/.test(packageName);
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
    },
  });
}

function formatError(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? "",
    };
  }

  return {
    name: "Error",
    message: String(error),
    stack: "",
  };
}

async function hashText(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

