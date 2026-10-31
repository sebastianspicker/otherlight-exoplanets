# Otherlight alpha: known issues

Thank you for testing Otherlight. This page lists what does not work yet in the
alpha, how to work around it, and how to report problems. It covers the hosted
web app, running the web app on your own computer, and the optional science
service that runs next to it.

Otherlight is a teaching model with stated limits. Neither the Education
simulation nor the Scientific profile is a validated scientific instrument.

## What is not part of this alpha

- **The iPhone, iPad and Mac apps.** They are not ready for testing yet. This
  alpha is the web app only.
- **Real calculations on the hosted web app.** On the hosted site, the
  Scientific profile shows a clearly labelled replay of a stored example. No
  calculation runs there. To run a real calculation, run the web app and the
  science service on your own computer (see the README).
- **Most scientific outputs.** The science service computes the star's radial
  velocity (its motion towards and away from us) and nothing else. Brightness
  modelling, time-scale conversion, relativity, atmospheres and fitting are not
  available yet.

## Known problems and workarounds

### The first Scientific run fails with "contact between 'planet' and 'moon'"

With the default example system and the default run length of 24 hours, the
calculation stops after about 70 minutes because the moon would touch the
planet. The service is right to stop: it refuses physically impossible
systems instead of giving a misleading answer. The Education view hints at this
with a note that the moon's closest approach is inside the planet's tidal limit.

**Workaround:** in the Scientific profile, set **Duration** to 1 hour or less,
or choose a system whose moon stays clear of the planet. Then run the job again.

### Local setup: `corepack: command not found`

Node.js 25 and later no longer include Corepack, which the setup steps use to
install the right pnpm version.

**Workaround:** run `npm install -g corepack` once, then follow the README steps
from `corepack enable` onwards.

### The web app refuses to start, or "Check backend" says the service could not be reached

The science service only accepts requests from the web app on the ports the
README lists (5173 for `pnpm dev`, 4173 for `pnpm preview`). The web app
therefore refuses to start if something else is already using its port, rather
than quietly moving to a different one.

**Workaround:** close the other program that uses the port and start again. If
the science service itself does not start and its terminal says "address
already in use", another program is using port 8765. Close that program as
well; the service cannot move to another port.

### Imported datasets disappear when the service stops

Datasets you import into the science service are kept in memory only. Stopping
or restarting the service clears them.

**Workaround:** keep your original data files and import them again after a
restart.

### Opening a saved workspace resets the clock and the plotted history

A workspace file stores your settings, lesson answers and Scientific request.
It does not store the playback time or the history traced in the plots. After
you open a workspace, the simulation starts again from the beginning. This is
intended for the alpha. The status line says "Workspace restored. Transient
histories and playback time were reset."

### Building from the source release: `pnpm test` stops with a message

The automated test suites are kept private and are not part of the public
source code. In a source checkout, `pnpm test` explains this and exits with an
error. This is expected. The public checks are `pnpm contracts:check` and
`pnpm ci:verify`.

## How to report a bug

Please open an issue at
<https://github.com/sebastianspicker/otherlight-exoplanets/issues/new/choose>
and pick **Bug report**. The form asks for everything below; the first two items
help most.

1. **The build line from the page footer**, for example
   `0.2.0-alpha.1 · build 1a2b3c4d5e6f`. It tells us exactly which version you
   used.
2. **What you did, what happened, and what you expected.** Name the profile
   (Education or Scientific), the view (Simulation or Guided Labs), the example
   system, and any settings you changed.
3. **A screenshot or a short screen recording.**
4. **Your browser and operating system**, with versions.
5. **The browser console.** Open your browser's developer tools, choose the
   **Console** tab, and copy any red error lines.
6. **For Scientific problems:** the exact message on the Scientific status line
   and the output of the terminal where the science service runs. If the
   message contains a request id (12 letters and digits), include it; it points
   us to the matching line in the service output.
7. **For problems with saved work:** the `.otherlight` workspace file, if you
   are happy to share it.
8. **If you run the app on your own computer:** the output of `node -v`,
   `pnpm -v` and `python3 --version`.

Please remove personal information, private file paths and unpublished data
before you attach anything. To report a security problem, do not open a public
issue; follow the security policy in the repository instead.
