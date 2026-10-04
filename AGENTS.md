# Verification

Run `npm test` and `npm run test:playwright` for affected host changes. Native/private API changes also require the live smoke test on an explicitly owned simulator and real rendered-outcome checks; report unsupported or blocked runtimes honestly. Keep README usage runnable and short.

# Simulator ownership

Use an explicit booted UDID, one worker per simulator, and prepare before connecting UI drivers. Preserve unrelated widgets/icons. Release in `finally`, including setup failures. Stop only owned helpers and devices; never restart global simulator services.
