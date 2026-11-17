# Flaky journeys

A journey that fails only under load, a few runs in a hundred, as #85's did. Every journey shares one Deployment, so `bun run test:e2e:stress` is where they show.

1. **Loop it alone.** `bunx playwright test <file> -g "<title>" --project=desktop --repeat-each=128 --workers=16` takes about 25 seconds, and a race failing one run in twenty shows several times in each. Each failure keeps its own folder under `test-results/`.
2. **Log what the journey read, from a throwaway spec.** A trace holds each call and the page, not what `boundingBox()` or `evaluate()` returned, so a value read off the page is seen only by logging it. Log too whether the element seen a moment before is still attached (`elementHandle()`, then `isConnected`): one that is not was replaced, and what replaced it is the lead.
3. **Count it on every load.** A race that fails on timing usually happens on every load, and only the journey's timing varies. Count the event from a `MutationObserver` set up in `page.addInitScript`, as the main-screen journey counts each column's mounts: the count is red on every run, in seconds, and becomes the regression journey once the fix is in.
