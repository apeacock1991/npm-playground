# npm playground

`npm playground` is a small demo app that lets a user pick an npm package, write code against it, and execute that code inside a Cloudflare Dynamic Worker.

This is intentionally a demo, not a production app.

## What it does

- Serves a simple browser UI from Worker static assets.
- Lets a user choose one of several built-in package examples or type any npm package name.
- Bundles the selected package together with the user's code at runtime using `@cloudflare/worker-bundler`.
- Runs that bundled code inside a Dynamic Worker with outbound network access disabled.
- Returns the execution result and captured console output back to the host Worker and then to the UI.

## How it works

There are two main parts:

1. The host Worker in `src/index.ts`
2. The static UI in `public/`

The host Worker handles `/api/*` routes and serves the UI assets for everything else.

When a user clicks `Run code`, the host Worker:

1. Reads the selected package name, version, and editor contents.
2. Builds a temporary in-memory project containing:
   - the dynamic worker entry module
   - the user's code
   - a generated `package.json` with the chosen dependency
3. Uses `createWorker()` from `@cloudflare/worker-bundler` to compile and bundle that project.
4. Loads the bundle through the Worker Loader binding.
5. Calls a named RPC entrypoint on the Dynamic Worker to execute the code.

The Dynamic Worker does not talk back over HTTP. Instead, the host Worker calls a `Playground` RPC entrypoint directly and receives a structured object containing:

- success or failure
- captured console logs
- the serialized return value
- any execution error details

## Sandbox model

The Dynamic Worker is created with `globalOutbound: null`, which blocks outbound network access from the executed code.

That means user code can use the bundled npm dependency and the Worker runtime, but it cannot freely call the public Internet from inside the Dynamic Worker.

## Notes and limitations

- This is a demo & vibe-coded
- `@cloudflare/worker-bundler` is experimental.
- Only one npm package is injected through the generated `package.json` for each run.
- Returned values are serialized into UI-safe data, so not every complex runtime object will round-trip perfectly.
- This project currently favors simplicity and approachability over strict security hardening or production-grade tenancy controls.

## Local development

Install dependencies:

```bash
npm install
```

Start the app locally:

```bash
npx wrangler dev
```

If you change bindings in `wrangler.jsonc`, regenerate Worker types:

```bash
npx wrangler types
```

## Files of interest

- `src/index.ts`: host Worker API, runtime bundling, Dynamic Worker creation, and RPC execution
- `public/index.html`: app shell
- `public/app.js`: browser behavior
- `public/styles.css`: UI styling
- `wrangler.jsonc`: Worker config, assets binding, and Worker Loader binding
