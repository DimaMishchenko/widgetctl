# Privacy

Widgetctl runs locally on your Mac. The CLI, MCP server and library do not include analytics, telemetry, a hosted service or an account system. They read Simulator app metadata, widget identities and configuration, and use local Xcode tools and a simulator helper to perform the operations you request.

Widget configuration can contain personal app data. Exported JSON, screenshots, verification reports and terminal output can include those values. Keep them on your own machine unless you intend to share them. Remove personal values before publishing logs, test artifacts or GitHub issues. Temporary native helper files and ownership locks are managed locally; use the documented release lifecycle to unload the helper. Files you explicitly export remain until you remove them.

Installing packages or plugins contacts the distribution service you choose, such as npm or GitHub. If you use widgetctl through an AI agent, that agent may receive tool responses, command output, exported files or screenshots under its own settings and privacy policy. Widgetctl does not control those services.

For questions or a report, use the [GitHub issue tracker](https://github.com/DimaMishchenko/widgetctl/issues). Issues are public; do not include secrets or personal widget content.
