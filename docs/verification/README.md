# Isolated verification

Use an isolated fixture for server and conversation verification. Never send test mutations to a server discovered on the user's machine, or use the user's live data and accounts.

## Fixture

`scripts/control-omb.ts` provides `launchVerificationServer` for tests and verification scripts. It creates a temporary data directory and configuration, starts a loopback server with a fake engine, and removes the temporary directory when `close()` completes. Use `try`/`finally` to close it, including when an assertion fails. `server/verification-fixture.e2e.test.ts` checks the starter and engine discovery; run it when changing fixture isolation.

For manual headless verification, `node --experimental-strip-types scripts/control-omb.ts launch` owns an isolated fake-engine server until interrupted. Use only the URL returned by that launch for test operations. Existing examples include `scripts/verify-threads.ts` and `scripts/verify-routines.ts`.

The fixture sets a temporary home and a restricted executable search path. These do **not** by themselves block all network traffic or absolute executable paths. The programmatic launcher supports `loopbackOnlyFetch` for tests that need it; this restricts the fixture server's `fetch`, not every possible subprocess or network API. Use loopback stand-ins and inspect any explicit provider, browser, VM, or network options before launching. Do not pass real tokens or live service endpoints into test fixtures.

## Evidence

Choose checks that exercise the changed behavior, including failure and authorization paths where relevant. For a conversation change, distinguish a fake-engine fixture result from a real model call; for integrations, distinguish a loopback stand-in from a real service. Record the commands, results, platform, and any untested UI or third-party behavior. A unit test alone does not establish that a real conversation or integration works.
