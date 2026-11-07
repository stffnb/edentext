# Security policy

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's
**Security** tab and choose **Report a vulnerability**. Please don't open a public issue
for them.

A useful report names the version (About EdenText, or `ready`'s `version` in embed
mode), the browser or desktop build, and a file or steps that reproduce the problem.
You will get an answer within two weeks. Fixes go into the next release, and the
changelog credits the reporter unless you prefer otherwise.

## Supported versions

Only the latest release gets security fixes. EdenText is in beta and releases often, so
updating is the fix.

## Scope

EdenText runs entirely in the browser or in its Electron shell; there is no EdenText
server. Things worth reporting:

- a document, a paste or a model answer that runs script, loads remote content, or
  reaches CSS or HTML unchecked;
- a file that makes the importer use unbounded memory or time;
- a page that can drive an embedded editor or read its document without being its host
  (`docs/architecture/embed.md`);
- the desktop app reading or writing files it was not given, or running code outside the
  page;
- the AI assistant sending document text anywhere other than the endpoint the user set.

What the user configures themselves (an AI provider, a key stored in the browser) is
documented behaviour, see `docs/architecture/ai.md`.
